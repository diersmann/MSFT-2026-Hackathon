import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(here, '..', 'src', 'app', 'api', 'reclassify', 'route.ts');

/**
 * The repo allowlist is a security boundary: without it, anyone who finds the
 * deployed endpoint could make it write to a repository of their choosing using
 * our token. It has to be evaluated before any server-configuration check, or a
 * misconfigured deployment reports 500 and hides the fact that the boundary was
 * never reached.
 */
test('the repo allowlist is checked before the GITHUB_TOKEN check', () => {
  const source = readFileSync(ROUTE, 'utf8');

  const allowlistAt = source.indexOf('this deployment can only modify');
  const tokenCheckAt = source.indexOf('GITHUB_TOKEN is not configured');

  assert.ok(allowlistAt > 0, 'the allowlist guard must exist');
  assert.ok(tokenCheckAt > 0, 'the token guard must exist');
  assert.ok(
    allowlistAt < tokenCheckAt,
    'the allowlist must come first, otherwise a 403 is masked by a 500',
  );
});

test('the route validates the route value against a fixed set', () => {
  const source = readFileSync(ROUTE, 'utf8');
  assert.match(source, /route !== 'mechanical' && route !== 'judgement'/);
});

test('the route rejects non-integer issue numbers', () => {
  const source = readFileSync(ROUTE, 'utf8');
  assert.match(source, /Number\.isInteger/);
});

test('the route never takes the repo from the request body unchecked', () => {
  const source = readFileSync(ROUTE, 'utf8');
  // parseRepo must be called with the allowlisted value, not payload.repo.
  assert.match(source, /parseRepo\(allowed\)/);
  assert.ok(
    !/parseRepo\(payload\.repo/.test(source),
    'payload.repo must never be passed straight to parseRepo',
  );
});
