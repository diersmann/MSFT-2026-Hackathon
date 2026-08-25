import { PROMPT_VERSION } from './prompts/readiness.js';
import {
  SIGNAL_KEYS,
  SIGNAL_LABELS,
  type Readiness,
  type ReadinessResult,
  type ScoringInput,
} from './schema.js';

/** Hidden marker used to find and replace our own comment on re-runs. */
export const READINESS_MARKER = '<!-- dispatch:readiness -->';

export function markerWithVersion(promptVersion = PROMPT_VERSION): string {
  return `${READINESS_MARKER}\n<!-- dispatch:prompt=${promptVersion} -->`;
}

function signalStrip(readiness: Readiness): string {
  return SIGNAL_KEYS.map(
    (key) => `${readiness.signals[key].pass ? '✅' : '❌'} ${SIGNAL_LABELS[key]}`,
  ).join(' · ');
}

function stalePathNote(input: ScoringInput): string | null {
  const missing = input.paths.filter((p) => !p.exists);
  if (!missing.length) return null;

  const list = missing.map((p) => `\`${p.path}\``).join(', ');
  const plural = missing.length > 1 ? 'these paths' : 'this path';
  return `⚠️ I could not find ${plural} in the repository: ${list} — the reference may be stale, which is worth fixing before an agent acts on it.`;
}

/**
 * One comment. A score, the weakest signal with its evidence, and a single
 * paste-able rewrite.
 *
 * The restraint is the feature: issue #3 asks for one thing, not a wall of
 * feedback, because a wall gets skimmed and then muted.
 */
export function renderScored(
  score: number,
  readiness: Readiness,
  input: ScoringInput,
  meta: { promptVersion: string; model: string },
): string {
  const weakest = readiness.signals[readiness.weakest];
  const perfect = score === 4;

  const lines: string[] = [
    markerWithVersion(meta.promptVersion),
    '',
    `**Agent-readiness ${score}/4** · ${signalStrip(readiness)}`,
    '',
    // At 4/4 nothing actually failed, so calling a signal "weakest" reads as a
    // criticism the score contradicts.
    perfect
      ? `**Nothing blocking.** ${weakest.why}`
      : `**Weakest: ${SIGNAL_LABELS[readiness.weakest]}.** ${weakest.why}`,
    '',
    perfect ? '> **Optional sharpening**' : '> **Suggested rewrite**',
    ...readiness.suggestion
      .trim()
      .split('\n')
      .map((line) => `> ${line}`),
  ];

  const stale = stalePathNote(input);
  if (stale) {
    lines.push('', stale);
  }

  if (perfect) {
    lines.push('', 'This one looks ready to hand to a coding agent — labelled `agent-ready`.');
  }

  lines.push(
    '',
    '<details><summary>All four signals</summary>',
    '',
    '| Signal | Verdict | Why |',
    '| --- | --- | --- |',
    ...SIGNAL_KEYS.map((key) => {
      const signal = readiness.signals[key];
      const why = signal.why.replace(/\|/g, '\\|');
      return `| ${SIGNAL_LABELS[key]} | ${signal.pass ? 'pass' : 'fail'} | ${why} |`;
    }),
    '',
    '</details>',
    '',
    footer(input, meta, { scored: true }),
  );

  return lines.join('\n');
}

/**
 * The abstention path. Issue #3 is explicit that the bot should say so rather
 * than invent a number, so there is deliberately no score and no label here.
 */
export function renderAbstained(
  reason: string,
  input: ScoringInput,
  meta: { promptVersion: string; model: string },
): string {
  return [
    markerWithVersion(meta.promptVersion),
    '',
    "**Agent-readiness: not scored.** I couldn't judge this one confidently, so I'd rather say that than invent a number.",
    '',
    `Reason: ${reason}`,
    '',
    footer(input, meta, { scored: false }),
  ].join('\n');
}

function footer(
  input: ScoringInput,
  meta: { promptVersion: string; model: string },
  options: { scored: boolean },
): string {
  const bits: string[] = ['Advisory only — this never blocks anything.'];

  if (options.scored) {
    bits.push('Scored the description, not the thread, because that is what a coding agent reads.');
    // Only meaningful when a verdict actually depended on the tree.
    if (input.treeSha && input.paths.length > 0) {
      bits.push(`Repo pinned at \`${input.treeSha.slice(0, 7)}\`.`);
    }
    bits.push('Wrong? React 👎 and we count it against the rubric.');
  } else {
    // Inviting disagreement with a non-verdict just produces noise.
    bits.push('Edit the issue and I will try again.');
  }

  return `<sub>${bits.join(' ')} <code>${meta.promptVersion}</code></sub>`;
}

export function renderComment(result: ReadinessResult): string | null {
  if (result.status === 'skipped') return null;
  if (result.status === 'abstained') {
    return renderAbstained(result.reason, result.input, {
      promptVersion: result.promptVersion,
      model: result.model,
    });
  }
  return renderScored(result.score, result.readiness, result.input, {
    promptVersion: result.promptVersion,
    model: result.model,
  });
}

export type LabelPlan = { add: string[]; remove: string[] };

/**
 * `agent-ready` at 4/4 only. Anything looser and the board view that is the
 * whole point of the stretch goal fills with issues an agent would still botch.
 */
export function planLabels(result: ReadinessResult): LabelPlan {
  const AGENT_READY = 'agent-ready';
  const UNSCORED = 'readiness: unscored';

  if (result.status === 'skipped') return { add: [], remove: [] };
  if (result.status === 'abstained') return { add: [UNSCORED], remove: [AGENT_READY] };
  if (result.score === 4) return { add: [AGENT_READY], remove: [UNSCORED] };
  return { add: [], remove: [AGENT_READY, UNSCORED] };
}

/** Terminal-friendly one-liner for the CLI and eval output. */
export function renderSummaryLine(result: ReadinessResult, issueNumber: number): string {
  if (result.status === 'skipped') return `#${issueNumber} skipped — ${result.reason}`;
  if (result.status === 'abstained') return `#${issueNumber} abstained — ${result.reason}`;
  return `#${issueNumber} ${result.score}/4 ${signalStrip(result.readiness)} (weakest: ${
    SIGNAL_LABELS[result.readiness.weakest]
  })`;
}
