/**
 * Renders the /split parent summary from a synthetic plan, without calling a model.
 *
 * The summary comment is where a team meets the routing decision, so it is worth
 * reading before the demo. It has to make the classification legible and the
 * override obvious — being wrong here is the interesting failure.
 *
 *   npx tsx scripts/preview-split.ts
 */
import {
  renderChildBody,
  renderSplitRefusal,
  renderSplitSummary,
  routeChild,
  type ClassifiedChild,
  type Classification,
  type ScoringInput,
} from '@dispatch/core';

const input: ScoringInput = {
  repo: 'acme/widgetworks',
  number: 12,
  title: 'Modernise the settings page',
  body: 'placeholder',
  labels: ['enhancement', 'epic'],
  attachments: { images: 0, links: [] },
  truncated: false,
  sections: {},
  emptySections: [],
  paths: [{ path: 'src/settings', exists: true }],
  topLevelPaths: ['src/', 'docs/'],
  treeSha: 'a1b2c3d4e5f6',
  treeTruncated: false,
};

function child(
  title: string,
  body: string,
  touches: string[],
  classification: Classification,
  missingPaths: string[] = [],
  number?: number,
  assigned?: boolean,
): ClassifiedChild {
  const { route, routeReason } = routeChild(classification, missingPaths);
  return {
    draft: { title, body, touches },
    classification,
    route,
    routeReason,
    missingPaths,
    number,
    url: number ? `https://github.com/acme/widgetworks/issues/${number}` : undefined,
    assigned,
  };
}

const clean: Classification = {
  outcomeFullyDetermined: true,
  diffVerifiableWithoutOpinion: true,
  requiresTaste: false,
  reasoning: 'a named substitution with no decisions left open',
  confidence: 'high',
};

const tasteful: Classification = {
  outcomeFullyDetermined: false,
  diffVerifiableWithoutOpinion: false,
  requiresTaste: true,
  reasoning: 'the new layout has to be chosen, which is a design decision',
  confidence: 'high',
};

const unsure: Classification = {
  outcomeFullyDetermined: true,
  diffVerifiableWithoutOpinion: true,
  requiresTaste: false,
  reasoning: 'looks mechanical, but "consistent spacing" may hide a judgement',
  confidence: 'low',
};

const children: ClassifiedChild[] = [
  child(
    'Rename settings field props to match the design system API',
    'Rename `label` to `fieldLabel` and `hint` to `helperText` across `src/settings/fields.js`, updating call sites in `src/settings/panel.js`.\n\nDone when: no occurrence of the old prop names remains under `src/settings/` and `npm test` passes.',
    ['src/settings/fields.js', 'src/settings/panel.js'],
    clean,
    [],
    13,
    true,
  ),
  child(
    'Decide and document the new settings page layout',
    'Produce the layout for the four settings sections, deciding grouping, ordering and responsive breakpoints.\n\nDone when: a layout is agreed and captured in `docs/settings-layout.md`.',
    ['docs/settings-layout.md'],
    tasteful,
    [],
    14,
  ),
  child(
    'Extract the settings form state into a reducer',
    'Replace the ad-hoc state spread in `handleSettingsSubmit` with a reducer.\n\nDone when: state transitions go through the reducer and existing tests pass.',
    ['src/settings/panel.js'],
    unsure,
    [],
    15,
  ),
  child(
    'Add keyboard navigation to the settings section tabs',
    'Support arrow-key movement between section tabs following the WAI-ARIA tabs pattern.\n\nDone when: arrow keys move focus, Home and End jump to first and last, and focus is visible.',
    ['src/settings/tabs.js'],
    clean,
    ['src/settings/tabs.js'],
    16,
  ),
];

const plan = {
  status: 'planned' as const,
  summary:
    'Cut along the mechanical/judgement seam rather than by file: the prop renames and the reducer extraction are determined by the existing code, while the layout and the accessibility review need a person.',
  children,
  input,
};

console.log('═'.repeat(78));
console.log('  PARENT SUMMARY COMMENT');
console.log('═'.repeat(78));
console.log('');
console.log(renderSplitSummary(plan, { dryRun: false, copilotAvailable: true }));

console.log('');
console.log('═'.repeat(78));
console.log('  WHEN THE COPILOT AGENT IS NOT AVAILABLE');
console.log('═'.repeat(78));
console.log('');
console.log(
  renderSplitSummary(plan, { dryRun: false, copilotAvailable: false })
    .split('\n')
    .slice(0, 14)
    .join('\n'),
);

console.log('');
console.log('═'.repeat(78));
console.log('  A CHILD ISSUE BODY (mechanical)');
console.log('═'.repeat(78));
console.log('');
console.log(renderChildBody(children[0]!, 12, 'Modernise the settings page'));

console.log('');
console.log('═'.repeat(78));
console.log('  REFUSAL — too vague to split');
console.log('═'.repeat(78));
console.log('');
console.log(
  renderSplitRefusal(
    'The issue asks to "make the dashboard faster" without naming a route, a measurement, or a target. Any decomposition I produced would be me inventing the requirements.',
  ),
);

console.log('');
console.log('─'.repeat(78));
console.log('Routing check:');
for (const item of children) {
  console.log(`  ${item.route.padEnd(10)} ${item.draft.title}`);
  console.log(`  ${' '.repeat(10)} ${item.routeReason}`);
}
console.log('');
console.log('Note the fourth item: the classifier called it clean, but the path it');
console.log('names does not exist, so it went to a human anyway. That precedence is');
console.log('the safety property — code overrules the model, never the other way.');
