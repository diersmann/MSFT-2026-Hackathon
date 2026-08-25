import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { clearTreeCache, groundPaths } from '../src/tree.js';

// The cache is keyed by commit sha and our fake always reports the same one, so
// without this each test would answer from the previous test's tree.
beforeEach(() => {
  clearTreeCache();
});

/**
 * A stand-in for the parts of Octokit that tree.ts touches. Testing resolution
 * against a known tree is the only way to prove the stale-path detection that
 * the whole L2 argument rests on.
 */
function fakeOctokit(paths: Array<{ path: string; type: 'blob' | 'tree' }>, options: { truncated?: boolean; fail?: boolean } = {}) {
  return {
    repos: {
      get: async () => ({ data: { default_branch: 'main' } }),
      getCommit: async () => {
        if (options.fail) throw new Error('not found');
        return { data: { sha: 'a1b2c3d4e5f6' } };
      },
    },
    git: {
      getTree: async () => ({
        data: { tree: paths, truncated: options.truncated ?? false },
      }),
    },
  } as never;
}

const TREE: Array<{ path: string; type: 'blob' | 'tree' }> = [
  { path: 'src', type: 'tree' },
  { path: 'src/auth', type: 'tree' },
  { path: 'src/auth/login.js', type: 'blob' },
  { path: 'src/reports', type: 'tree' },
  { path: 'src/reports/export.js', type: 'blob' },
  { path: 'src/settings', type: 'tree' },
  { path: 'src/settings/panel.js', type: 'blob' },
  { path: 'docs', type: 'tree' },
  { path: 'docs/releasing.md', type: 'blob' },
  { path: 'package.json', type: 'blob' },
];

test('a real file is reported as existing', async () => {
  const result = await groundPaths(
    fakeOctokit(TREE),
    'acme',
    'widgets',
    'The bug is in `src/auth/login.js` near the session check.',
  );

  const entry = result.paths.find((p) => p.path === 'src/auth/login.js');
  assert.ok(entry, 'the path should have been extracted');
  assert.equal(entry.exists, true);
});

test('a file that does not exist is caught — the stale-reference case', async () => {
  // This is the failure mode text-only analysis cannot see: the issue reads
  // perfectly, but an agent would start from a reference that is not there.
  const result = await groundPaths(
    fakeOctokit(TREE),
    'acme',
    'widgets',
    'Delete `src/legacy/adapter-v1.js`, it is no longer imported.',
  );

  const entry = result.paths.find((p) => p.path === 'src/legacy/adapter-v1.js');
  assert.ok(entry, 'the path should have been extracted');
  assert.equal(entry.exists, false);
});

test('a directory reference resolves', async () => {
  const result = await groundPaths(fakeOctokit(TREE), 'acme', 'widgets', 'Everything in `src/settings` needs updating.');
  const entry = result.paths.find((p) => p.path === 'src/settings');
  assert.equal(entry?.exists, true);
});

test('an unambiguous bare filename resolves', async () => {
  const result = await groundPaths(fakeOctokit(TREE), 'acme', 'widgets', 'Bump the version in `package.json`.');
  assert.equal(result.paths.find((p) => p.path === 'package.json')?.exists, true);
});

test('top-level layout is reported for the prompt', async () => {
  const result = await groundPaths(fakeOctokit(TREE), 'acme', 'widgets', 'See `src/auth/login.js`.');
  assert.ok(result.topLevelPaths.includes('src/'));
  assert.ok(result.topLevelPaths.includes('docs/'));
});

test('the tree sha is recorded so a score stays explainable later', async () => {
  const result = await groundPaths(fakeOctokit(TREE), 'acme', 'widgets', 'See `src/auth/login.js`.');
  assert.equal(result.treeSha, 'a1b2c3d4e5f6');
});

test('the truncation flag is surfaced', async () => {
  const result = await groundPaths(
    fakeOctokit(TREE, { truncated: true }),
    'acme',
    'widgets',
    'See `src/auth/login.js`.',
  );
  assert.equal(result.treeTruncated, true);
});

test('an unreachable repo degrades to text-only rather than failing', async () => {
  // Grounding is an enhancement. A private repo or a missing token must not take
  // the linter down with it.
  const result = await groundPaths(
    fakeOctokit(TREE, { fail: true }),
    'acme',
    'widgets',
    'The bug is in `src/auth/login.js`.',
  );

  assert.deepEqual(result.paths, []);
  assert.equal(result.treeSha, null);
});

test('an issue naming no paths produces no verdicts', async () => {
  const result = await groundPaths(
    fakeOctokit(TREE),
    'acme',
    'widgets',
    'Login is broken for some users, please fix properly.',
  );
  assert.deepEqual(result.paths, []);
});

test('a mix of real and missing paths is reported accurately', async () => {
  const result = await groundPaths(
    fakeOctokit(TREE),
    'acme',
    'widgets',
    'Move the helper from `src/reports/export.js` into `src/shared/dates.js`.',
  );

  assert.equal(result.paths.find((p) => p.path === 'src/reports/export.js')?.exists, true);
  assert.equal(result.paths.find((p) => p.path === 'src/shared/dates.js')?.exists, false);
});
