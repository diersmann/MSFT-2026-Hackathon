import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const SPLIT_WORKFLOW = join(root, '.github', 'workflows', 'split.yml');
const LINT_WORKFLOW = join(root, '.github', 'workflows', 'readiness-lint.yml');

/**
 * Runs the same shell pipeline the workflow uses to parse a reclassify request.
 * Testing the real command rather than a reimplementation is the point: a
 * mismatch between the test and the workflow is exactly the bug that would
 * survive to demo day.
 */
function parseReclassify(comment: string): string {
  const script = `echo "$1" | sed -nE 's|^/split[[:space:]]+reclassify[[:space:]]+#?([0-9]+)[[:space:]]+(mechanical\\|judgement).*|\\1=\\2|p' | head -1`;
  return execFileSync('bash', ['-c', script, '--', comment], { encoding: 'utf8' }).trim();
}

/** The whole-command guard, as written in the workflow. */
function isSplitCommand(comment: string): boolean {
  const script = `if echo "$1" | grep -qE '^/split([[:space:]]|$)'; then echo yes; else echo no; fi`;
  return (
    execFileSync('bash', ['-c', script, '--', comment], { encoding: 'utf8' }).trim() === 'yes'
  );
}

test('reclassify parses with and without the hash', () => {
  assert.equal(parseReclassify('/split reclassify #12 judgement'), '12=judgement');
  assert.equal(parseReclassify('/split reclassify 12 mechanical'), '12=mechanical');
});

test('reclassify tolerates extra whitespace and trailing words', () => {
  assert.equal(parseReclassify('/split   reclassify   #7   judgement'), '7=judgement');
  assert.equal(parseReclassify('/split reclassify #12 judgement please'), '12=judgement');
});

test('an invalid route yields no spec rather than a wrong one', () => {
  assert.equal(parseReclassify('/split reclassify #12 banana'), '');
  assert.equal(parseReclassify('/split reclassify #12'), '');
});

/**
 * The dangerous case. '/splitter' is not the /split command, but it starts with
 * it — and if it reached the else branch it would trigger a full decomposition
 * and create up to eight issues from a typo.
 */
test('a prefix that is not the command is rejected', () => {
  for (const comment of ['/splitter reclassify #12 judgement', '/splitting hairs', '/split-foo']) {
    assert.equal(isSplitCommand(comment), false, `${comment} must not count as /split`);
  }
});

test('the bare command and its subcommands are accepted', () => {
  assert.equal(isSplitCommand('/split'), true);
  assert.equal(isSplitCommand('/split reclassify #12 judgement'), true);
});

test('the split workflow guards against prefix matches before decomposing', () => {
  const yaml = readFileSync(SPLIT_WORKFLOW, 'utf8');
  const guardAt = yaml.indexOf("grep -qE '^/split([[:space:]]|$)'");
  const decomposeAt = yaml.indexOf('--issue "$ISSUE_NUMBER" --post');

  assert.ok(guardAt > 0, 'the whole-command guard must exist');
  assert.ok(decomposeAt > 0, 'the decompose invocation must exist');
  assert.ok(guardAt < decomposeAt, 'the guard must come before decomposition can run');
});

test('the split workflow checks write permission before it writes anything', () => {
  const yaml = readFileSync(SPLIT_WORKFLOW, 'utf8');
  const permissionAt = yaml.indexOf('collaborators/$ACTOR/permission');
  const runAt = yaml.indexOf('packages/cli/src/split.ts');

  assert.ok(permissionAt > 0, 'the permission check must exist');
  assert.ok(permissionAt < runAt, 'permission must be checked before the CLI runs');
});

test('gh has a token available wherever the workflows shell out to it', () => {
  for (const path of [SPLIT_WORKFLOW, LINT_WORKFLOW]) {
    const yaml = readFileSync(path, 'utf8');
    if (!yaml.includes('gh issue comment') && !yaml.includes('gh api')) continue;
    assert.ok(
      yaml.includes('GH_TOKEN:'),
      `${path} shells out to gh but never sets GH_TOKEN — gh does not read GITHUB_TOKEN reliably`,
    );
  }
});

test('the readiness workflow cannot fail an issue', () => {
  const yaml = readFileSync(LINT_WORKFLOW, 'utf8');
  // "Never blocks" is the load-bearing promise of issue #3. If the model step
  // can fail the job, a contributor sees a red X on their issue.
  assert.match(yaml, /continue-on-error:\s*true/);
  assert.match(yaml, /concurrency:/);
  assert.match(yaml, /cancel-in-progress:\s*true/);
});

test('both workflows no-op cleanly when no model backend is configured', () => {
  for (const path of [SPLIT_WORKFLOW, LINT_WORKFLOW]) {
    const yaml = readFileSync(path, 'utf8');
    // Either backend is enough to run, so the guard has to consider both.
    assert.match(yaml, /OPENAI_API_KEY/, `${path} must check for an OpenAI key`);
    assert.match(yaml, /AZURE_OPENAI_API_KEY/, `${path} must check for an Azure key`);
    assert.match(yaml, /::notice::/, `${path} must announce a skip rather than failing`);
  }
});
