/**
 * Renders every comment variant from synthetic results, without calling a model.
 *
 * The comment is the entire product surface for issue #3 — worth reading with
 * your own eyes before spending a token, and before a contributor sees it.
 *
 *   npx tsx scripts/preview-comments.ts
 */
import {
  planLabels,
  renderComment,
  type Readiness,
  type ReadinessResult,
  type ScoringInput,
} from '@dispatch/core';

const baseInput: ScoringInput = {
  repo: 'acme/widgetworks',
  number: 42,
  title: 'Rate limit headers missing on /api/search',
  body: 'placeholder',
  labels: ['bug'],
  attachments: { images: 0, links: [] },
  truncated: false,
  sections: {},
  emptySections: [],
  paths: [],
  topLevelPaths: ['src/', 'docs/', 'tests/'],
  treeSha: 'a1b2c3d4e5f67890',
  treeTruncated: false,
};

function signal(pass: boolean, why: string) {
  return { pass, why };
}

const cases: Array<{ label: string; result: ReadinessResult }> = [
  {
    label: 'A 4/4 issue — earns the agent-ready label',
    result: {
      status: 'scored',
      score: 4,
      readiness: {
        signals: {
          observableOutcome: signal(true, '"moment no longer appears in the file" is checkable.'),
          scope: signal(true, 'One file, one mechanical substitution.'),
          context: signal(true, 'Names `src/reports/export.js` and the exact lines.'),
          ambiguity: signal(true, 'The call mapping is spelled out.'),
        },
        weakest: 'ambiguity',
        suggestion:
          'Nothing is weak here. If you want to be exhaustive, state which date format the CSV should use so a reviewer never has to check the old behaviour.',
        confidence: 'high',
        abstainReason: null,
      },
      input: {
        ...baseInput,
        title: 'Replace moment() with date-fns in src/reports/export.js',
        paths: [{ path: 'src/reports/export.js', exists: true }],
      },
      promptVersion: 'readiness-v1',
      model: 'gpt-4.1-mini',
    },
  },
  {
    label: 'A 2/4 issue — the common case',
    result: {
      status: 'scored',
      score: 2,
      readiness: {
        signals: {
          observableOutcome: signal(true, 'The header either appears or it does not.'),
          scope: signal(true, 'One endpoint, one header.'),
          context: signal(false, 'Names the route but not the handler file, so an agent must go looking.'),
          ambiguity: signal(false, '"like the rest of the API" is load-bearing and undefined.'),
        },
        weakest: 'ambiguity',
        suggestion:
          'Set `X-RateLimit-Remaining` on `/api/search` responses using the same value the other handlers compute. Done when a request to /api/search returns the header and its value matches /api/projects for the same client.',
        confidence: 'high',
        abstainReason: null,
      },
      input: baseInput,
      promptVersion: 'readiness-v1',
      model: 'gpt-4.1-mini',
    },
  },
  {
    label: 'A 0/4 issue — the canonical bad ticket',
    result: {
      status: 'scored',
      score: 0,
      readiness: {
        signals: {
          observableOutcome: signal(false, '"please fix properly" gives nothing checkable.'),
          scope: signal(false, '"broken for some users" could be one bug or several.'),
          context: signal(false, 'No files, no reproduction steps, no error output.'),
          ambiguity: signal(false, '"properly" and "some users" carry the whole requirement.'),
        },
        weakest: 'context',
        suggestion:
          'Add: which users are affected (all, or a subset with something in common), what happens instead of logging in, any error in the console or server log, and the steps you took. Even "email addresses with a plus sign get a 500 from POST /login" is enough to start.',
        confidence: 'high',
        abstainReason: null,
      },
      input: { ...baseInput, title: 'Fix the login bug', labels: ['bug'] },
      promptVersion: 'readiness-v1',
      model: 'gpt-4.1-mini',
    },
  },
  {
    label: 'A stale path — reads well, but names a file that is gone',
    result: {
      status: 'scored',
      score: 3,
      readiness: {
        signals: {
          observableOutcome: signal(true, '"the file is gone and the build passes" is checkable.'),
          scope: signal(true, 'Deleting one module and its export.'),
          context: signal(false, 'The named file does not exist at this commit.'),
          ambiguity: signal(true, 'The instruction itself is unambiguous.'),
        },
        weakest: 'context',
        suggestion:
          'This references `src/legacy/adapter-v1.js`, which I could not find in the repository. Point at the file as it exists now, or close this if the deletion already happened.',
        confidence: 'high',
        abstainReason: null,
      },
      input: {
        ...baseInput,
        title: 'Remove the unused legacy adapter in src/legacy/adapter-v1.js',
        paths: [
          { path: 'src/legacy/adapter-v1.js', exists: false },
          { path: 'src/legacy/index.js', exists: false },
        ],
      },
      promptVersion: 'readiness-v1',
      model: 'gpt-4.1-mini',
    },
  },
  {
    label: 'Abstention — no score invented',
    result: {
      status: 'abstained',
      reason: 'the issue is essentially empty — there is nothing here to judge',
      input: { ...baseInput, title: 'Bug', body: '', labels: [] },
      promptVersion: 'readiness-v1',
      model: 'gpt-4.1-mini',
    },
  },
  {
    label: 'An issue leaning on a screenshot',
    result: {
      status: 'scored',
      score: 2,
      readiness: {
        signals: {
          observableOutcome: signal(false, 'No statement of the expected result.'),
          scope: signal(true, 'One screen, one visual defect.'),
          context: signal(true, 'A screenshot and the affected route are provided.'),
          ambiguity: signal(false, '"looks wrong" is doing the work.'),
        },
        weakest: 'ambiguity',
        suggestion:
          'Describe the defect in words as well as the image: "on /settings the save button overlaps the footer below 400px width". An agent cannot see the screenshot.',
        confidence: 'high',
        abstainReason: null,
      },
      input: {
        ...baseInput,
        title: 'Settings page looks wrong on mobile',
        attachments: { images: 2, links: ['https://example.com/design'] },
      },
      promptVersion: 'readiness-v1',
      model: 'gpt-4.1-mini',
    },
  },
  {
    label: 'A skipped issue — no comment at all',
    result: {
      status: 'skipped',
      reason: '`type: idea` is not a work item — the rubric only applies to actionable work',
    },
  },
];

for (const testCase of cases) {
  const width = 78;
  console.log('');
  console.log('═'.repeat(width));
  console.log(`  ${testCase.label}`);
  console.log('═'.repeat(width));

  const comment = renderComment(testCase.result);
  if (!comment) {
    console.log('\n  (no comment posted)\n');
  } else {
    console.log('');
    console.log(comment);
    console.log('');
  }

  const plan = planLabels(testCase.result);
  const labels = [
    ...plan.add.map((l) => `+${l}`),
    ...plan.remove.map((l) => `-${l}`),
  ];
  console.log(`  labels: ${labels.length ? labels.join(' ') : '(none)'}`);
  console.log(`  chars:  ${comment?.length ?? 0}`);
}

console.log('');
console.log('Read these as a contributor would. If any of them feels like a wall of');
console.log('feedback rather than one suggestion, the prompt needs tightening, not the code.');
