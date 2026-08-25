import { PROMPT_VERSION } from './prompts/readiness.js';
import {
  ISSUE_TYPES,
  SIGNAL_KEYS,
  SIGNAL_LABELS,
  type IssueType,
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
  meta: { promptVersion: string; model: string; route?: string; routeReason?: string },
): string {
  const weakest = readiness.signals[readiness.weakest];
  const perfect = score === 4;
  const epic = readiness.issueType === 'epic';

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

  if (meta.route) {
    const icon = meta.route === 'mechanical' ? '🤖' : '🧑';
    const who = meta.route === 'mechanical' ? 'a coding agent could take this' : 'this wants a human';
    lines.push(
      '',
      `${icon} **${meta.route}** — ${who}${meta.routeReason ? `: ${meta.routeReason}` : ''}`,
    );
  }

  // An epic is not a bad issue, so say what to do about it rather than only
  // docking it on scope.
  if (epic) {
    lines.push(
      '',
      'This looks like an epic rather than one change. Comment `/split` and I will break it into linked sub-issues.',
    );
  }

  if (perfect && !epic) {
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
    route: result.route,
    routeReason: result.routeReason,
  });
}

/**
 * Colour and description for every label the bot creates, so a fresh repo gets
 * a legible board rather than a wall of grey defaults.
 */
export const LABEL_DEFINITIONS: Record<string, { color: string; description: string }> = {
  'agent-ready': {
    color: '0e8a16',
    description: 'Scored 4/4 by the readiness linter — safe to hand to a coding agent',
  },
  'readiness: unscored': {
    color: 'ededed',
    description: 'The readiness linter could not score this confidently',
  },
  mechanical: {
    color: '0e8a16',
    description: 'Outcome fully determined; a diff can be verified without opinion',
  },
  judgement: { color: 'fbca04', description: 'Needs a human decision' },
  'type: bug': { color: 'd73a4a', description: "Something isn't working" },
  'type: feature': { color: 'a2eeef', description: 'New capability or behaviour' },
  'type: chore': { color: 'fef2c0', description: 'Maintenance, dependencies, tooling' },
  'type: docs': { color: '0075ca', description: 'Documentation only' },
  'type: question': { color: 'd876e3', description: 'Support or a request for information' },
  'type: epic': { color: '5319e7', description: 'Several changes bundled — a candidate for /split' },
};

export type LabelPlan = { add: string[]; remove: string[] };

/** `type: bug`, `type: epic`, and so on. Namespaced so they group in GitHub's picker. */
export function typeLabel(type: IssueType): string {
  return `type: ${type}`;
}

const ALL_TYPE_LABELS = ISSUE_TYPES.map(typeLabel);
const ROUTE_LABELS = ['mechanical', 'judgement'];

/**
 * `agent-ready` at 4/4 only. Anything looser and the board view that is the
 * whole point of the stretch goal fills with issues an agent would still botch.
 *
 * The type and route labels are separate axes. Score answers "is this issue
 * well written", route answers "should a machine do it" — a 4/4 design decision
 * is agent-ready prose about work no agent should take. Every label the bot
 * owns is also listed for removal, so a re-score after an edit cannot leave two
 * contradictory labels behind.
 */
export function planLabels(result: ReadinessResult): LabelPlan {
  const AGENT_READY = 'agent-ready';
  const UNSCORED = 'readiness: unscored';

  if (result.status === 'skipped') return { add: [], remove: [] };

  if (result.status === 'abstained') {
    // No verdict means no type and no route; claiming either would be the
    // invented confidence abstention exists to avoid.
    return { add: [UNSCORED], remove: [AGENT_READY, ...ALL_TYPE_LABELS, ...ROUTE_LABELS] };
  }

  const type = typeLabel(result.readiness.issueType);
  const add = [type, result.route];
  const remove = [
    UNSCORED,
    ...ALL_TYPE_LABELS.filter((label) => label !== type),
    ...ROUTE_LABELS.filter((label) => label !== result.route),
  ];

  if (result.score === 4) add.push(AGENT_READY);
  else remove.push(AGENT_READY);

  return { add, remove };
}

/** Terminal-friendly one-liner for the CLI and eval output. */
export function renderSummaryLine(result: ReadinessResult, issueNumber: number): string {
  if (result.status === 'skipped') return `#${issueNumber} skipped — ${result.reason}`;
  if (result.status === 'abstained') return `#${issueNumber} abstained — ${result.reason}`;
  return `#${issueNumber} ${result.score}/4 ${signalStrip(result.readiness)} (weakest: ${
    SIGNAL_LABELS[result.readiness.weakest]
  })`;
}
