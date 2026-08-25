import { z } from 'zod';

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

export const ReadinessSchema = z.object({
  signals: z.object({
    observableOutcome: SignalSchema,
    scope: SignalSchema,
    context: SignalSchema,
    ambiguity: SignalSchema,
  }),
  weakest: z.enum(SIGNAL_KEYS),
  suggestion: z.string(),
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
  required: ['signals', 'weakest', 'suggestion', 'confidence', 'abstainReason'],
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
