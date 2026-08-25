/**
 * Measures the rubric against hand-labeled fixtures.
 *
 * Without this, prompt edits are guesswork: a wording change that "reads
 * better" can quietly shift the whole score distribution. Per-signal agreement
 * is reported separately from exact-score agreement, because the interesting
 * failures are usually one signal disagreeing consistently.
 *
 * Fixtures run hermetically (no git-tree call) so the eval is reproducible —
 * except for those marked groundingRequired, which are reported separately.
 *
 *   npm run eval
 *   npm run eval -- --only stale-path
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  azureConfigured,
  SIGNAL_KEYS,
  scoreReadiness,
  type IssueSnapshot,
  type SignalKey,
} from '@dispatch/core';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', 'fixtures', 'work-items.json');

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
    signals?: Record<SignalKey, boolean>;
    confidence?: 'high' | 'low';
  };
};

function toIssue(fixture: Fixture): IssueSnapshot {
  return {
    number: 0,
    title: fixture.title,
    body: fixture.body,
    labels: fixture.labels,
    state: 'open',
    isPullRequest: false,
    authorType: 'User',
    createdAt: new Date().toISOString(),
    closedAt: null,
    htmlUrl: `fixture://${fixture.id}`,
  };
}

async function main(): Promise<void> {
  if (!azureConfigured()) {
    console.error('Azure OpenAI is not configured — copy .env.example to .env first.');
    process.exit(1);
  }

  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : undefined;

  const all = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Fixture[];
  const fixtures = only ? all.filter((f) => f.id === only) : all;

  console.log(`Evaluating ${fixtures.length} fixture(s)\n`);

  let statusCorrect = 0;
  let statusTotal = 0;
  let scoreExact = 0;
  let scoreWithinOne = 0;
  let scoreTotal = 0;
  const signalHits: Record<SignalKey, { correct: number; total: number }> = {
    observableOutcome: { correct: 0, total: 0 },
    scope: { correct: 0, total: 0 },
    context: { correct: 0, total: 0 },
    ambiguity: { correct: 0, total: 0 },
  };
  const failures: string[] = [];

  for (const fixture of fixtures) {
    const issue = toIssue(fixture);
    // groundingRequired fixtures depend on a real tree lookup we deliberately
    // do not perform here; they are exercised against the demo repo instead.
    const result = await scoreReadiness(null, { owner: 'fixture', repo: 'fixture' }, issue, {
      hermetic: true,
    });

    const expectedStatus = fixture.expected.status ?? 'scored';
    statusTotal += 1;
    const statusOk = result.status === expectedStatus;
    if (statusOk) statusCorrect += 1;

    const flag = statusOk ? ' ' : '!';
    let line = `${flag} ${fixture.id.padEnd(24)} expected ${expectedStatus.padEnd(9)} got ${result.status.padEnd(9)}`;

    if (result.status === 'scored' && fixture.expected.score !== undefined) {
      scoreTotal += 1;
      const delta = Math.abs(result.score - fixture.expected.score);
      if (delta === 0) scoreExact += 1;
      if (delta <= 1) scoreWithinOne += 1;
      line += ` score ${result.score}/4 (want ${fixture.expected.score})`;

      if (fixture.expected.signals) {
        const wrong: string[] = [];
        for (const key of SIGNAL_KEYS) {
          const want = fixture.expected.signals[key];
          const got = result.readiness.signals[key].pass;
          signalHits[key].total += 1;
          if (want === got) signalHits[key].correct += 1;
          else wrong.push(`${key} want ${want} got ${got}`);
        }
        if (wrong.length) line += `\n    signals off: ${wrong.join('; ')}`;
      }

      if (fixture.groundingRequired) {
        line += '\n    (needs L2 grounding — hermetic run understates context)';
      }
    }

    if (result.status === 'abstained') line += `\n    reason: ${result.reason}`;
    if (result.status === 'skipped') line += `\n    reason: ${result.reason}`;

    console.log(line);
    if (!statusOk) failures.push(`${fixture.id}: expected ${expectedStatus}, got ${result.status}`);
  }

  console.log('\n─── Agreement ───');
  console.log(
    `status      ${statusCorrect}/${statusTotal} (${pct(statusCorrect, statusTotal)})  — scored vs abstained vs skipped`,
  );
  if (scoreTotal) {
    console.log(`score exact  ${scoreExact}/${scoreTotal} (${pct(scoreExact, scoreTotal)})`);
    console.log(
      `score ±1     ${scoreWithinOne}/${scoreTotal} (${pct(scoreWithinOne, scoreTotal)})`,
    );
  }
  console.log('');
  for (const key of SIGNAL_KEYS) {
    const { correct, total } = signalHits[key];
    if (!total) continue;
    console.log(`${key.padEnd(18)} ${correct}/${total} (${pct(correct, total)})`);
  }

  if (failures.length) {
    console.log('\nStatus mismatches:');
    for (const failure of failures) console.log(`  ${failure}`);
  }

  console.log(
    '\nA consistently-wrong single signal is more informative than a low total: it means the rubric wording for that signal is off, not the model.',
  );
}

function pct(part: number, total: number): string {
  if (!total) return 'n/a';
  return `${Math.round((part / total) * 100)}%`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
