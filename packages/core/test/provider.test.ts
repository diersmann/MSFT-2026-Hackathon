import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { isReasoningDeployment, modelConfigured, provider } from '../src/azure.js';

const KEYS = [
  'MODEL_PROVIDER',
  'OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'DISPATCH_REASONING_DEPLOYMENTS',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('no credentials means no provider', () => {
  assert.equal(provider(), undefined);
  assert.equal(modelConfigured(), false);
});

test('an OpenAI key selects the openai provider', () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  assert.equal(provider(), 'openai');
  assert.equal(modelConfigured(), true);
});

test('azure is selected from endpoint and key together', () => {
  process.env.AZURE_OPENAI_ENDPOINT = 'https://r.openai.azure.com';
  process.env.AZURE_OPENAI_API_KEY = 'k';
  assert.equal(provider(), 'azure');
  assert.equal(modelConfigured(), true);
});

/** Half-configured Azure should not look ready; it would fail at call time. */
test('a partial azure config selects nothing', () => {
  process.env.AZURE_OPENAI_ENDPOINT = 'https://r.openai.azure.com';
  assert.equal(provider(), undefined);
  assert.equal(modelConfigured(), false);
});

test('MODEL_PROVIDER overrides auto-detection', () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.AZURE_OPENAI_ENDPOINT = 'https://r.openai.azure.com';
  process.env.AZURE_OPENAI_API_KEY = 'k';
  process.env.MODEL_PROVIDER = 'azure';
  assert.equal(provider(), 'azure');
});

test('reasoning detection covers the o-series and gpt-5, not gpt-4o', () => {
  assert.equal(isReasoningDeployment('o4-mini'), true);
  assert.equal(isReasoningDeployment('gpt-5.6-luna'), true);
  assert.equal(isReasoningDeployment('gpt-4o-mini'), false);
  assert.equal(isReasoningDeployment('gpt-4o'), false);
});

test('DISPATCH_REASONING_DEPLOYMENTS overrides the name heuristic', () => {
  process.env.DISPATCH_REASONING_DEPLOYMENTS = 'planner, scorer';
  assert.equal(isReasoningDeployment('planner'), true);
  assert.equal(isReasoningDeployment('SCORER'), true);
  assert.equal(isReasoningDeployment('other'), false);
});
