import type { ClassifiedChild } from './split-schema.js';
import { COPILOT_LOGIN, type SplitPlan } from './split.js';

export const SPLIT_MARKER = '<!-- dispatch:split -->';

function routeIcon(child: ClassifiedChild): string {
  return child.route === 'mechanical' ? '🤖' : '🧑';
}

/**
 * The parent summary. Two things it must do beyond listing children: show why
 * each classification came out as it did, and make overriding trivial.
 *
 * The classify step is the risky one — an agent that assigns itself a design
 * decision produces a confident, wrong PR. Visible reasoning plus a one-line
 * override is what keeps a human in the loop without slowing anything down.
 */
export function renderSplitSummary(
  plan: Extract<SplitPlan, { status: 'planned' }>,
  options: { dryRun: boolean; copilotAvailable: boolean },
): string {
  const mechanical = plan.children.filter((c) => c.route === 'mechanical');
  const judgement = plan.children.filter((c) => c.route === 'judgement');

  const lines: string[] = [
    SPLIT_MARKER,
    '',
    `**Split into ${plan.children.length} sub-issues** — ${mechanical.length} mechanical, ${judgement.length} for humans.`,
    '',
    plan.summary,
    '',
  ];

  if (options.dryRun) {
    lines.push('> Dry run — nothing was created or assigned.', '');
  }

  lines.push('| | Sub-issue | Route | Why |', '| --- | --- | --- | --- |');
  for (const child of plan.children) {
    const ref = child.number ? `#${child.number}` : child.draft.title;
    const why = child.routeReason.replace(/\|/g, '\\|');
    lines.push(`| ${routeIcon(child)} | ${ref} | ${child.route} | ${why} |`);
  }

  if (mechanical.length) {
    lines.push('');
    if (options.copilotAvailable) {
      const assigned = mechanical.filter((c) => c.assigned);
      if (assigned.length) {
        lines.push(
          `Assigned to \`${COPILOT_LOGIN}\`: ${assigned.map((c) => `#${c.number}`).join(', ')}.`,
        );
      }
      const failed = mechanical.filter((c) => c.number && !c.assigned);
      if (failed.length) {
        lines.push(
          `Could not assign ${failed.map((c) => `#${c.number}`).join(', ')} — assign manually if you want the agent on them.`,
        );
      }
    } else {
      lines.push(
        `The Copilot coding agent is not available as an assignee in this repository, so the mechanical items are labelled but unassigned.`,
      );
    }
  }

  const stale = plan.children.filter((c) => c.missingPaths.length > 0);
  if (stale.length) {
    lines.push('');
    lines.push('**Paths I could not find:**');
    for (const child of stale) {
      const ref = child.number ? `#${child.number}` : child.draft.title;
      lines.push(`- ${ref} — ${child.missingPaths.map((p) => `\`${p}\``).join(', ')}`);
    }
    lines.push('');
    lines.push('These were routed to humans regardless of how mechanical they looked.');
  }

  lines.push(
    '',
    '<details><summary>How the routing works, and how to override it</summary>',
    '',
    'An item is only `mechanical` when all of the following hold: the outcome is fully determined by the description, the resulting diff could be reviewed without a matter of opinion, no design or naming decision is left open, the classifier was confident, and every path it names exists.',
    '',
    'Anything else goes to a human. That asymmetry is deliberate — a wrongly-human item costs someone ten minutes, a wrongly-agent item costs a confident pull request that embodies a decision nobody made.',
    '',
    'To override, comment:',
    '',
    '```',
    '/split reclassify #123 judgement',
    '/split reclassify #123 mechanical',
    '```',
    '',
    '</details>',
    '',
    `<sub>Every classification is a guess and one click from wrong. <code>split-v1</code></sub>`,
  );

  return lines.join('\n');
}

export function renderSplitRefusal(reason: string): string {
  return [
    SPLIT_MARKER,
    '',
    "**I didn't split this.**",
    '',
    reason,
    '',
    'Splitting a vague issue into several vague issues multiplies the problem while looking productive. Sharpen the parent first — the readiness comment above is a place to start — then comment `/split` again.',
    '',
    '<sub>Advisory only. Nothing was created.</sub>',
  ].join('\n');
}

export function renderChildBody(
  child: ClassifiedChild,
  parentNumber: number,
  parentTitle: string,
): string {
  const lines = [child.draft.body.trim(), '', '---', ''];

  if (child.draft.touches.length) {
    lines.push(`Expected to touch: ${child.draft.touches.map((p) => `\`${p}\``).join(', ')}`);
    lines.push('');
  }

  lines.push(
    `Split out of #${parentNumber} (${parentTitle}).`,
    '',
    `Routed **${child.route}**: ${child.routeReason}`,
    '',
    `<sub>Classified automatically. If this is wrong, comment \`/split reclassify\` on the parent — being wrong here is the interesting failure, so we would rather hear about it.</sub>`,
  );

  return lines.join('\n');
}
