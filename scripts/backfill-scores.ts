/**
 * Scores a repository's issue history and writes data/scores.json.
 *
 * Two outputs matter. The distribution shows whether the rubric discriminates
 * at all — if everything lands on 2/4 the rubric is a thermometer in a sealed
 * room. The score-versus-time-to-close correlation tests whether readiness
 * predicts anything real.
 *
 * If 4/4 issues do not close faster, the rubric is wrong. Reporting that
 * honestly is a better finding than the tool, so this script prints it either
 * way rather than hiding a null result.
 *
 *   npx tsx scripts/backfill-scores.ts --repo owner/name --limit 50
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  azureConfigured,
  createOctokit,
  listIssues,
  parseRepo,
  scoreReadiness,
  SKIP_LABELS,
  type IssueSnapshot,
} from '@dispatch/core';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '..', 'data');

type Record_ = {
  repo: string;
  number: number;
  title: string;
  url: string;
  population: 'work-item' | 'not-work-item';
  status: 'scored' | 'abstained' | 'skipped';
  score: number | null;
  signals: Record<string, boolean> | null;
  weakest: string | null;
  confidence: string | null;
  reason: string | null;
  labels: string[];
  state: string;
  createdAt: string;
  closedAt: string | null;
  hoursToClose: number | null;
  pathsChecked: number;
  pathsMissing: number;
  treeSha: string | null;
  promptVersion: string | null;
  model: string | null;
};

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function population(issue: IssueSnapshot): 'work-item' | 'not-work-item' {
  return issue.labels.some((l) => SKIP_LABELS.includes(l)) ? 'not-work-item' : 'work-item';
}

function hoursToClose(issue: IssueSnapshot): number | null {
  if (!issue.closedAt) return null;
  const ms = new Date(issue.closedAt).getTime() - new Date(issue.createdAt).getTime();
  return Math.round((ms / 3600000) * 10) / 10;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Pearson correlation. Returns null when there is not enough spread to mean anything. */
function correlation(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000;
}

async function main(): Promise<void> {
  if (!azureConfigured()) {
    console.error('Azure OpenAI is not configured — copy .env.example to .env first.');
    process.exit(1);
  }

  const repoArg = flag('repo');
  if (!repoArg) {
    console.error('Usage: --repo owner/name [--limit 50] [--force]');
    process.exit(1);
  }
  const ref = parseRepo(repoArg);
  const limit = Number(flag('limit') ?? 50);
  const force = process.argv.includes('--force');

  const octokit = createOctokit();
  const issues = await listIssues(octokit, ref, { state: 'all', limit });

  console.log(`Scoring ${issues.length} issue(s) from ${repoArg}\n`);

  const records: Record_[] = [];

  for (const issue of issues) {
    process.stdout.write(`#${String(issue.number).padStart(4)} `);
    try {
      const result = await scoreReadiness(octokit, ref, issue, { force });
      const base = {
        repo: repoArg,
        number: issue.number,
        title: issue.title,
        url: issue.htmlUrl,
        population: population(issue),
        labels: issue.labels,
        state: issue.state,
        createdAt: issue.createdAt,
        closedAt: issue.closedAt,
        hoursToClose: hoursToClose(issue),
      };

      if (result.status === 'skipped') {
        records.push({
          ...base,
          status: 'skipped',
          score: null,
          signals: null,
          weakest: null,
          confidence: null,
          reason: result.reason,
          pathsChecked: 0,
          pathsMissing: 0,
          treeSha: null,
          promptVersion: null,
          model: null,
        });
        console.log(`skipped — ${result.reason}`);
        continue;
      }

      const shared = {
        pathsChecked: result.input.paths.length,
        pathsMissing: result.input.paths.filter((p) => !p.exists).length,
        treeSha: result.input.treeSha,
        promptVersion: result.promptVersion,
        model: result.model,
      };

      if (result.status === 'abstained') {
        records.push({
          ...base,
          ...shared,
          status: 'abstained',
          score: null,
          signals: null,
          weakest: null,
          confidence: 'low',
          reason: result.reason,
        });
        console.log(`abstained — ${result.reason}`);
        continue;
      }

      records.push({
        ...base,
        ...shared,
        status: 'scored',
        score: result.score,
        signals: Object.fromEntries(
          Object.entries(result.readiness.signals).map(([k, v]) => [k, v.pass]),
        ),
        weakest: result.readiness.weakest,
        confidence: result.readiness.confidence,
        reason: null,
      });
      console.log(`${result.score}/4`);
    } catch (error) {
      console.log(`error — ${(error as Error).message}`);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, 'scores.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), repo: repoArg, records },
      null,
      2,
    ),
  );

  report(records, repoArg);
  console.log(`\nWrote ${records.length} record(s) to data/scores.json`);
}

function report(records: Record_[], repo: string): void {
  const workItems = records.filter((r) => r.population === 'work-item');
  const others = records.filter((r) => r.population === 'not-work-item');

  console.log('\n════ Population ════');
  console.log(`work items      ${workItems.length}`);
  console.log(`not work items  ${others.length}  (ideas, submissions, examples — out of scope)`);

  if (others.length > workItems.length) {
    console.log('');
    console.log(`NOTE: ${repo} is mostly not work items, so this distribution says more about`);
    console.log('the repo than the rubric. The seeded playground repo is the real test set.');
  }

  const scored = workItems.filter((r) => r.status === 'scored');

  console.log('\n════ Distribution (work items only) ════');
  for (const score of [0, 1, 2, 3, 4]) {
    const count = scored.filter((r) => r.score === score).length;
    const bar = '█'.repeat(count);
    console.log(`${score}/4  ${String(count).padStart(3)}  ${bar}`);
  }
  const abstained = workItems.filter((r) => r.status === 'abstained').length;
  const skipped = workItems.filter((r) => r.status === 'skipped').length;
  console.log(`abst ${String(abstained).padStart(3)}`);
  console.log(`skip ${String(skipped).padStart(3)}`);

  if (scored.length >= 2) {
    const spread = new Set(scored.map((r) => r.score)).size;
    if (spread <= 1) {
      console.log('');
      console.log('WARNING: every scored issue landed on the same number. A rubric that cannot');
      console.log('discriminate is not measuring anything — check the prompt before trusting it.');
    }
  }

  console.log('\n════ Weakest signal (where issues actually fail) ════');
  const weakest: Record<string, number> = {};
  for (const record of scored) {
    if (record.weakest) weakest[record.weakest] = (weakest[record.weakest] ?? 0) + 1;
  }
  for (const [key, count] of Object.entries(weakest).sort((a, b) => b[1] - a[1])) {
    console.log(`${key.padEnd(18)} ${count}`);
  }

  const stale = scored.filter((r) => r.pathsMissing > 0);
  if (stale.length) {
    console.log('\n════ Stale references (L2 caught these) ════');
    for (const record of stale) {
      console.log(`#${record.number} ${record.title} — ${record.pathsMissing} missing path(s)`);
    }
  }

  console.log('\n════ Does readiness predict anything? ════');
  const closed = scored.filter((r) => r.hoursToClose !== null);
  if (closed.length < 3) {
    console.log(`Only ${closed.length} closed work item(s) scored — not enough to say. Honest answer: unknown.`);
    return;
  }

  const pairs = closed.map((r) => [r.score!, r.hoursToClose!] as [number, number]);
  const r = correlation(pairs);

  for (const score of [0, 1, 2, 3, 4]) {
    const hours = closed.filter((c) => c.score === score).map((c) => c.hoursToClose!);
    const med = median(hours);
    if (med !== null) {
      console.log(`${score}/4  median ${med}h to close  (n=${hours.length})`);
    }
  }

  console.log('');
  if (r === null) {
    console.log('Not enough spread to compute a correlation.');
  } else {
    console.log(`Pearson r between score and hours-to-close: ${r}`);
    if (r > -0.2) {
      console.log('');
      console.log('Higher-scoring issues are NOT closing faster. Taken at face value that means');
      console.log('the rubric is measuring something other than what makes work tractable —');
      console.log('which is a more interesting result than a tool that appears to work.');
      console.log('Caveat: small n, and hackathon repos have no real throughput to measure.');
    } else {
      console.log('');
      console.log('Higher-scoring issues close faster, which is what the rubric predicts.');
      console.log('Correlation, not causation: well-specified issues are often also smaller.');
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
