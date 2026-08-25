import type { Octokit } from '@octokit/rest';
import { callJson, deploymentFor } from './azure.js';
import { normalizeBody } from './normalize.js';
import { buildReadinessUser, PROMPT_VERSION, READINESS_SYSTEM } from './prompts/readiness.js';
import {
  READINESS_JSON_SCHEMA,
  ReadinessSchema,
  SIGNAL_KEYS,
  type Readiness,
  type ReadinessResult,
  type ScoringInput,
} from './schema.js';
import { EMPTY_GROUNDING, groundPaths } from './tree.js';
import { routeChild } from './split-schema.js';
import type { IssueSnapshot, RepoRef } from './github.js';

/**
 * Labels that mark an issue as not-a-work-item. The rubric asks "could an agent
 * act on this?", which is meaningless for a hackathon idea or a final
 * submission: there is no code target, so path verification has nothing to
 * check and "context" means something different. Scoring them anyway would put
 * junk in the distribution and teach people to distrust the bot.
 */
export const SKIP_LABELS = ['type: idea', 'type: project-submission', 'type: example'];

/** Explicit author opt-out. */
export const SKIP_REQUEST_LABEL = 'dispatch: skip';

export const LABEL_AGENT_READY = 'agent-ready';
export const LABEL_UNSCORED = 'readiness: unscored';

export const SEED = 11;

export type ScoreOptions = {
  /** Skip the git-tree call. Used by the eval harness so fixtures stay hermetic. */
  hermetic?: boolean;
  /** Score even when a skip label is present. */
  force?: boolean;
};

export function shouldSkip(issue: IssueSnapshot, options: ScoreOptions = {}): string | null {
  if (issue.isPullRequest) return 'pull requests are out of scope';

  if (!options.force) {
    if (issue.labels.includes(SKIP_REQUEST_LABEL)) {
      return `\`${SKIP_REQUEST_LABEL}\` label present`;
    }
    const matched = issue.labels.find((label) => SKIP_LABELS.includes(label));
    if (matched) {
      return `\`${matched}\` is not a work item — the rubric only applies to actionable work`;
    }
  }

  if (issue.authorType === 'Bot') return 'opened by a bot';

  return null;
}

export async function buildScoringInput(
  octokit: Octokit | null,
  ref: RepoRef,
  issue: IssueSnapshot,
  options: ScoreOptions = {},
): Promise<ScoringInput> {
  const normalized = normalizeBody(issue.body);

  const grounding =
    options.hermetic || !octokit
      ? EMPTY_GROUNDING
      : await groundPaths(octokit, ref.owner, ref.repo, normalized.body);

  return {
    repo: `${ref.owner}/${ref.repo}`,
    number: issue.number,
    title: issue.title,
    body: normalized.body,
    labels: issue.labels,
    attachments: { images: normalized.images, links: normalized.links },
    truncated: normalized.truncated,
    sections: normalized.sections,
    emptySections: normalized.emptySections,
    paths: grounding.paths,
    topLevelPaths: grounding.topLevelPaths,
    treeSha: grounding.treeSha,
    treeTruncated: grounding.treeTruncated,
  };
}

export function deriveScore(readiness: Readiness): number {
  return SIGNAL_KEYS.filter((key) => readiness.signals[key].pass).length;
}

/**
 * Guards the model cannot be trusted to apply to itself.
 *
 * A body with nothing in it cannot be scored honestly, and a model asked to
 * score it will still produce four confident FAILs. Abstaining in code is the
 * only way to keep the "honest about itself" promise from issue #3 real.
 */
function preflightAbstain(input: ScoringInput): string | null {
  const meaningful = input.body.replace(/\s+/g, ' ').trim();
  if (meaningful.length < 30 && input.title.trim().length < 15) {
    return 'the issue is essentially empty — there is nothing here to judge';
  }
  return null;
}

export async function scoreReadiness(
  octokit: Octokit | null,
  ref: RepoRef,
  issue: IssueSnapshot,
  options: ScoreOptions = {},
): Promise<ReadinessResult> {
  const skip = shouldSkip(issue, options);
  if (skip) return { status: 'skipped', reason: skip };

  const input = await buildScoringInput(octokit, ref, issue, options);
  const model = deploymentFor('score');

  const preflight = preflightAbstain(input);
  if (preflight) {
    return { status: 'abstained', reason: preflight, input, promptVersion: PROMPT_VERSION, model };
  }

  const raw = await callJson({
    task: 'score',
    system: READINESS_SYSTEM,
    user: buildReadinessUser(input),
    schemaName: 'agent_readiness',
    schema: READINESS_JSON_SCHEMA,
    maxTokens: 1200,
    seed: SEED,
  });

  const parsed = ReadinessSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'abstained',
      reason: `the model returned a response I could not parse (${parsed.error.issues[0]?.message ?? 'schema mismatch'})`,
      input,
      promptVersion: PROMPT_VERSION,
      model,
    };
  }

  const readiness = parsed.data;

  if (readiness.confidence === 'low') {
    return {
      status: 'abstained',
      reason: readiness.abstainReason?.trim() || 'the model was not confident enough to score this',
      input,
      promptVersion: PROMPT_VERSION,
      model,
    };
  }

  const { route, routeReason } = routeChild(
    readiness.routing,
    input.paths.filter((p) => !p.exists).map((p) => p.path),
  );

  return {
    status: 'scored',
    score: deriveScore(readiness),
    readiness,
    route,
    routeReason,
    input,
    promptVersion: PROMPT_VERSION,
    model,
  };
}
