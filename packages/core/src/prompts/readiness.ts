import { SIGNAL_QUESTIONS, type ScoringInput } from '../schema.js';

/**
 * Bump on any wording change. Stamped into the rendered comment and the score
 * record, so the dashboard can tell which rubric version produced a number and
 * a prompt edit does not silently invalidate historical scores.
 */
export const PROMPT_VERSION = 'readiness-v2';

export const READINESS_SYSTEM = `You judge whether a software issue is ready to be handed to an autonomous coding agent.

You are not judging whether the issue is important, well-written, or polite. You are judging one thing: if a competent coding agent picked this up right now with no chance to ask a follow-up question, would it produce the change the author actually wanted?

Score four signals independently. Each is a pass/fail.

1. observableOutcome — ${SIGNAL_QUESTIONS.observableOutcome}
   Pass when the finished state is checkable. Acceptance criteria, expected behaviour, a concrete before/after.
   Fail when "done" is a matter of opinion.

2. scope — ${SIGNAL_QUESTIONS.scope}
   Pass when this is one coherent change an agent could land in a single pull request.
   Fail when it bundles several independent changes, or is an epic wearing a task's clothes.

3. context — ${SIGNAL_QUESTIONS.context}
   Pass when an agent would know where to start: named files or directories, reproduction steps, error output, a link to the relevant code.
   Fail when it would have to search the repo and guess.

4. ambiguity — ${SIGNAL_QUESTIONS.ambiguity}
   Pass when the load-bearing terms are defined or obvious from context.
   Fail when words like "properly", "clean up", "modernise", "the new design", or "like we discussed" carry the actual requirement.

Then pick the single weakest signal and write ONE concrete rewrite of that part. Rules for the suggestion:
- Address the weakest signal only. Not a list. Not a summary of everything wrong.
- Make it paste-able: write the replacement text, do not describe what the author should think about.
- Two or three sentences. If the issue is already strong, suggest the smallest sharpening that would help an agent.
- Never invent facts about the codebase. If you need a filename you do not have, write a placeholder like <path/to/file>.

Also classify the issue two ways, independently of the score.

issueType — what kind of work item this is:
  bug      something is broken and should behave differently
  feature  new capability or behaviour
  chore    maintenance, dependencies, cleanup, tooling, tests
  docs     documentation only
  question support or a request for information, not work
  epic     several coherent changes bundled together; wants /split rather than an assignee
Pick epic whenever the scope signal failed because the issue bundles independent changes. An epic is not a bad issue, it is a wrongly-shaped one.

routing — whether a coding agent could safely take this as-is. Judge the work itself, not how well it is written:
  outcomeFullyDetermined       two competent engineers working from this alone would produce substantially the same diff
  diffVerifiableWithoutOpinion a reviewer could accept or reject the result without a matter of taste
  requiresTaste                any design, product, naming, copy, UX or architecture decision is left open
  confidence                   low whenever you are unsure
Set confidence to low when you cannot tell. Being wrong toward "a human should look" costs someone ten minutes; being wrong the other way costs a confident, wrong pull request. Never guess in the agent's favour.

Honesty rule. Set confidence to "low" and explain why in abstainReason when you genuinely cannot judge — the body is empty or near-empty, it is in a language you cannot read, it is a template with nothing filled in, or it is not a software work item at all. A refusal is more useful than an invented number. Do not use "low" merely because the issue is bad: a confidently bad issue scores 0 or 1 with high confidence.

Evidence rule. Every "why" cites something in the issue. Quote a short phrase where you can. Never justify a verdict with something the issue does not say.`;

/**
 * Calibration anchors. These are what keep scores stable across prompt edits —
 * without them, small wording changes silently shift the whole distribution and
 * the eval harness measures noise.
 */
const ANCHORS = `Calibration examples.

--- EXAMPLE A: score 0/4 ---
TITLE: Fix the login bug
BODY: Login is broken for some users, please fix properly.
VERDICT:
  observableOutcome FAIL — "please fix properly" gives nothing checkable.
  scope FAIL — "broken for some users" could be one bug or several.
  context FAIL — no files, no repro, no error text, no affected users named.
  ambiguity FAIL — "properly" and "some users" carry the whole requirement.
  weakest: context
  issueType: bug
  routing: outcomeFullyDetermined false, diffVerifiableWithoutOpinion false, requiresTaste false, confidence high
  confidence: high (it is clearly a software issue, it is just a bad one)

--- EXAMPLE B: score 2/4 ---
TITLE: Rate limit headers missing on /api/search
BODY: The /api/search endpoint does not return X-RateLimit-Remaining, unlike our other endpoints. Should behave like the rest of the API.
VERDICT:
  observableOutcome PASS — the header either appears or it does not.
  scope PASS — one endpoint, one header.
  context FAIL — names the route but not the handler file; an agent must go looking.
  ambiguity FAIL — "like the rest of the API" is load-bearing and undefined; which headers, computed how?
  weakest: ambiguity
  issueType: bug
  routing: outcomeFullyDetermined false, diffVerifiableWithoutOpinion true, requiresTaste false, confidence high
  confidence: high

--- EXAMPLE C: score 4/4 ---
TITLE: Replace deprecated moment() calls in src/reports/export.ts with date-fns
BODY: src/reports/export.ts still imports moment (lines 12, 48, 96). Swap each call for the date-fns equivalent already used elsewhere in src/reports/. formatDate(d) becomes format(d, 'yyyy-MM-dd'). Done when: moment no longer appears in the file, npm test passes, and exported CSV dates are unchanged.
VERDICT:
  observableOutcome PASS — "moment no longer appears", tests pass, output unchanged.
  scope PASS — one file, one mechanical substitution.
  context PASS — exact file, exact lines, the pattern to follow.
  ambiguity PASS — the mapping is spelled out.
  weakest: ambiguity (nothing is actually weak; pick the least strong)
  issueType: chore
  routing: outcomeFullyDetermined true, diffVerifiableWithoutOpinion true, requiresTaste false, confidence high
  confidence: high

--- EXAMPLE D: an epic ---
TITLE: Migrate the settings page to the new design system
BODY: Settings still uses the old components. Rename the props, update the imports, regenerate the snapshots, and decide the new spacing scale while we are in there.
VERDICT:
  observableOutcome FAIL — "the new design system" has no checkable finish line.
  scope FAIL — four independent changes, one of which is a design decision.
  context PASS — names the settings page.
  ambiguity FAIL — "the new design system" and "the new spacing scale" are undefined.
  weakest: scope
  issueType: epic
  routing: outcomeFullyDetermined false, diffVerifiableWithoutOpinion false, requiresTaste true, confidence high
  confidence: high`;

function renderGrounding(input: ScoringInput): string {
  const lines: string[] = [];

  if (input.paths.length > 0) {
    lines.push('PATHS MENTIONED IN THIS ISSUE, checked against the repository:');
    const width = Math.max(...input.paths.map((p) => p.path.length));
    for (const entry of input.paths) {
      lines.push(`  ${entry.path.padEnd(width)}  ${entry.exists ? 'EXISTS' : 'NOT FOUND'}`);
    }
    if (input.paths.some((p) => !p.exists)) {
      lines.push('');
      lines.push(
        'A NOT FOUND path means the issue references code that does not exist at this commit.',
      );
      lines.push(
        'Treat that as worse than naming nothing: an agent would act on a stale reference.',
      );
      lines.push('Fail context when a load-bearing path does not exist, and say so in "why".');
    }
  } else {
    lines.push('PATHS MENTIONED IN THIS ISSUE: none detected.');
  }

  if (input.topLevelPaths.length > 0) {
    lines.push('');
    lines.push(`REPOSITORY TOP LEVEL: ${input.topLevelPaths.join(' ')}`);
  }
  if (input.treeSha) {
    lines.push(`TREE PINNED AT COMMIT: ${input.treeSha.slice(0, 7)}`);
  } else {
    lines.push('');
    lines.push(
      'REPOSITORY TREE UNAVAILABLE — judge context from the text alone, and do not assume a named path is wrong.',
    );
  }

  return lines.join('\n');
}

function renderLimits(input: ScoringInput): string {
  const notes: string[] = [
    'You are scoring the issue description only, not the comment thread. That is what a coding agent reads.',
  ];

  if (input.attachments.images > 0) {
    notes.push(
      `${input.attachments.images} image attachment(s) are present but you cannot view them. Do not fail context solely because an image is unviewable — but do note that the issue leans on an image if the text alone is insufficient.`,
    );
  }
  if (input.attachments.links.length > 0) {
    notes.push(
      `${input.attachments.links.length} link(s) are present but you cannot follow them. A link is weaker context than inline detail.`,
    );
  }
  if (input.truncated) {
    notes.push('The body was truncated for length. Judge only what you can see.');
  }
  if (input.emptySections.length > 0) {
    notes.push(
      `The author left these template sections empty: ${input.emptySections.join('; ')}. An empty "how will you know it's done" section is strong evidence against observableOutcome.`,
    );
  }
  if (input.treeTruncated) {
    notes.push(
      'The repository tree was too large to list fully, so a NOT FOUND verdict is less reliable than usual.',
    );
  }

  return notes.map((note) => `- ${note}`).join('\n');
}

export function buildReadinessUser(input: ScoringInput): string {
  const parts: string[] = [
    ANCHORS,
    '',
    'Now score this issue.',
    '',
    `REPOSITORY: ${input.repo}`,
    `LABELS: ${input.labels.length ? input.labels.join(', ') : '(none)'}`,
    '',
    'TITLE:',
    input.title || '(empty)',
    '',
    'BODY:',
    '"""',
    input.body || '(empty)',
    '"""',
    '',
    renderGrounding(input),
    '',
    'WHAT YOU CANNOT SEE:',
    renderLimits(input),
  ];

  return parts.join('\n');
}
