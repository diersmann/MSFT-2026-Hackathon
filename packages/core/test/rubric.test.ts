import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LABEL_DEFINITIONS, planLabels, renderComment, READINESS_MARKER } from '../src/render.js';
import { deriveScore, shouldSkip } from '../src/rubric.js';
import {
  ISSUE_TYPES,
  type Readiness,
  type ReadinessResult,
  type ScoringInput,
} from '../src/schema.js';
import type { IssueSnapshot } from '../src/github.js';

function signals(
  passes: Partial<Record<keyof Readiness['signals'], boolean>>,
): Readiness['signals'] {
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

function scored(
  readiness: Readiness,
  route: 'mechanical' | 'judgement' = 'judgement',
): ReadinessResult {
  return {
    status: 'scored',
    score: deriveScore(readiness),
    readiness,
    route,
    routeReason: 'test reason',
    input,
    promptVersion: 'test-v1',
    model: 'test-model',
  };
}

const routing: Readiness['routing'] = {
  outcomeFullyDetermined: false,
  diffVerifiableWithoutOpinion: false,
  requiresTaste: false,
  reasoning: 'test',
  confidence: 'high',
};

function readiness(overrides: Partial<Readiness> = {}): Readiness {
  return {
    signals: signals({}),
    weakest: 'ambiguity',
    suggestion: 's',
    issueType: 'bug',
    routing,
    confidence: 'high',
    abstainReason: null,
    ...overrides,
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
  assert.equal(deriveScore(readiness({ weakest: 'scope' })), 0);
  assert.equal(deriveScore(readiness({ signals: signals({ scope: true, context: true }) })), 2);
  assert.equal(
    deriveScore(
      readiness({
        signals: signals({ observableOutcome: true, scope: true, context: true, ambiguity: true }),
      }),
    ),
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
    const result = scored(readiness({ signals: signals(passes) }));
    assert.ok(
      !planLabels(result).add.includes('agent-ready'),
      `score ${score} must not be agent-ready`,
    );
  }

  const perfect = scored(
    readiness({
      signals: signals({ observableOutcome: true, scope: true, context: true, ambiguity: true }),
    }),
  );
  assert.ok(planLabels(perfect).add.includes('agent-ready'));
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

test('a scored issue gets exactly one type label and one route label', () => {
  const plan = planLabels(scored(readiness({ issueType: 'epic' }), 'judgement'));

  assert.ok(plan.add.includes('type: epic'));
  assert.ok(plan.add.includes('judgement'));
  // The other five types and the opposite route must be cleared, or a re-score
  // after an edit leaves two contradictory labels on the issue.
  assert.ok(plan.remove.includes('type: bug'));
  assert.ok(plan.remove.includes('mechanical'));
  assert.equal(plan.add.filter((l) => l.startsWith('type: ')).length, 1);
});

test('re-scoring to a different type removes the previous one', () => {
  const before = planLabels(scored(readiness({ issueType: 'bug' })));
  const after = planLabels(scored(readiness({ issueType: 'chore' })));

  assert.ok(before.add.includes('type: bug'));
  assert.ok(after.add.includes('type: chore'));
  assert.ok(after.remove.includes('type: bug'), 'the stale type must be removed');
});

/** Score and route are orthogonal: well-written prose about a design decision. */
test('a 4/4 judgement issue is agent-ready but still routed to a human', () => {
  const plan = planLabels(
    scored(
      readiness({
        signals: signals({ observableOutcome: true, scope: true, context: true, ambiguity: true }),
      }),
      'judgement',
    ),
  );

  assert.ok(plan.add.includes('agent-ready'));
  assert.ok(plan.add.includes('judgement'));
  assert.ok(!plan.add.includes('mechanical'));
});

test('abstention claims no type and no route', () => {
  const plan = planLabels({
    status: 'abstained',
    reason: 'empty body',
    input,
    promptVersion: 'test-v1',
    model: 'test-model',
  });

  assert.deepEqual(plan.add, ['readiness: unscored']);
  assert.ok(!plan.add.some((l) => l.startsWith('type: ')));
  // Whatever a previous run claimed must be withdrawn.
  assert.ok(plan.remove.includes('type: bug'));
  assert.ok(plan.remove.includes('mechanical'));
  assert.ok(plan.remove.includes('judgement'));
});

test('every label the planner can add has a definition', () => {
  const emitted = new Set<string>();
  for (const type of ISSUE_TYPES) {
    for (const route of ['mechanical', 'judgement'] as const) {
      for (const label of planLabels(scored(readiness({ issueType: type }), route)).add) {
        emitted.add(label);
      }
    }
  }
  for (const label of planLabels({
    status: 'abstained',
    reason: 'x',
    input,
    promptVersion: 'v',
    model: 'm',
  }).add) {
    emitted.add(label);
  }

  // A label applied without a definition is created colourless and undescribed.
  for (const label of emitted) {
    assert.ok(LABEL_DEFINITIONS[label], `${label} needs an entry in LABEL_DEFINITIONS`);
  }
});
