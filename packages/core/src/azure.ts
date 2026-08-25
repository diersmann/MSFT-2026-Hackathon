import { AzureOpenAI } from 'openai';

export type Task = 'score' | 'decompose' | 'classify';

const ENV_BY_TASK: Record<Task, string> = {
  score: 'MODEL_SCORE',
  decompose: 'MODEL_DECOMPOSE',
  classify: 'MODEL_CLASSIFY',
};

export class MissingCredentialsError extends Error {
  constructor(missing: string[]) {
    super(`Missing Azure OpenAI configuration: ${missing.join(', ')}`);
    this.name = 'MissingCredentialsError';
  }
}

export function azureConfigured(): boolean {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
}

export function deploymentFor(task: Task): string {
  const envKey = ENV_BY_TASK[task];
  const value = process.env[envKey];
  if (!value) throw new MissingCredentialsError([envKey]);
  return value;
}

export function createClient(): AzureOpenAI {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const missing: string[] = [];
  if (!endpoint) missing.push('AZURE_OPENAI_ENDPOINT');
  if (!apiKey) missing.push('AZURE_OPENAI_API_KEY');
  if (missing.length) throw new MissingCredentialsError(missing);

  return new AzureOpenAI({
    endpoint,
    apiKey,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
  });
}

/**
 * Reasoning models (o1/o3/o4/gpt-5 family) reject `temperature` and `seed`
 * outright rather than ignoring them, and they use `max_completion_tokens`
 * instead of `max_tokens`. Deployment names are arbitrary, so this is a
 * heuristic on the name — override with DISPATCH_REASONING_DEPLOYMENTS if your
 * Azure resource uses names this cannot see through.
 */
export function isReasoningDeployment(deployment: string): boolean {
  const explicit = process.env.DISPATCH_REASONING_DEPLOYMENTS;
  if (explicit) {
    const names = explicit
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    if (names.includes(deployment.toLowerCase())) return true;
  }
  return /(^|[^a-z])(o[1345]|gpt-5)([^a-z]|$)/i.test(deployment);
}

export type JsonCallOptions = {
  task: Task;
  system: string;
  user: string;
  schemaName: string;
  schema: unknown;
  maxTokens?: number;
  /** Deterministic sampling. Silently dropped for reasoning deployments. */
  seed?: number;
};

/**
 * One strict-JSON chat completion. Returns the raw parsed JSON; callers
 * validate with zod so a schema drift surfaces as a typed error rather than
 * an `any` leaking through the codebase.
 */
export async function callJson(options: JsonCallOptions): Promise<unknown> {
  const client = createClient();
  const deployment = deploymentFor(options.task);
  const reasoning = isReasoningDeployment(deployment);

  const body: Record<string, unknown> = {
    model: deployment,
    messages: [
      { role: reasoning ? 'developer' : 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: options.schemaName,
        strict: true,
        schema: options.schema,
      },
    },
  };

  const maxTokens = options.maxTokens ?? 2000;
  if (reasoning) {
    // Reasoning tokens are billed against this ceiling too, so leave headroom
    // or the response comes back truncated with an empty content string.
    body.max_completion_tokens = Math.max(maxTokens, 8000);
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0;
    if (options.seed !== undefined) body.seed = options.seed;
  }

  const response = await client.chat.completions.create(
    body as unknown as Parameters<typeof client.chat.completions.create>[0],
  );

  const completion = response as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Deployment "${deployment}" returned an empty completion`);
  }

  return JSON.parse(content);
}
