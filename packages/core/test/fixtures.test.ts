import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNAL_KEYS } from '../src/schema.js';
import { SKIP_LABELS } from '../src/rubric.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', '..', '..', 'fixtures');

type Fixture = {
  id: string;
  note: string;
  title: string;
  body: string;
  labels: string[];
  groundingRequired?: boolean;
  expected: {
    status?: 'abstained' | 'skipped';
    score?: number;
    signals?: Record<string, boolean>;
    confidence?: string;
  };
};

const workItems = JSON.parse(readFileSync(join(FIXTURES, 'work-items.json'), 'utf8')) as Fixture[];

/**
 * The eval harness compares the model against these numbers, so a fixture whose
 * score disagrees with its own signal booleans would silently report the model
 * as wrong when the label is what is broken.
 */
test('every expected score equals the count of passing expected signals', () => {
  for (const fixture of workItems) {
    if (fixture.expected.score === undefined) continue;
    assert.ok(
      fixture.expected.signals,
      `${fixture.id}: has an expected score but no expected signals`,
    );

    const counted = SIGNAL_KEYS.filter((key) => fixture.expected.signals![key]).length;
    assert.equal(
      counted,
      fixture.expected.score,
      `${fixture.id}: expected score ${fixture.expected.score} but the signals count to ${counted}`,
    );
  }
});

test('every fixture declares all four signals when it declares any', () => {
  for (const fixture of workItems) {
    if (!fixture.expected.signals) continue;
    for (const key of SIGNAL_KEYS) {
      assert.equal(
        typeof fixture.expected.signals[key],
        'boolean',
        `${fixture.id}: signal "${key}" is missing or not a boolean`,
      );
    }
    const extra = Object.keys(fixture.expected.signals).filter(
      (key) => !SIGNAL_KEYS.includes(key as never),
    );
    assert.deepEqual(extra, [], `${fixture.id}: unknown signal key(s)`);
  }
});

test('a fixture expects either a score or a non-scored status, never both', () => {
  for (const fixture of workItems) {
    const hasScore = fixture.expected.score !== undefined;
    const hasStatus = fixture.expected.status !== undefined;
    assert.ok(hasScore !== hasStatus, `${fixture.id}: must expect exactly one of score or status`);
  }
});

test('fixture ids are unique', () => {
  const ids = workItems.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate fixture id');
});

test('every fixture carries a note explaining what it is testing', () => {
  for (const fixture of workItems) {
    assert.ok(
      fixture.note && fixture.note.length > 15,
      `${fixture.id}: needs a note saying why it exists`,
    );
  }
});

test('a fixture expecting skipped actually carries a skip label', () => {
  for (const fixture of workItems) {
    if (fixture.expected.status !== 'skipped') continue;
    const matched = fixture.labels.some((label) => SKIP_LABELS.includes(label));
    assert.ok(matched, `${fixture.id}: expects skipped but has no skip label`);
  }
});

test('no fixture expecting a score carries a skip label', () => {
  for (const fixture of workItems) {
    if (fixture.expected.score === undefined) continue;
    const matched = fixture.labels.find((label) => SKIP_LABELS.includes(label));
    assert.equal(
      matched,
      undefined,
      `${fixture.id}: expects a score but the scope gate would skip it via "${matched}"`,
    );
  }
});

test('the fixture set spans the full score range', () => {
  const scores = new Set(
    workItems.map((f) => f.expected.score).filter((s): s is number => s !== undefined),
  );
  for (const expected of [0, 4]) {
    assert.ok(scores.has(expected), `no fixture expects ${expected}/4 — the range is untested`);
  }
  assert.ok(scores.size >= 3, 'fixtures should cover at least three distinct scores');
});

test('at least one fixture exercises L2 grounding', () => {
  assert.ok(
    workItems.some((f) => f.groundingRequired),
    'a stale-path fixture is what proves grounding earns its cost',
  );
});

test('the demo issue set parses and every entry is complete', () => {
  const demo = JSON.parse(readFileSync(join(FIXTURES, 'demo-issues.json'), 'utf8')) as Array<{
    title: string;
    body: string;
    labels: string[];
    note: string;
  }>;

  assert.ok(demo.length >= 5, 'seed at least five demo issues');
  for (const issue of demo) {
    assert.ok(issue.title?.length > 5, `demo issue has a thin title: ${issue.title}`);
    assert.ok(issue.body?.length > 10, `demo issue has a thin body: ${issue.title}`);
    assert.ok(Array.isArray(issue.labels), `demo issue has no labels array: ${issue.title}`);
    assert.ok(issue.note?.length > 10, `demo issue has no note: ${issue.title}`);
  }

  const titles = demo.map((i) => i.title);
  assert.equal(new Set(titles).size, titles.length, 'duplicate demo issue title');
});

test('the captured organizer issues parse and carry bodies', () => {
  const saved = JSON.parse(readFileSync(join(FIXTURES, 'organizer-issues.json'), 'utf8')) as Array<{
    number: number;
    title: string;
    body: string | null;
  }>;

  assert.ok(saved.length >= 5, 'expected the organizer issue history to be captured');
  assert.ok(
    saved.some((i) => (i.body?.length ?? 0) > 500),
    'expected at least one substantial captured body to normalize against',
  );
});
