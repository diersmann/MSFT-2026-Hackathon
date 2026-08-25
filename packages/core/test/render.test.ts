import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderComment } from '../src/render.js';
import type { Readiness, ReadinessResult, ScoringInput } from '../src/schema.js';

const input: ScoringInput = {
  repo: 'acme/widgets',
  number: 1,
  title: 'Title',
  body: 'Body',
  labels: [],
  attachments: { images: 0, links: [] },
  truncated: false,
  sections: {},
  emptySections: [],
  paths: [],
  topLevelPaths: [],
  treeSha: 'abcdef1234567890',
  treeTruncated: false,
};

function readiness(passes: number): Readiness {
  const keys = ['observableOutcome', 'scope', 'context', 'ambiguity'] as const;
  const signals = Object.fromEntries(
    keys.map((key, index) => [key, { pass: index < passes, why: `reason for ${key}` }]),
  ) as Readiness['signals'];

  return {
    signals,
    weakest: passes === 4 ? 'ambiguity' : keys[passes]!,
    suggestion: 'A concrete rewrite.',
    confidence: 'high',
    abstainReason: null,
  };
}

function scored(passes: number, overrides: Partial<ScoringInput> = {}): ReadinessResult {
  return {
    status: 'scored',
    score: passes,
    readiness: readiness(passes),
    input: { ...input, ...overrides },
    promptVersion: 'readiness-v1',
    model: 'test',
  };
}

test('a 4/4 comment does not call any signal the weakest', () => {
  const comment = renderComment(scored(4))!;
  // "Weakest: ambiguity" on a perfect score reads as a criticism the score
  // contradicts.
  assert.ok(!comment.includes('Weakest:'), 'a perfect score must not name a weakest signal');
  assert.match(comment, /Nothing blocking/);
  assert.match(comment, /Optional sharpening/);
});

test('a sub-4 comment names the weakest signal and offers a rewrite', () => {
  const comment = renderComment(scored(2))!;
  assert.match(comment, /Weakest: context/);
  assert.match(comment, /Suggested rewrite/);
  assert.ok(!comment.includes('Optional sharpening'));
});

test('the abstention footer does not invite a 👎 on a non-verdict', () => {
  const comment = renderComment({
    status: 'abstained',
    reason: 'the issue is essentially empty',
    input,
    promptVersion: 'readiness-v1',
    model: 'test',
  })!;

  assert.ok(!comment.includes('👎'), 'there is no verdict to disagree with');
  assert.match(comment, /Edit the issue and I will try again/);
});

test('the abstention footer omits the pinned commit', () => {
  const comment = renderComment({
    status: 'abstained',
    reason: 'empty',
    input,
    promptVersion: 'readiness-v1',
    model: 'test',
  })!;

  // Nothing was verified against the tree, so citing a commit implies a rigour
  // that was not applied.
  assert.ok(!comment.includes('Repo pinned'), 'no tree lookup informed this outcome');
});

test('the pinned commit appears only when a path was actually checked', () => {
  const withoutPaths = renderComment(scored(2))!;
  assert.ok(!withoutPaths.includes('Repo pinned'));

  const withPaths = renderComment(
    scored(2, { paths: [{ path: 'src/index.ts', exists: true }] }),
  )!;
  assert.match(withPaths, /Repo pinned at `abcdef1`/);
});

test('every comment states that it never blocks', () => {
  for (const result of [scored(0), scored(4)]) {
    assert.match(renderComment(result)!, /never blocks/);
  }
});

test('the four-signal breakdown is collapsed, not dumped inline', () => {
  const comment = renderComment(scored(1))!;
  assert.match(comment, /<details><summary>All four signals<\/summary>/);
  // The visible part should stay short — a wall of feedback gets muted.
  const visible = comment.slice(0, comment.indexOf('<details>'));
  assert.ok(visible.length < 700, `visible portion is ${visible.length} chars, too long`);
});

test('a pipe in the reasoning cannot break the markdown table', () => {
  const result = scored(2);
  if (result.status !== 'scored') throw new Error('unreachable');
  result.readiness.signals.context.why = 'uses a | pipe | character';

  const comment = renderComment(result)!;
  assert.ok(comment.includes('uses a \\| pipe \\| character'));
});
