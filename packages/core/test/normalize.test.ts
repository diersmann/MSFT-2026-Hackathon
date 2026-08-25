import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBody } from '../src/normalize.js';

test('strips HTML comment boilerplate left by issue forms', () => {
  const result = normalizeBody('Real content here.\n<!-- a hint the author never removed -->');
  assert.equal(result.body, 'Real content here.');
});

test('strips multi-line HTML comments', () => {
  const result = normalizeBody('Before\n<!--\nline one\nline two\n-->\nAfter');
  assert.ok(!result.body.includes('line one'));
  assert.ok(result.body.includes('Before'));
  assert.ok(result.body.includes('After'));
});

test('strips the organizer example-issue notice', () => {
  const raw = [
    '> [!NOTE]',
    "> **Example issue, seeded by the organizers.** Please don't edit or claim this one; submit your own idea instead.",
    '',
    '### The idea in one or two sentences',
    '',
    'A bot that scores issues.',
  ].join('\n');

  const result = normalizeBody(raw);
  assert.ok(!result.body.toLowerCase().includes('seeded by the organiz'));
  assert.ok(result.body.includes('A bot that scores issues.'));
});

test('keeps alert blocks that carry real content', () => {
  const raw = [
    '> [!WARNING]',
    '> This migration drops the audit table.',
    '',
    'Details follow.',
  ].join('\n');
  const result = normalizeBody(raw);
  assert.ok(result.body.includes('drops the audit table'));
});

test('detects _No response_ sections as empty', () => {
  const raw = [
    '### What needs doing?',
    '',
    'Rename the props.',
    '',
    "### How will you know it's done?",
    '',
    '_No response_',
  ].join('\n');

  const result = normalizeBody(raw);
  assert.deepEqual(result.emptySections, ["How will you know it's done?"]);
  assert.equal(result.sections['What needs doing?'], 'Rename the props.');
});

test('treats a whitespace-only section as empty', () => {
  const result = normalizeBody('### Team name\n\n\n### What needs doing?\n\nSomething.');
  assert.deepEqual(result.emptySections, ['Team name']);
});

test('counts images and replaces them with placeholders', () => {
  const result = normalizeBody(
    'Repro:\n\n![console error](https://example.com/a.png)\n\n<img alt="trace" src="b.png">',
  );
  assert.equal(result.images, 2);
  assert.ok(result.body.includes('[image: console error]'));
  assert.ok(result.body.includes('[image: trace]'));
  assert.ok(!result.body.includes('https://example.com/a.png'));
});

test('collects links without duplicating markdown targets', () => {
  const result = normalizeBody(
    'See [docs](https://example.com/docs) and https://example.com/other',
  );
  assert.ok(result.links.includes('https://example.com/docs'));
  assert.ok(result.links.includes('https://example.com/other'));
});

test('truncates long bodies on a paragraph boundary', () => {
  const paragraph = 'x'.repeat(500);
  const raw = Array.from({ length: 30 }, () => paragraph).join('\n\n');
  const result = normalizeBody(raw);

  assert.equal(result.truncated, true);
  assert.ok(result.body.length <= 8000);
  assert.ok(!result.body.endsWith('\n'));
});

test('does not flag short bodies as truncated', () => {
  const result = normalizeBody('Short and complete.');
  assert.equal(result.truncated, false);
});

test('handles empty and missing bodies', () => {
  for (const input of [null, undefined, '', '   \n  ']) {
    const result = normalizeBody(input);
    assert.equal(result.body, '');
    assert.equal(result.truncated, false);
    assert.deepEqual(result.emptySections, []);
  }
});

test('collapses runs of blank lines', () => {
  const result = normalizeBody('One\n\n\n\n\nTwo');
  assert.equal(result.body, 'One\n\nTwo');
});
