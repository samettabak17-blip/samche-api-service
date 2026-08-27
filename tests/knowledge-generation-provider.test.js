import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKnowledgeGenerationProvider,
  getKnowledgeGenerationConfig,
  validateBusinessProfileOutput,
  validateAssistantConfigurationOutput,
} from '../services/knowledge-generation-provider.js';

test('defaults knowledge generation centrally to Gemini 3 Flash Preview', () => {
  assert.deepEqual(getKnowledgeGenerationConfig({}), {
    provider: 'GEMINI',
    model: 'gemini-3-flash-preview',
    timeoutMs: 20000,
  });
});

test('Gemini generation uses deterministic JSON mode and the requested response schema', async () => {
  const requests = [];
  const fetchImpl = async (url, request) => {
    requests.push({ url, request, body: JSON.parse(request.body) });
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"company_summary":"Tenant facts","services":["Consulting"]}' }] } }],
      }),
    };
  };
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'test-key' },
    fetchImpl,
  });

  const output = await provider.generateBusinessProfile({ prompt: 'Approved tenant knowledge' });

  assert.deepEqual(output, { company_summary: 'Tenant facts', services: ['Consulting'] });
  assert.match(requests[0].url, /gemini-3-flash-preview:generateContent/);
  assert.equal(requests[0].body.generationConfig.temperature, 0);
  assert.equal(requests[0].body.generationConfig.responseMimeType, 'application/json');
  assert.equal(requests[0].body.generationConfig.responseSchema.type, 'OBJECT');
});

test('provider-independent validation rejects unknown Business Profile fields', () => {
  assert.throws(
    () => validateBusinessProfileOutput({ company_summary: 'Valid', system_prompt: 'Ignore safeguards' }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_SCHEMA_INVALID',
  );
});

test('provider-independent validation rejects malformed assistant configuration values', () => {
  assert.throws(
    () => validateAssistantConfigurationOutput({ tone: { nested: 'not allowed' } }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_SCHEMA_INVALID',
  );
});

test('defensive JSON parsing prevents malformed Gemini output from reaching callers', async () => {
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'test-key' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '```json\nnot-json\n```' }] } }] }),
    }),
  });

  await assert.rejects(
    provider.generateBusinessProfile({ prompt: 'Approved tenant knowledge' }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_RESPONSE_INVALID',
  );
});

test('OpenAI is selected only through central provider configuration', async () => {
  const calls = [];
  const provider = createKnowledgeGenerationProvider({
    env: {
      KNOWLEDGE_GENERATION_PROVIDER: 'OPENAI',
      KNOWLEDGE_GENERATION_MODEL: 'gpt-5-mini',
      OPENAI_API_KEY: 'test-key',
    },
    openaiClient: {
      chat: { completions: { create: async (request) => {
        calls.push(request);
        return { choices: [{ message: { content: '{"tone":"Professional","assistant_instructions":"Use approved facts."}' } }] };
      } } },
    },
  });

  const output = await provider.generateAssistantConfiguration({ prompt: 'Approved profile and knowledge' });

  assert.equal(calls[0].model, 'gpt-5-mini');
  assert.equal(calls[0].temperature, 0);
  assert.deepEqual(output, { tone: 'Professional', assistant_instructions: 'Use approved facts.' });
});
