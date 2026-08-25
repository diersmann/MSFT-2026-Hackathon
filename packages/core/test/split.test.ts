import assert from 'node:assert/strict';
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
