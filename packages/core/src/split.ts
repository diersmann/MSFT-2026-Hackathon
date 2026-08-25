import type { Octokit } from '@octokit/rest';
import { callJson } from './azure.js';
import type { RepoRef } from './github.js';
import {
  buildClassifyUser,
  buildDecomposeUser,
  CLASSIFY_SYSTEM,
  DECOMPOSE_SYSTEM,
  SPLIT_PROMPT_VERSION,
} from './prompts/split.js';
import { buildScoringInput } from './rubric.js';
import type { IssueSnapshot } from './github.js';
import type { ScoringInput } from './schema.js';
import {
  CLASSIFICATION_JSON_SCHEMA,
  ClassificationSchema,
  DECOMPOSITION_JSON_SCHEMA,
  DecompositionSchema,
  MAX_SUB_ISSUES,
  routeChild,
  type ClassifiedChild,
  type Decomposition,
  type SubIssueDraft,
} from './split-schema.js';
import { loadTree } from './tree.js';

export const COPILOT_LOGIN = 'copilot-swe-agent';

export type SplitPlan =
  | { status: 'refused'; reason: string; input: ScoringInput }
  | { status: 'planned'; summary: string; children: ClassifiedChild[]; input: ScoringInput };

async function verifyTouches(
  octokit: Octokit | null,
  ref: RepoRef,
  touches: string[],
): Promise<Array<{ path: string; exists: boolean }>> {
  if (!octokit || !touches.length) return touches.map((path) => ({ path, exists: true }));

  const tree = await loadTree(octokit, ref.owner, ref.repo);
  if (!tree) return touches.map((path) => ({ path, exists: true }));

  return touches.map((path) => {
    const normalized = path.replace(/^\.\//, '').replace(/\/$/, '');
    // A placeholder is not a claim about the repo, so it cannot be wrong.
    if (/[<>]/.test(normalized)) return { path, exists: true };
    const exists =
      tree.paths.has(normalized) ||
      tree.directories.has(normalized) ||
      [...tree.paths].some((p) => p.endsWith(`/${normalized}`));
    return { path, exists };
  });
}

export async function decompose(
  octokit: Octokit | null,
  ref: RepoRef,
  issue: IssueSnapshot,
): Promise<{ decomposition: Decomposition; input: ScoringInput }> {
  const input = await buildScoringInput(octokit, ref, issue, { hermetic: !octokit });

  const raw = await callJson({
    task: 'decompose',
    system: DECOMPOSE_SYSTEM,
    user: buildDecomposeUser(input),
    schemaName: 'decomposition',
    schema: DECOMPOSITION_JSON_SCHEMA,
    maxTokens: 4000,
    seed: 23,
  });

  const parsed = DecompositionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Could not parse the decomposition: ${parsed.error.issues[0]?.message}`);
  }

  // The cap is enforced here, not in the prompt. A model asked nicely for at
  // most eight will occasionally return nine.
  const decomposition: Decomposition = {
    ...parsed.data,
    children: parsed.data.children.slice(0, MAX_SUB_ISSUES),
  };

  return { decomposition, input };
}

export async function classify(
  octokit: Octokit | null,
  ref: RepoRef,
  parentTitle: string,
  draft: SubIssueDraft,
): Promise<ClassifiedChild> {
  const verified = await verifyTouches(octokit, ref, draft.touches);
  const missingPaths = verified.filter((v) => !v.exists).map((v) => v.path);

  const raw = await callJson({
    task: 'classify',
    system: CLASSIFY_SYSTEM,
    user: buildClassifyUser(parentTitle, draft, verified),
    schemaName: 'classification',
    schema: CLASSIFICATION_JSON_SCHEMA,
    maxTokens: 1500,
  });

  const parsed = ClassificationSchema.safeParse(raw);
  if (!parsed.success) {
    // An unparseable classification must not become a silent "mechanical".
    return {
      draft,
      classification: {
        outcomeFullyDetermined: false,
        diffVerifiableWithoutOpinion: false,
        requiresTaste: true,
        reasoning: 'the classifier response could not be parsed, so this stays with a human',
        confidence: 'low',
      },
      route: 'judgement',
      routeReason: 'the classifier response could not be parsed',
      missingPaths,
    };
  }

  const { route, routeReason } = routeChild(parsed.data, missingPaths);
  return { draft, classification: parsed.data, route, routeReason, missingPaths };
}

export async function planSplit(
  octokit: Octokit | null,
  ref: RepoRef,
  issue: IssueSnapshot,
): Promise<SplitPlan> {
  const { decomposition, input } = await decompose(octokit, ref, issue);

  if (decomposition.refuseReason || decomposition.children.length === 0) {
    return {
      status: 'refused',
      reason:
        decomposition.refuseReason ??
        'I could not find a decomposition that would not be invention',
      input,
    };
  }

  const children: ClassifiedChild[] = [];
  for (const draft of decomposition.children) {
    children.push(await classify(octokit, ref, issue.title, draft));
  }

  return { status: 'planned', summary: decomposition.summary, children, input };
}

/** Node id lookup, needed for the GraphQL sub-issue and assignment mutations. */
async function issueNodeId(octokit: Octokit, ref: RepoRef, issueNumber: number): Promise<string> {
  const result = await octokit.graphql<{
    repository: { issue: { id: string } };
  }>(
    `query($owner:String!,$repo:String!,$number:Int!){
       repository(owner:$owner,name:$repo){ issue(number:$number){ id } }
     }`,
    { owner: ref.owner, repo: ref.repo, number: issueNumber },
  );
  return result.repository.issue.id;
}

/**
 * Links a child to its parent as a real sub-issue.
 *
 * Worth using the GraphQL mutation rather than a markdown checklist: sub-issues
 * are first-class, so the parent gets a progress rollup for free and the
 * relationship survives someone editing the body.
 */
export async function linkSubIssue(
  octokit: Octokit,
  ref: RepoRef,
  parentNumber: number,
  childNumber: number,
): Promise<void> {
  const [parentId, childId] = await Promise.all([
    issueNodeId(octokit, ref, parentNumber),
    issueNodeId(octokit, ref, childNumber),
  ]);

  await octokit.graphql(
    `mutation($parentId:ID!,$childId:ID!){
       addSubIssue(input:{issueId:$parentId, subIssueId:$childId}){ clientMutationId }
     }`,
    { parentId, childId },
  );
}

/** Resolves the Copilot coding agent's node id, or null when it is not available here. */
export async function copilotActorId(octokit: Octokit, ref: RepoRef): Promise<string | null> {
  try {
    const result = await octokit.graphql<{
      repository: { suggestedActors: { nodes: Array<{ login: string; id?: string }> } };
    }>(
      // suggestedActors returns the Actor interface, which has login but not id.
      // Selecting id directly is invalid GraphQL, so the node id has to come
      // through inline fragments on the concrete types.
      `query($owner:String!,$repo:String!){
         repository(owner:$owner,name:$repo){
           suggestedActors(capabilities:[CAN_BE_ASSIGNED], first:50){
             nodes {
               login
               ... on Bot { id }
               ... on User { id }
             }
           }
         }
       }`,
      { owner: ref.owner, repo: ref.repo },
    );
    const bot = result.repository.suggestedActors.nodes.find((n) => n.login === COPILOT_LOGIN);
    return bot?.id ?? null;
  } catch (error) {
    // Returning null here disables delegation, so a silent catch turns a broken
    // query into "Copilot is unavailable" and hides the real cause.
    console.warn(`Could not resolve the Copilot agent: ${(error as Error).message}`);
    return null;
  }
}

export async function assignCopilot(
  octokit: Octokit,
  ref: RepoRef,
  issueNumber: number,
  actorId: string,
): Promise<boolean> {
  try {
    const issueId = await issueNodeId(octokit, ref, issueNumber);
    await octokit.graphql(
      `mutation($issueId:ID!,$actorIds:[ID!]!){
         replaceActorsForAssignable(input:{assignableId:$issueId, actorIds:$actorIds}){
           clientMutationId
         }
       }`,
      { issueId, actorIds: [actorId] },
    );
    return true;
  } catch (error) {
    // The caller reports this as "not assigned"; without the reason a missing
    // PAT scope is indistinguishable from an unavailable agent.
    console.warn(
      `Could not assign the Copilot agent to #${issueNumber}: ${(error as Error).message}`,
    );
    return false;
  }
}

export { SPLIT_PROMPT_VERSION };
