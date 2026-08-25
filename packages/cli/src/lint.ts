/**
 * Scores one issue, or every open issue in a repo.
 *
 * Dry-run is the default on purpose: iterating on rubric prompts through
 * Actions push-cycles is miserable, so the local path has to be the fast one.
 * The workflow is a thin wrapper over exactly this code.
 *
 *   npm run lint -- --repo owner/name --issue 4
 *   npm run lint -- --repo owner/name --issue 4 --post
 *   npm run lint -- --repo owner/name --all --limit 20
 */
import { loadEnv } from './env.js';

loadEnv();

import {
  azureConfigured,
  createOctokit,
  ensureLabel,
  fetchIssue,
  LABEL_AGENT_READY,
  LABEL_UNSCORED,
  listIssues,
  parseRepo,
  planLabels,
  reconcileLabels,
  READINESS_MARKER,
  renderComment,
  renderSummaryLine,
  scoreReadiness,
  upsertComment,
  type IssueSnapshot,
  type ReadinessResult,
} from '@dispatch/core';
import { boolFlag, optionalNumber, parseArgs, requireString } from './args.js';

const USAGE = `Usage:
  npm run lint -- --repo <owner/name> --issue <number> [--post] [--force] [--hermetic]
  npm run lint -- --repo <owner/name> --all [--limit <n>] [--state open|closed|all]

Flags:
  --post       Actually write the comment and labels. Omit for a dry run.
  --force      Score even when a skip label (type: idea, dispatch: skip) is present.
  --hermetic   Skip the git-tree lookup, i.e. text-only L0 scoring.
  --json       Emit the raw result as JSON instead of a rendered comment.`;

async function run(
  octokit: ReturnType<typeof createOctokit>,
  ref: { owner: string; repo: string },
  issue: IssueSnapshot,
  options: { post: boolean; force: boolean; hermetic: boolean; json: boolean },
): Promise<ReadinessResult> {
  const result = await scoreReadiness(octokit, ref, issue, {
    force: options.force,
    hermetic: options.hermetic,
  });

  console.log('');
  console.log(`──  #${issue.number} ${issue.title}`);
  console.log(`    ${issue.htmlUrl}`);
  console.log(`    ${renderSummaryLine(result, issue.number)}`);

  if (result.status === 'skipped') return result;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const comment = renderComment(result);
    if (comment) {
      console.log('');
      console.log(comment.replace(/^/gm, '    '));
    }
  }

  if (result.input.paths.length > 0) {
    console.log('');
    console.log('    paths checked:');
    for (const entry of result.input.paths) {
      console.log(`      ${entry.exists ? 'EXISTS   ' : 'NOT FOUND'} ${entry.path}`);
    }
  }

  if (!options.post) return result;

  const comment = renderComment(result);
  if (!comment) return result;

  const posted = await upsertComment(octokit, ref, issue.number, READINESS_MARKER, comment);
  console.log('');
  console.log(`    comment ${posted.action}: ${posted.url}`);

  const plan = planLabels(result);
  if (plan.add.includes(LABEL_AGENT_READY)) {
    await ensureLabel(
      octokit,
      ref,
      LABEL_AGENT_READY,
      '0e8a16',
      'Scored 4/4 by the readiness linter — safe to hand to a coding agent',
    );
  }
  if (plan.add.includes(LABEL_UNSCORED)) {
    await ensureLabel(
      octokit,
      ref,
      LABEL_UNSCORED,
      'ededed',
      'The readiness linter could not score this confidently',
    );
  }
  await reconcileLabels(octokit, ref, issue.number, issue.labels, plan.add, plan.remove);
  if (plan.add.length || plan.remove.length) {
    console.log(
      `    labels: ${plan.add.map((l) => `+${l}`).join(' ')} ${plan.remove
        .map((l) => `-${l}`)
        .join(' ')}`.trimEnd(),
    );
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (boolFlag(args, 'help')) {
    console.log(USAGE);
    return;
  }

  if (!azureConfigured()) {
    console.error('No model backend configured. Set OPENAI_API_KEY (or the AZURE_OPENAI_* pair)');
    console.error('in .env, then run `npm run smoke` to verify your model names.');
    process.exit(1);
  }

  const repo = requireString(args, 'repo');
  const ref = parseRepo(repo);
  const octokit = createOctokit();

  const options = {
    post: boolFlag(args, 'post'),
    force: boolFlag(args, 'force'),
    hermetic: boolFlag(args, 'hermetic'),
    json: boolFlag(args, 'json'),
  };

  if (!options.post) {
    console.log('DRY RUN — nothing will be written. Add --post to publish.');
  }

  const issueNumber = optionalNumber(args, 'issue');

  if (issueNumber !== undefined) {
    const issue = await fetchIssue(octokit, ref, issueNumber);
    await run(octokit, ref, issue, options);
    return;
  }

  if (!boolFlag(args, 'all')) {
    console.error(USAGE);
    process.exit(1);
  }

  const state = (args.flags.state as string) ?? 'open';
  const limit = optionalNumber(args, 'limit') ?? 25;
  const issues = await listIssues(octokit, ref, {
    state: state as 'open' | 'closed' | 'all',
    limit,
  });

  console.log(`Scoring ${issues.length} issue(s) from ${repo}`);

  const tally: Record<string, number> = {};
  for (const issue of issues) {
    try {
      const result = await run(octokit, ref, issue, options);
      const key =
        result.status === 'scored' ? `${result.score}/4` : result.status === 'skipped' ? 'skipped' : 'abstained';
      tally[key] = (tally[key] ?? 0) + 1;
    } catch (error) {
      console.log(`    error: ${(error as Error).message}`);
      tally.error = (tally.error ?? 0) + 1;
    }
  }

  console.log('');
  console.log('Summary');
  for (const [key, count] of Object.entries(tally).sort()) {
    console.log(`  ${key.padEnd(10)} ${count}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
