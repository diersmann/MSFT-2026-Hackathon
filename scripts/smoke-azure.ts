/**
 * Discovers what your Azure OpenAI resource actually exposes, then proves
 * strict structured output works on each configured deployment.
 *
 * Deployment names are chosen per-resource and rarely match model names, so
 * guessing them wastes a lot of time. Run this first.
 *
 *   npm run smoke
 */
import 'dotenv/config';
import {
  azureConfigured,
  callJson,
  deploymentFor,
  isReasoningDeployment,
  type Task,
} from '@dispatch/core';

const TASKS: Task[] = ['score', 'decompose', 'classify'];

const PROBE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'note'],
  properties: {
    ok: { type: 'boolean' },
    note: { type: 'string' },
  },
} as const;

async function listDeployments(): Promise<void> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '');
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!endpoint || !apiKey) return;

  // The data-plane /models route reflects what this key can actually reach.
  // The control-plane deployment list needs ARM credentials we deliberately
  // do not ask for.
  const url = `${endpoint}/openai/models?api-version=${
    process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21'
  }`;

  try {
    const res = await fetch(url, { headers: { 'api-key': apiKey } });
    if (!res.ok) {
      console.log(`  (could not list models: HTTP ${res.status})`);
      return;
    }
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const rows = (json.data ?? [])
      .map((m) => ({
        id: String(m.id ?? ''),
        status: String((m as { status?: unknown }).status ?? ''),
      }))
      .filter((m) => m.id);

    if (!rows.length) {
      console.log('  (no models returned)');
      return;
    }
    for (const row of rows.slice(0, 40)) {
      console.log(`  ${row.id}${row.status ? ` [${row.status}]` : ''}`);
    }
    if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more`);
  } catch (error) {
    console.log(`  (could not list models: ${(error as Error).message})`);
  }
}

async function main(): Promise<void> {
  console.log('Azure OpenAI smoke test\n');

  if (!azureConfigured()) {
    console.error('AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY must be set.');
    console.error('Copy .env.example to .env and fill them in.');
    process.exit(1);
  }

  console.log(`Endpoint:    ${process.env.AZURE_OPENAI_ENDPOINT}`);
  console.log(`API version: ${process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21 (default)'}\n`);

  console.log('Models reachable with this key:');
  await listDeployments();
  console.log('');

  let failures = 0;

  for (const task of TASKS) {
    let deployment: string;
    try {
      deployment = deploymentFor(task);
    } catch {
      console.log(`${task.padEnd(10)} not configured — skipping`);
      continue;
    }

    const kind = isReasoningDeployment(deployment) ? 'reasoning' : 'standard';
    process.stdout.write(`${task.padEnd(10)} ${deployment} (${kind}) ... `);

    try {
      const result = await callJson({
        task,
        system: 'You verify API connectivity. Reply with ok=true.',
        user: 'Reply with ok=true and a three-word note.',
        schemaName: 'probe',
        schema: PROBE_SCHEMA,
        maxTokens: 100,
        seed: 7,
      });
      const parsed = result as { ok?: boolean; note?: string };
      if (parsed.ok === true) {
        console.log(`OK — strict json_schema works ("${parsed.note ?? ''}")`);
      } else {
        console.log(`responded but ok !== true: ${JSON.stringify(result)}`);
        failures += 1;
      }
    } catch (error) {
      console.log(`FAILED — ${(error as Error).message}`);
      failures += 1;
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(
      `${failures} deployment(s) failed. Fix MODEL_SCORE / MODEL_DECOMPOSE / MODEL_CLASSIFY in .env`,
    );
    console.log('to match names from the list above, then re-run.');
    process.exit(1);
  }
  console.log('All configured deployments work with strict structured output.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
