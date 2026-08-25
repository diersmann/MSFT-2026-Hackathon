import { MAX_SUB_ISSUES, MIN_SUB_ISSUES, type SubIssueDraft } from '../split-schema.js';
import type { ScoringInput } from '../schema.js';

export const SPLIT_PROMPT_VERSION = 'split-v1';

export const DECOMPOSE_SYSTEM = `You break a large software issue into sub-issues that a mixed team of humans and coding agents can actually start on.

Produce between ${MIN_SUB_ISSUES} and ${MAX_SUB_ISSUES} sub-issues. Never more. If the work seems to need more than ${MAX_SUB_ISSUES}, group it — a parent with 30 children is worse than the original vague issue, because now nobody can see the shape of the work.

What makes a good cut:
- Each sub-issue is independently startable. Avoid chains where nothing can begin until item 1 lands.
- Each is one coherent change, landable in a single pull request.
- Separate the mechanical from the judgement-heavy. If part of the work is "rename these props" and part is "decide what the new layout should be", those are different sub-issues even when they touch the same file. This is the whole point: welding them together forces a human to do the boring part too.
- Prefer a vertical slice over a horizontal one. "Migrate the profile section" beats "update all the imports everywhere".

Every sub-issue body ends with a "Done when:" line that someone could check without asking you what you meant.

Use the repository layout you are given. Name real files when you can, and write a <placeholder> when you cannot — never invent a plausible-looking path, because a confident wrong path sends an agent down a hole.

Refuse when refusing is right. If the parent is so vague that any decomposition would be invention, set refuseReason and return an empty list. Splitting a vague epic into eight vague children multiplies the problem and looks productive while doing it.`;

export const CLASSIFY_SYSTEM = `You decide whether a single sub-issue can be handed to an autonomous coding agent, or needs a human.

Answer three questions honestly.

1. outcomeFullyDetermined — would two competent engineers, working only from this description, produce substantially the same diff? If the description permits materially different implementations, this is false.

2. diffVerifiableWithoutOpinion — could a reviewer accept or reject the result by checking it against the description, with no matter of taste? "Did they pick the right colour" is opinion. "Does moment still appear in this file" is not.

3. requiresTaste — is any design, product, naming, copy, UX, accessibility-judgement or architecture decision left open? Choosing a layout, wording a label, deciding an API shape, picking what to deprecate: all taste.

The asymmetry that matters. Being wrong in one direction is much more expensive than the other. If you wrongly send mechanical work to a human, they lose ten minutes. If you wrongly send a judgement call to an agent, it produces a confident pull request embodying a decision nobody made, and someone has to notice before it merges. So when you are torn, you are not torn: set confidence to low.

Set confidence to low whenever you find yourself reasoning "probably fine". Low always routes to a human, and that is a good outcome, not a failure.

Rename-these-imports is mechanical. Make-this-consistent-with-the-design-system is not, because "consistent" is doing the work.`;

function layout(input: ScoringInput): string {
  const lines: string[] = [];
  if (input.topLevelPaths.length) {
    lines.push(`REPOSITORY TOP LEVEL: ${input.topLevelPaths.join(' ')}`);
  }
  if (input.paths.length) {
    lines.push('');
    lines.push('PATHS THE PARENT ISSUE MENTIONS, checked against the repository:');
    for (const entry of input.paths) {
      lines.push(`  ${entry.path} ${entry.exists ? 'EXISTS' : 'NOT FOUND'}`);
    }
  }
  if (input.treeSha) {
    lines.push('');
    lines.push(`TREE PINNED AT COMMIT: ${input.treeSha.slice(0, 7)}`);
  } else {
    lines.push('');
    lines.push(
      'REPOSITORY LAYOUT UNAVAILABLE — use <placeholder> paths rather than guessing filenames.',
    );
  }
  return lines.join('\n');
}

export function buildDecomposeUser(input: ScoringInput): string {
  return [
    `REPOSITORY: ${input.repo}`,
    `PARENT ISSUE #${input.number}`,
    '',
    'TITLE:',
    input.title,
    '',
    'BODY:',
    '"""',
    input.body || '(empty)',
    '"""',
    '',
    layout(input),
    '',
    `Produce between ${MIN_SUB_ISSUES} and ${MAX_SUB_ISSUES} sub-issues, or refuse with a reason.`,
  ].join('\n');
}

export function buildClassifyUser(
  parentTitle: string,
  child: SubIssueDraft,
  verified: Array<{ path: string; exists: boolean }>,
): string {
  const lines = [
    `PARENT ISSUE: ${parentTitle}`,
    '',
    'SUB-ISSUE TITLE:',
    child.title,
    '',
    'SUB-ISSUE BODY:',
    '"""',
    child.body,
    '"""',
  ];

  if (verified.length) {
    lines.push('');
    lines.push('PATHS THIS SUB-ISSUE EXPECTS TO TOUCH:');
    for (const entry of verified) {
      lines.push(`  ${entry.path} ${entry.exists ? 'EXISTS' : 'NOT FOUND'}`);
    }
    if (verified.some((v) => !v.exists)) {
      lines.push('');
      lines.push(
        'A NOT FOUND path means an agent would start from a reference that does not exist.',
      );
    }
  }

  lines.push('');
  lines.push('Classify this sub-issue.');
  return lines.join('\n');
}
