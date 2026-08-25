import { z } from 'zod';
import { CLASSIFICATION_JSON_SCHEMA, ClassificationSchema } from './split-schema.js';

/**
 * A single rubric signal. The model returns a boolean plus its reasoning —
 * never a number. The score is derived by counting passes in code, which stops
 * the model from settling on a plausible-looking 3/4 without committing to
 * which specific signal failed.
 */
export const SignalSchema = z.object({
  pass: z.boolean(),
  why: z.string(),
});

export type Signal = z.infer<typeof SignalSchema>;

export const SIGNAL_KEYS = ['observableOutcome', 'scope', 'context', 'ambiguity'] as const;

export type SignalKey = (typeof SIGNAL_KEYS)[number];

/** Human-readable labels, used in rendered comments. */
export const SIGNAL_LABELS: Record<SignalKey, string> = {
  observableOutcome: 'outcome',
  scope: 'scope',
  context: 'context',
  ambiguity: 'ambiguity',
};

/** The rubric questions, verbatim from issue #3. */
export const SIGNAL_QUESTIONS: Record<SignalKey, string> = {
  observableOutcome: 'Would you know when this is done?',
  scope: 'Is this one change or five?',
  context: 'Are the files, repo, or reproduction steps identified?',
  ambiguity: 'Are there undefined terms doing heavy lifting?',
};

/**
 * Board taxonomy. Deliberately small and mutually exclusive — a type label is
 * only useful if you can scan a column and trust it.
 *
 * `epic` matters most: it is the signal that an issue wants /split rather than
 * an assignee, which is otherwise only discoverable by reading it.
 *
 * None of these may collide with SKIP_LABELS in rubric.ts, or the bot would
 * label an issue and then refuse to score it on the next run.
 */
export const ISSUE_TYPES = ['bug', 'feature', 'chore', 'docs', 'question', 'epic'] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

export const ReadinessSchema = z.object({
  signals: z.object({
    observableOutcome: SignalSchema,
    scope: SignalSchema,
    context: SignalSchema,
    ambiguity: SignalSchema,
  }),
  weakest: z.enum(SIGNAL_KEYS),
  suggestion: z.string(),
  issueType: z.enum(ISSUE_TYPES),
  /**
   * Same shape the /split classifier returns, so both paths feed the identical
   * asymmetric routeChild function. If the linter used its own rules, the board
   * would show one verdict and the split comment another.
   */
  routing: ClassificationSchema,
  confidence: z.enum(['high', 'low']),
  abstainReason: z.string().nullable(),
});

export type Readiness = z.infer<typeof ReadinessSchema>;

/**
 * JSON Schema mirror of ReadinessSchema for Azure OpenAI strict structured
 * outputs. Kept hand-written rather than generated: strict mode requires every
 * property to appear in `required` and `additionalProperties: false` everywhere,
 * which most zod-to-json-schema converters get subtly wrong.
 */
export const READINESS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'signals',
    'weakest',
    'suggestion',
    'issueType',
    'routing',
    'confidence',
    'abstainReason',
  ],
  properties: {
    signals: {
      type: 'object',
      additionalProperties: false,
      required: [...SIGNAL_KEYS],
      properties: Object.fromEntries(
        SIGNAL_KEYS.map((key) => [
          key,
          {
            type: 'object',
            additionalProperties: false,
            required: ['pass', 'why'],
            properties: {
              pass: { type: 'boolean', description: SIGNAL_QUESTIONS[key] },
              why: {
                type: 'string',
                description: 'One sentence of evidence, quoting the issue where possible.',
              },
            },
          },
        ]),
      ),
    },
    weakest: {
      type: 'string',
      enum: [...SIGNAL_KEYS],
      description: 'The single signal most worth fixing. Pick a failing one if any failed.',
    },
    suggestion: {
      type: 'string',
      description:
        'One concrete rewrite of the weakest part. Not a list of feedback — one thing the author can paste in.',
    },
    issueType: {
      type: 'string',
      enum: [...ISSUE_TYPES],
      description:
        'What kind of work item this is. Use epic when it is several coherent changes that ought to be split rather than assigned.',
    },
    routing: CLASSIFICATION_JSON_SCHEMA,
    confidence: {
      type: 'string',
      enum: ['high', 'low'],
      description: 'Use low when you cannot judge this issue honestly.',
    },
    abstainReason: {
      type: ['string', 'null'],
      description: 'When confidence is low, why. Otherwise null.',
    },
  },
} as const;

/** Result of scoring, after code-side derivation and gating. */
export type ReadinessResult =
  | {
      status: 'scored';
      score: number;
      readiness: Readiness;
      /** Derived in code from readiness.routing, via the same asymmetry /split uses. */
      route: 'mechanical' | 'judgement';
      routeReason: string;
      input: ScoringInput;
      promptVersion: string;
      model: string;
    }
  | {
      status: 'abstained';
      reason: string;
      input: ScoringInput;
      promptVersion: string;
      model: string;
    }
  | {
      status: 'skipped';
      reason: string;
    };

/** A path mentioned in the issue body, checked against the real git tree. */
export type VerifiedPath = {
  path: string;
  exists: boolean;
};

export type TreeContext = {
  treeSha: string;
  topLevelPaths: string[];
  /** True when the repo exceeded the trees API entry limit. */
  treeTruncated: boolean;
};

export type ScoringInput = {
  repo: string;
  number: number;
  title: string;
  /** Normalized body — see normalize.ts. */
  body: string;
  labels: string[];
  attachments: {
    images: number;
    links: string[];
  };
  /** Body was cut for length. */
  truncated: boolean;
  sections: Record<string, string>;
  /** Sections the author skipped, rendered by GitHub as `_No response_`. */
  emptySections: string[];
  paths: VerifiedPath[];
  topLevelPaths: string[];
  treeSha: string | null;
  treeTruncated: boolean;
};
