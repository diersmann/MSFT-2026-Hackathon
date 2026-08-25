import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAX_SUB_ISSUES, routeChild, type Classification } from '../src/split-schema.js';

const mechanicalCase: Classification = {
  outcomeFullyDetermined: true,
  diffVerifiableWithoutOpinion: true,
  requiresTaste: false,
  reasoning: 'a named substitution in one file',
  confidence: 'high',
};

test('all three conditions plus confidence routes to the agent', () => {
  const { route } = routeChild(mechanicalCase, []);
  assert.equal(route, 'mechanical');
});

test('low confidence always routes to a human', () => {
  const { route, routeReason } = routeChild({ ...mechanicalCase, confidence: 'low' }, []);
  assert.equal(route, 'judgement');
  assert.match(routeReason, /not confident/);
});

test('taste routes to a human even when everything else passes', () => {
  const { route } = routeChild({ ...mechanicalCase, requiresTaste: true }, []);
  assert.equal(route, 'judgement');
});

test('an undetermined outcome routes to a human', () => {
  const { route } = routeChild({ ...mechanicalCase, outcomeFullyDetermined: false }, []);
  assert.equal(route, 'judgement');
});

test('an unverifiable diff routes to a human', () => {
  const { route } = routeChild({ ...mechanicalCase, diffVerifiableWithoutOpinion: false }, []);
  assert.equal(route, 'judgement');
});

test('a missing path routes to a human however mechanical it looks', () => {
  const { route, routeReason } = routeChild(mechanicalCase, ['src/gone.ts']);
  assert.equal(route, 'judgement');
  assert.match(routeReason, /src\/gone\.ts/);
});

test('no single failing condition can be outvoted by the others', () => {
  const conditions = [
    { outcomeFullyDetermined: false },
    { diffVerifiableWithoutOpinion: false },
    { requiresTaste: true },
    { confidence: 'low' as const },
  ];

  for (const override of conditions) {
    const { route } = routeChild({ ...mechanicalCase, ...override }, []);
    assert.equal(
      route,
      'judgement',
      `${JSON.stringify(override)} must force judgement — the asymmetry is the safety property`,
    );
  }
});

test('the sub-issue cap is 8', () => {
  assert.equal(MAX_SUB_ISSUES, 8);
});

test('placeholder paths are not treated as real claims', () => {
  // A <placeholder> is an admission of ignorance, not a wrong path, so it must
  // not be the thing that demotes an otherwise mechanical item.
  const { route } = routeChild(mechanicalCase, []);
  assert.equal(route, 'mechanical');
});

/**
 * suggestedActors returns the Actor interface, where `id` does not exist.
 * Selecting it directly made the query invalid, and the empty catch turned that
 * into "Copilot is not available here" — delegation silently off.
 */
test('the Copilot lookup selects the node id through inline fragments', () => {
  const source = readFileSync(new URL('../src/split.ts', import.meta.url), 'utf8');
  const query = source.slice(source.indexOf('suggestedActors'));

  assert.match(query, /\.\.\.\s*on Bot\s*\{\s*id\s*\}/, 'needs an inline fragment on Bot');
  assert.doesNotMatch(
    query.slice(0, query.indexOf('}')),
    /nodes\s*\{\s*login\s+id\s*\}/,
    'id must not be selected straight off the Actor interface',
  );
});

test('the agent lookup and assignment report why they failed', () => {
  const source = readFileSync(new URL('../src/split.ts', import.meta.url), 'utf8');
  // Both functions degrade to "no agent", so a bare catch hides the cause.
  assert.doesNotMatch(source, /\}\s*catch\s*\{\s*\n\s*return (null|false);/);
});
