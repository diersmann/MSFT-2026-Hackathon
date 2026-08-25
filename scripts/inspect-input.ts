/**
 * Prints what the model would actually receive for a real issue, without
 * calling the model. Cheap way to catch normalization and grounding bugs.
 *
 *   npx tsx scripts/inspect-input.ts --repo owner/name --issue 3
 *   npx tsx scripts/inspect-input.ts --fixture stale-path
 *   npx tsx scripts/inspect-input.ts --local 3   # from fixtures/organizer-issues.json
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReadinessUser,
  buildScoringInput,
  createOctokit,
  fetchIssue,
  parseRepo,
  shouldSkip,
  type IssueSnapshot,
} from '@dispatch/core';

const here = dirname(fileURLToPath(import.meta.url));

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const fixtureId = flag('fixture');
  const localNumber = flag('local');
  const repoArg = flag('repo');
  const issueArg = flag('issue');

  let issue: IssueSnapshot;
  let ref = { owner: 'fixture', repo: 'fixture' };
  let octokit = null as ReturnType<typeof createOctokit> | null;

  if (fixtureId) {
    const fixtures = JSON.parse(
      readFileSync(join(here, '..', 'fixtures', 'work-items.json'), 'utf8'),
    ) as Array<{ id: string; title: string; body: string; labels: string[] }>;
    const fixture = fixtures.find((f) => f.id === fixtureId);
    if (!fixture) throw new Error(`No fixture with id "${fixtureId}"`);
    issue = {
      number: 0,
      title: fixture.title,
      body: fixture.body,
      labels: fixture.labels,
      state: 'open',
      isPullRequest: false,
      authorType: 'User',
      createdAt: new Date().toISOString(),
      closedAt: null,
      htmlUrl: `fixture://${fixture.id}`,
    };
  } else if (localNumber) {
    const saved = JSON.parse(
      readFileSync(join(here, '..', 'fixtures', 'organizer-issues.json'), 'utf8'),
    ) as IssueSnapshot[];
    const found = saved.find((i) => i.number === Number(localNumber));
    if (!found) throw new Error(`No saved issue #${localNumber}`);
    issue = { ...found, isPullRequest: false };
    ref = parseRepo('reneexeener/msft-hackathon-2026');
  } else if (repoArg && issueArg) {
    ref = parseRepo(repoArg);
    octokit = createOctokit();
    issue = await fetchIssue(octokit, ref, Number(issueArg));
  } else {
    console.error(
      'Usage: --repo owner/name --issue N   |   --fixture <id>   |   --local <saved issue number>',
    );
    process.exit(1);
  }

  const skip = shouldSkip(issue);
  console.log(`Issue: #${issue.number} ${issue.title}`);
  console.log(`Labels: ${issue.labels.join(', ') || '(none)'}`);
  console.log(`Scope gate: ${skip ? `SKIP — ${skip}` : 'scored'}`);
  console.log(`Raw body: ${issue.body?.length ?? 0} chars`);
  console.log('');

  const input = await buildScoringInput(octokit, ref, issue, { hermetic: !octokit });

  console.log(`Normalized body: ${input.body.length} chars`);
  console.log(`Sections parsed: ${Object.keys(input.sections).length}`);
  for (const heading of Object.keys(input.sections)) {
    const empty = input.emptySections.includes(heading);
    console.log(`  ${empty ? '(empty) ' : '        '}${heading}`);
  }
  console.log(`Images: ${input.attachments.images}  Links: ${input.attachments.links.length}`);
  console.log(`Truncated: ${input.truncated}`);
  console.log('');

  console.log('═══ PROMPT THE MODEL WOULD RECEIVE (tail) ═══');
  const user = buildReadinessUser(input);
  const marker = user.indexOf('Now score this issue.');
  console.log(marker >= 0 ? user.slice(marker) : user);
  console.log('');
  console.log(`(full user message: ${user.length} chars, anchors included)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
