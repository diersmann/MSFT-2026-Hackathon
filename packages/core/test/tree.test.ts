import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPathCandidates } from '../src/tree.js';

test('extracts backticked file paths', () => {
  const found = extractPathCandidates('Update `src/reports/export.ts` to drop moment.');
  assert.ok(found.includes('src/reports/export.ts'));
});

test('extracts bare paths outside backticks', () => {
  const found = extractPathCandidates('The bug is in src/auth/login.ts around line 40.');
  assert.ok(found.includes('src/auth/login.ts'));
});

test('extracts directory references', () => {
  const found = extractPathCandidates('Everything under `packages/core/src` needs the new header.');
  assert.ok(found.includes('packages/core/src'));
});

test('ignores prose that merely contains a slash', () => {
  const found = extractPathCandidates(
    'This is about human/machine collaboration and our ci/cd setup, and/or the planning/tracking theme.',
  );
  assert.deepEqual(found, []);
});

test('ignores fractions and scores', () => {
  const found = extractPathCandidates('It scored 3/4 on the rubric, up from 1/4.');
  assert.deepEqual(found, []);
});

test('does not treat URL segments as repository paths', () => {
  const found = extractPathCandidates('See https://example.com/docs/setup.md for details.');
  assert.ok(!found.some((p) => p.includes('example.com')));
  assert.ok(!found.includes('docs/setup.md'));
});

test('keeps the longest form when a filename repeats inside a path', () => {
  const found = extractPathCandidates('Look at `src/auth/login.ts` — login.ts is the culprit.');
  assert.ok(found.includes('src/auth/login.ts'));
  assert.ok(!found.includes('login.ts'));
});

test('recognises a bare filename with a known extension', () => {
  const found = extractPathCandidates('Bump typescript in `package.json`.');
  assert.ok(found.includes('package.json'));
});

test('strips a leading ./ so paths match tree entries', () => {
  const found = extractPathCandidates('Edit `./src/index.ts` please.');
  assert.ok(found.includes('src/index.ts'));
  assert.ok(!found.includes('./src/index.ts'));
});

test('drops trailing punctuation', () => {
  const found = extractPathCandidates('The entry point is src/index.ts.');
  assert.ok(found.includes('src/index.ts'));
});

test('returns nothing for issues that name no files', () => {
  assert.deepEqual(
    extractPathCandidates('Login is broken for some users, please fix properly.'),
    [],
  );
});

test('caps the number of candidates', () => {
  const body = Array.from({ length: 60 }, (_, i) => `\`src/mod${i}/file${i}.ts\``).join(' ');
  assert.ok(extractPathCandidates(body).length <= 25);
});

test('handles an empty body', () => {
  assert.deepEqual(extractPathCandidates(''), []);
});
