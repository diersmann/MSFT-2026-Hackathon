import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planLabels, renderComment, READINESS_MARKER } from '../src/render.js';
import { deriveScore, shouldSkip } from '../src/rubric.js';
import type { Readiness, ReadinessResult, ScoringInput } from '../src/schema.js';
import type { IssueSnapshot } from '../src/github.js';

function signals(passes: Partial<Record<keyof Readiness['signals'], boolean>>): Readiness['signals'] {
  const make = (pass: boolean) => ({ pass, why: pass ? 'evidence for' : 'evidence against' });
  return {
    observableOutcome: make(passes.observableOutcome ?? false),
    scope: make(passes.scope ?? false),
    context: make(passes.context ?? false),
    ambiguity: make(passes.ambiguity ?? false),
  };
}

const input: ScoringInput = {
  repo: 'acme/widgets',
  number: 7,
  title: 'Test',
  body: 'Body',
  labels: [],
  attachments: { images: 0, links: [] },
  truncated: false,
  sections: {},
  emptySections: [],
  paths: [],
  topLevelPaths: [],
  treeSha: null,
  treeTruncated: false,
};

function scored(readiness: Readiness): ReadinessResult {
  return {
    status: 'scored',
    score: deriveScore(readiness),
    readiness,
    input,
    promptVersion: 'test-v1',
    model: 'test-model',
  };
}

function issue(overrides: Partial<IssueSnapshot> = {}): IssueSnapshot {
  return {
    number: 1,
    title: 'Something',
    body: 'A body long enough to be judged honestly by the rubric engine.',
    labels: [],
    state: 'open',
    isPullRequest: false,
    authorType: 'User',
    createdAt: '2026-01-01T00:00:00Z',
    closedAt: null,
    htmlUrl: 'https://example.com/1',
    ...overrides,
  };
}

test('score is derived by counting passes, not taken from the model', () => {
  assert.equal(deriveScore({ signals: signals({}), weakest: 'scope', suggestion: 's', confidence: 'high', abstainReason: null }), 0);
  assert.equal(
    deriveScore({
      signals: signals({ scope: true, context: true }),
      weakest: 'ambiguity',
      suggestion: 's',
      confidence: 'high',
      abstainReason: null,
    }),
    2,
  );
  assert.equal(
    deriveScore({
      signals: signals({ observableOutcome: true, scope: true, context: true, ambiguity: true }),
      weakest: 'ambiguity',
      suggestion: 's',
      confidence: 'high',
      abstainReason: null,
    }),
    4,
  );
});

test('agent-ready is applied only at 4/4', () => {
  for (const score of [0, 1, 2, 3]) {
    const passes = Object.fromEntries(
      (['observableOutcome', 'scope', 'context', 'ambiguity'] as const)
        .slice(0, score)
        .map((k) => [k, true]),
    );
    const result = scored({
      signals: signals(passes),
      weakest: 'ambiguity',
      suggestion: 's',
      confidence: 'high',
      abstainReason: null,
    });
    assert.ok(!planLabels(result).add.includes('agent-ready'), `score ${score} must not be agent-ready`);
  }

  const perfect = scored({
    signals: signals({ observableOutcome: true, scope: true, context: true, ambiguity: true }),
    weakest: 'ambiguity',
    suggestion: 's',
    confidence: 'high',
    abstainReason: null,
  });
  assert.deepEqual(planLabels(perfect).add, ['agent-ready']);
});

test('abstention labels unscored and never agent-ready', () => {
  const plan = planLabels({
    status: 'abstained',
    reason: 'empty body',
    input,
    promptVersion: 'test-v1',
    model: 'test-model',
  });
  assert.deepEqual(plan.add, ['readiness: unscored']);
  assert.ok(plan.remove.includes('agent-ready'));
});

test('a skipped issue gets no labels at all', () => {
  const plan = planLabels({ status: 'skipped', reason: 'not a work item' });
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.remove, []);
});

test('abstention output carries no score number', () => {
  const comment = renderComment({
    status: 'abstained',
    reason: 'the issue is essentially empty',
    input,
    promptVersion: 'test-v1',
    model: 'test-model',
  });
  assert.ok(comment);
  assert.ok(comment.includes('not scored'));
  assert.ok(!/\d\/4/.test(comment), 'must not invent a score when abstaining');
});

test('rendered comments carry the marker so re-runs replace rather than stack', () => {
  const comment = renderComment(
    scored({
      signals: signals({ scope: true }),
      weakest: 'context',
      suggestion: 'Name the file.',
      confidence: 'high',
      abstainReason: null,
    }),
  );
  assert.ok(comment?.includes(READINESS_MARKER));
});

test('stale path references are surfaced in the comment', () => {
  const withStale: ReadinessResult = {
    status: 'scored',
    score: 3,
    readiness: {
      signals: signals({ observableOutcome: true, scope: true, ambiguity: true }),
      weakest: 'context',
      suggestion: 'Point at a file that exists.',
      confidence: 'high',
      abstainReason: null,
    },
    input: { ...input, paths: [{ path: 'src/gone.ts', exists: false }] },
    promptVersion: 'test-v1',
    model: 'test-model',
  };

  const comment = renderComment(withStale);
  assert.ok(comment?.includes('src/gone.ts'));
  assert.ok(comment?.includes('stale'));
});

test('skipped issues render no comment', () => {
  assert.equal(renderComment({ status: 'skipped', reason: 'not a work item' }), null);
});

test('scope gate skips ideas, submissions and examples', () => {
  assert.ok(shouldSkip(issue({ labels: ['type: idea'] })));
  assert.ok(shouldSkip(issue({ labels: ['type: project-submission'] })));
  assert.ok(shouldSkip(issue({ labels: ['type: example'] })));
});

test('scope gate skips bots, pull requests and opt-outs', () => {
  assert.ok(shouldSkip(issue({ authorType: 'Bot' })));
  assert.ok(shouldSkip(issue({ isPullRequest: true })));
  assert.ok(shouldSkip(issue({ labels: ['dispatch: skip'] })));
});

test('scope gate lets ordinary work items through', () => {
  assert.equal(shouldSkip(issue({ labels: ['bug'] })), null);
  assert.equal(shouldSkip(issue({ labels: ['type: team-task'] })), null);
});

test('force overrides label gates but never the pull-request gate', () => {
  assert.equal(shouldSkip(issue({ labels: ['type: idea'] }), { force: true }), null);
  assert.ok(shouldSkip(issue({ isPullRequest: true }), { force: true }));
});
