/**
 * Sets up the playground repo: pushes a small real codebase, seeds issues
 * calibrated across the score range, and installs the workflow.
 *
 * The codebase matters more than it looks. Without real files, L2 path
 * verification has nothing to check, and the demo's best beat — an issue that
 * reads perfectly but names a file that no longer exists — cannot happen.
 *
 *   npx tsx scripts/seed-demo-repo.ts --repo owner/playground --create
 *   npx tsx scripts/seed-demo-repo.ts --repo owner/playground --issues-only
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOctokit, ensureLabel, parseRepo } from '@dispatch/core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

type DemoIssue = {
  title: string;
  body: string;
  labels: string[];
  note: string;
};

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', cwd: root }).trim();
}

const LABELS: Array<[string, string, string]> = [
  ['bug', 'd73a4a', "Something isn't working"],
  ['enhancement', 'a2eeef', 'New feature or request'],
  ['chore', 'fef2c0', 'Maintenance work'],
  ['performance', 'c5def5', 'Speed and resource usage'],
  ['question', 'd876e3', 'Further information is requested'],
  ['good first issue', '7057ff', 'Good for newcomers'],
  ['epic', '5319e7', 'Large work item, a candidate for /split'],
];

async function main(): Promise<void> {
  const repoArg = flag('repo');
  if (!repoArg) {
    console.error('Usage: --repo owner/name [--create] [--issues-only] [--push-only]');
    process.exit(1);
  }
  const ref = parseRepo(repoArg);

  if (has('create')) {
    console.log(`Creating ${repoArg} ...`);
    try {
      gh([
        'repo',
        'create',
        repoArg,
        '--public',
        '--description',
        'Playground for the agent-readiness linter and /split. Deliberately ordinary code.',
      ]);
      console.log('  created');
    } catch (error) {
      console.log(`  skipped: ${(error as Error).message.split('\n')[0]}`);
    }
  }

  if (!has('issues-only')) {
    console.log('\nPushing the demo codebase ...');
    const demoDir = join(root, 'demo-repo');
    const commands = [
      ['git', 'init', '-q'],
      ['git', 'add', '-A'],
      ['git', 'commit', '-q', '-m', 'Add WidgetWorks, a deliberately ordinary app'],
      ['git', 'branch', '-M', 'main'],
      ['git', 'remote', 'remove', 'origin'],
      ['git', 'remote', 'add', 'origin', `https://github.com/${repoArg}.git`],
      ['git', 'push', '-u', 'origin', 'main', '--force'],
    ];
    for (const [bin, ...args] of commands) {
      try {
        execFileSync(bin!, args, { cwd: demoDir, stdio: 'pipe' });
      } catch (error) {
        const message = (error as Error).message.split('\n')[0];
        console.log(`  ${bin} ${args[0]}: ${message}`);
      }
    }
    console.log('  pushed');
  }

  if (has('push-only')) return;

  const octokit = createOctokit();

  console.log('\nEnsuring labels ...');
  for (const [name, color, description] of LABELS) {
    await ensureLabel(octokit, ref, name, color, description);
  }
  await ensureLabel(
    octokit,
    ref,
    'agent-ready',
    '0e8a16',
    'Scored 4/4 by the readiness linter — safe to hand to a coding agent',
  );
  await ensureLabel(
    octokit,
    ref,
    'readiness: unscored',
    'ededed',
    'The readiness linter could not score this confidently',
  );
  await ensureLabel(
    octokit,
    ref,
    'mechanical',
    '0e8a16',
    'Outcome fully determined; a diff can be verified without opinion',
  );
  await ensureLabel(octokit, ref, 'judgement', 'fbca04', 'Needs a human decision');
  console.log('  done');

  const issues = JSON.parse(
    readFileSync(join(root, 'fixtures', 'demo-issues.json'), 'utf8'),
  ) as DemoIssue[];

  const existing = await octokit.paginate(octokit.issues.listForRepo, {
    ...ref,
    state: 'all',
    per_page: 100,
  });
  const seen = new Set(existing.map((i) => i.title));

  console.log(`\nSeeding ${issues.length} issue(s) ...`);
  for (const issue of issues) {
    if (seen.has(issue.title)) {
      console.log(`  skip (exists): ${issue.title}`);
      continue;
    }
    const { data } = await octokit.issues.create({
      ...ref,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    });
    console.log(`  #${data.number} ${issue.title}`);
  }

  console.log('\nNext steps:');
  console.log(`  1. Set secrets on the playground:`);
  console.log(`       gh secret set AZURE_OPENAI_ENDPOINT --repo ${repoArg}`);
  console.log(`       gh secret set AZURE_OPENAI_API_KEY --repo ${repoArg}`);
  console.log(`  2. Point it at the engine and pick models:`);
  console.log(
    `       gh variable set DISPATCH_ENGINE_REPO --repo ${repoArg} --body <owner/engine-repo>`,
  );
  console.log(`       gh variable set MODEL_SCORE --repo ${repoArg} --body <deployment>`);
  console.log(`  3. Install the workflows:  ./scripts/install-workflow.sh ${repoArg}`);
  console.log(`  4. Dry-run locally:        npm run lint -- --repo ${repoArg} --all`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
