/**
 * Decomposes an epic into linked sub-issues and routes the mechanical ones to
 * the Copilot coding agent.
 *
 *   npm run split -- --repo owner/name --issue 12              # dry run
 *   npm run split -- --repo owner/name --issue 12 --post
 *   npm run split -- --repo owner/name --issue 12 --reclassify 15=judgement
 */
import { loadEnv } from './env.js';

loadEnv();

import {
  assignCopilot,
  azureConfigured,
  copilotActorId,
  createOctokit,
  ensureLabel,
  fetchIssue,
  linkSubIssue,
  parseRepo,
  planSplit,
  reconcileLabels,
  renderChildBody,
  renderSplitRefusal,
  renderSplitSummary,
  SPLIT_MARKER,
  upsertComment,
  type ClassifiedChild,
  type RepoRef,
  type Route,
} from '@dispatch/core';
import { boolFlag, optionalNumber, parseArgs, requireString } from './args.js';

const USAGE = `Usage:
  npm run split -- --repo <owner/name> --issue <number> [--post]
  npm run split -- --repo <owner/name> --issue <number> --reclassify <childNumber>=<mechanical|judgement>

Flags:
  --post         Create the sub-issues, link them, and assign the mechanical ones.
  --no-assign    Create and link, but never assign the Copilot agent.`;

async function ensureRouteLabels(octokit: ReturnType<typeof createOctokit>, ref: RepoRef) {
  await ensureLabel(
    octokit,
    ref,
    'mechanical',
    '0e8a16',
    'Outcome fully determined; a diff can be verified without opinion',
  );
  await ensureLabel(octokit, ref, 'judgement', 'fbca04', 'Needs a human decision');
}

/**
 * Manual override. The classify step is the risky one, so reversing it has to be
 * cheaper than arguing with it — one comment, and the agent is added or removed.
 */
async function reclassify(
  octokit: ReturnType<typeof createOctokit>,
  ref: RepoRef,
  spec: string,
  post: boolean,
): Promise<void> {
  const [numberPart, routePart] = spec.split('=');
  const childNumber = Number((numberPart ?? '').replace('#', ''));
  const route = (routePart ?? '').trim() as Route;

  if (!childNumber || (route !== 'mechanical' && route !== 'judgement')) {
    throw new Error('Expected --reclassify <number>=<mechanical|judgement>');
  }

  const child = await fetchIssue(octokit, ref, childNumber);
  console.log(`Reclassifying #${childNumber} (${child.title}) as ${route}`);

  if (!post) {
    console.log('Dry run — add --post to apply.');
    return;
  }

  await ensureRouteLabels(octokit, ref);
  await reconcileLabels(
    octokit,
    ref,
    childNumber,
    child.labels,
    [route],
    [route === 'mechanical' ? 'judgement' : 'mechanical'],
  );

  if (route === 'mechanical') {
    const actorId = await copilotActorId(octokit, ref);
    if (actorId) {
      const ok = await assignCopilot(octokit, ref, childNumber, actorId);
      console.log(ok ? '  assigned to the Copilot agent' : '  could not assign the Copilot agent');
    } else {
      console.log('  the Copilot agent is not assignable in this repository');
    }
  } else {
    try {
      await octokit.issues.removeAssignees({
        ...ref,
        issue_number: childNumber,
        assignees: ['Copilot'],
      });
    } catch {
      // Nothing to remove, or a name mismatch. The label is what the board reads.
    }
    console.log('  left for a human');
  }

  await octokit.issues.createComment({
    ...ref,
    issue_number: childNumber,
    body: `Reclassified as **${route}** by a human. The classifier's guess was overridden — that signal is worth more than the original label.`,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (boolFlag(args, 'help')) {
    console.log(USAGE);
    return;
  }

  if (!azureConfigured() && !args.flags.reclassify) {
    console.error('No model backend configured. Set OPENAI_API_KEY (or the AZURE_OPENAI_* pair).');
    process.exit(1);
  }

  const ref = parseRepo(requireString(args, 'repo'));
  const octokit = createOctokit();
  const post = boolFlag(args, 'post');

  if (typeof args.flags.reclassify === 'string') {
    await reclassify(octokit, ref, args.flags.reclassify, post);
    return;
  }

  const issueNumber = optionalNumber(args, 'issue');
  if (issueNumber === undefined) {
    console.error(USAGE);
    process.exit(1);
  }

  if (!post) console.log('DRY RUN — nothing will be created. Add --post to apply.\n');

  const parent = await fetchIssue(octokit, ref, issueNumber);
  console.log(`Parent: #${parent.number} ${parent.title}`);
  console.log(`        ${parent.htmlUrl}\n`);

  const plan = await planSplit(octokit, ref, parent);

  if (plan.status === 'refused') {
    console.log(`Refused to split: ${plan.reason}\n`);
    console.log(renderSplitRefusal(plan.reason).replace(/^/gm, '  '));
    if (post) {
      const posted = await upsertComment(
        octokit,
        ref,
        parent.number,
        SPLIT_MARKER,
        renderSplitRefusal(plan.reason),
      );
      console.log(`\ncomment ${posted.action}: ${posted.url}`);
    }
    return;
  }

  console.log(`${plan.summary}\n`);
  for (const child of plan.children) {
    const icon = child.route === 'mechanical' ? '🤖' : '🧑';
    console.log(`${icon} ${child.route.padEnd(10)} ${child.draft.title}`);
    console.log(`   ${child.routeReason}`);
    if (child.draft.touches.length) console.log(`   touches: ${child.draft.touches.join(', ')}`);
    if (child.missingPaths.length) console.log(`   MISSING: ${child.missingPaths.join(', ')}`);
  }

  const actorId = await copilotActorId(octokit, ref);
  const copilotAvailable = Boolean(actorId);
  console.log(
    `\nCopilot coding agent assignable here: ${copilotAvailable ? 'yes' : 'no'}`,
  );

  if (!post) {
    console.log('');
    console.log(
      renderSplitSummary(plan, { dryRun: true, copilotAvailable }).replace(/^/gm, '  '),
    );
    return;
  }

  await ensureRouteLabels(octokit, ref);

  const created: ClassifiedChild[] = [];
  for (const child of plan.children) {
    const { data } = await octokit.issues.create({
      ...ref,
      title: child.draft.title,
      body: renderChildBody(child, parent.number, parent.title),
      labels: [child.route],
    });
    child.number = data.number;
    child.url = data.html_url;
    console.log(`created #${data.number} ${child.draft.title}`);

    try {
      await linkSubIssue(octokit, ref, parent.number, data.number);
      console.log(`  linked as a sub-issue of #${parent.number}`);
    } catch (error) {
      // Linking is what gives the parent its progress rollup, so a failure is
      // worth reporting rather than swallowing.
      console.log(`  could not link as a sub-issue: ${(error as Error).message}`);
    }

    if (child.route === 'mechanical' && actorId && !boolFlag(args, 'no-assign')) {
      child.assigned = await assignCopilot(octokit, ref, data.number, actorId);
      console.log(child.assigned ? '  assigned to the Copilot agent' : '  assignment failed');
    }

    created.push(child);
  }

  const summary = renderSplitSummary(
    { ...plan, children: created },
    { dryRun: false, copilotAvailable },
  );
  const posted = await upsertComment(octokit, ref, parent.number, SPLIT_MARKER, summary);
  console.log(`\nsummary comment ${posted.action}: ${posted.url}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
