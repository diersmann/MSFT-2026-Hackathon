import { z } from 'zod';

/** Hard ceiling, enforced in code. Unbounded decomposition produces 30 tickets and despair. */
export const MAX_SUB_ISSUES = 8;
export const MIN_SUB_ISSUES = 3;

export const SubIssueDraftSchema = z.object({
  title: z.string(),
  body: z.string(),
  /** Paths the child is expected to touch. Verified against the tree before we trust it. */
  touches: z.array(z.string()),
});

export type SubIssueDraft = z.infer<typeof SubIssueDraftSchema>;

export const DecompositionSchema = z.object({
  summary: z.string(),
  children: z.array(SubIssueDraftSchema),
  /** Set when the parent is too vague to decompose responsibly. */
  refuseReason: z.string().nullable(),
});

export type Decomposition = z.infer<typeof DecompositionSchema>;

export const DECOMPOSITION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'children', 'refuseReason'],
  properties: {
    summary: {
      type: 'string',
      description: 'One sentence on how you cut the work up, and why along those lines.',
    },
    children: {
      type: 'array',
      description: `Between ${MIN_SUB_ISSUES} and ${MAX_SUB_ISSUES} sub-issues. Fewer, larger, coherent pieces beat many slivers.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'body', 'touches'],
        properties: {
          title: {
            type: 'string',
            description: 'Imperative and specific. No "Part 1" or "Misc".',
          },
          body: {
            type: 'string',
            description:
              'What to do, and a "Done when:" line that is checkable. Name real files where you know them.',
          },
          touches: {
            type: 'array',
            description: 'Repository paths this sub-issue is expected to change. Empty if unknown.',
            items: { type: 'string' },
          },
        },
      },
    },
    refuseReason: {
      type: ['string', 'null'],
      description:
        'Non-null when the parent is too vague to split responsibly. Splitting a vague epic just multiplies the vagueness.',
    },
  },
} as const;

export const ClassificationSchema = z.object({
  /** Outcome fully determined by the description. */
  outcomeFullyDetermined: z.boolean(),
  /** A reviewer could accept or reject the diff without an opinion. */
  diffVerifiableWithoutOpinion: z.boolean(),
  /** Design, product, naming, UX or architecture judgement required. */
  requiresTaste: z.boolean(),
  reasoning: z.string(),
  confidence: z.enum(['high', 'low']),
});

export type Classification = z.infer<typeof ClassificationSchema>;

export const CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'outcomeFullyDetermined',
    'diffVerifiableWithoutOpinion',
    'requiresTaste',
    'reasoning',
    'confidence',
  ],
  properties: {
    outcomeFullyDetermined: {
      type: 'boolean',
      description:
        'True only if two competent engineers working from this description alone would produce substantially the same diff.',
    },
    diffVerifiableWithoutOpinion: {
      type: 'boolean',
      description:
        'True only if a reviewer could accept or reject the result against the description, with no matter of taste involved.',
    },
    requiresTaste: {
      type: 'boolean',
      description:
        'True if any design, product, naming, copy, UX or architecture decision is left open.',
    },
    reasoning: { type: 'string', description: 'One sentence. Name the specific decision if any.' },
    confidence: {
      type: 'string',
      enum: ['high', 'low'],
      description: 'Use low whenever you are unsure. Low always routes to a human.',
    },
  },
} as const;

export type Route = 'mechanical' | 'judgement';

export type ClassifiedChild = {
  draft: SubIssueDraft;
  classification: Classification;
  route: Route;
  /** Why the route came out as it did, after the code-side asymmetry is applied. */
  routeReason: string;
  /** Paths from `touches` that do not exist in the tree. */
  missingPaths: string[];
  number?: number;
  url?: string;
  assigned?: boolean;
};

/**
 * The routing decision, deliberately asymmetric.
 *
 * A false "judgement" costs a human ten minutes of reading. A false "mechanical"
 * costs a confident, wrong pull request and the trust of everyone who reviews
 * it. So every uncertainty collapses toward judgement, and mechanical requires
 * all three positive conditions plus high confidence plus verified paths.
 */
export function routeChild(
  classification: Classification,
  missingPaths: string[],
): { route: Route; routeReason: string } {
  if (classification.confidence === 'low') {
    return {
      route: 'judgement',
      routeReason: 'the classifier was not confident, so a human decides',
    };
  }
  if (classification.requiresTaste) {
    return { route: 'judgement', routeReason: classification.reasoning };
  }
  if (!classification.outcomeFullyDetermined) {
    return {
      route: 'judgement',
      routeReason: 'the description leaves the outcome open to interpretation',
    };
  }
  if (!classification.diffVerifiableWithoutOpinion) {
    return {
      route: 'judgement',
      routeReason: 'the result could not be reviewed without a matter of opinion',
    };
  }
  if (missingPaths.length > 0) {
    return {
      route: 'judgement',
      routeReason: `references ${missingPaths.join(', ')}, which I could not find in the repository`,
    };
  }
  return { route: 'mechanical', routeReason: classification.reasoning };
}
