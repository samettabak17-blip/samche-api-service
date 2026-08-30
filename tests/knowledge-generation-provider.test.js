import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKnowledgeGenerationProvider,
  getKnowledgeGenerationConfig,
  validateBusinessProfileOutput,
  validateAssistantRecommendationOutput,
  validateAssistantConfigurationOutput,
  buildRecommendationResponseSchema,
} from '../services/knowledge-generation-provider.js';

test('defaults knowledge generation centrally to Gemini 3 Flash Preview', () => {
  assert.deepEqual(getKnowledgeGenerationConfig({}), {
    provider: 'GEMINI',
    model: 'gemini-3-flash-preview',
    timeoutMs: 20000,
  });
});

test('Business Profile V2 accepts source-derived tenant facts without a platform persona default', () => {
  const output = validateBusinessProfileOutput({
    schema_version: 2,
    company_identity: 'Meridian Arc Technologies LLC',
    company_display_name: 'Meridian Arc',
    packages: ['Growth Accelerator Package'],
    communication_style: 'Clear and technical',
    customer_handling: 'Confirm the requested support tier before advising.',
    supported_languages: ['English'],
    unsupported_claims: ['Do not claim 24-hour support.'],
  });
  assert.equal(output.company_identity, 'Meridian Arc Technologies LLC');
  assert.equal(output.schema_version, 2);
});

test('Assistant recommendation and final configuration have separate V2 contracts', () => {
  const recommendation = validateAssistantRecommendationOutput({
    schema_version: 2,
    assistant_identity: 'Meridian Client Advisor',
    role_and_purpose: 'Recommend a reviewed support workflow.',
    recommendation_rationale: 'The approved profile describes enterprise support.',
    evidence_gaps: ['No scheduled messaging timing is documented.'],
  });
  assert.equal(recommendation.recommendation_rationale, 'The approved profile describes enterprise support.');
  assert.throws(
    () => validateAssistantConfigurationOutput({ ...recommendation }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_SCHEMA_INVALID',
  );
});

test('Assistant Configuration V2 supports tenant behavior without accepting platform prompt fields', () => {
  const output = validateAssistantConfigurationOutput({
    schema_version: 2,
    assistant_identity: 'Meridian Client Advisor',
    role_and_purpose: 'Answer from approved Meridian knowledge.',
    customer_handling: 'Ask one clarifying question when necessary.',
    follow_up_behavior: 'Disabled unless explicitly approved by an administrator.',
    scheduled_messaging_behavior: 'Disabled.',
    supported_languages: ['English'],
    language_selection_policy: 'Use the customer language when supported.',
    unsupported_claim_behavior: 'State that the information is unavailable.',
    channel_adaptations: ['WhatsApp: concise plain text'],
  });
  assert.equal(output.schema_version, 2);
  assert.throws(
    () => validateAssistantConfigurationOutput({ schema_version: 2, platform_system_prompt: 'SamChe default' }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_SCHEMA_INVALID',
  );
});

test('Gemini generation uses deterministic JSON mode and the requested response schema', async () => {
  const requests = [];
  const fetchImpl = async (url, request) => {
    requests.push({ url, request, body: JSON.parse(request.body) });
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"schema_version":2,"company_summary":"Tenant facts","services":["Consulting"]}' }] } }],
      }),
    };
  };
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'test-key' },
    fetchImpl,
  });

  const output = await provider.generateBusinessProfile({ prompt: 'Approved tenant knowledge' });

  assert.deepEqual(output, { schema_version: 2, company_summary: 'Tenant facts', services: ['Consulting'] });
  assert.match(requests[0].url, /gemini-3-flash-preview:generateContent/);
  assert.equal(requests[0].body.generationConfig.temperature, 0);
  assert.equal(requests[0].body.generationConfig.responseMimeType, 'application/json');
  assert.equal(requests[0].body.generationConfig.responseSchema.type, 'OBJECT');
});

test('Recommendation response schema mirrors canonical validator constraints', () => {
  const schema = buildRecommendationResponseSchema();
  assert.equal(schema.type, 'OBJECT');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.schema_version, { type: 'INTEGER', enum: [2] });
  const stringBranch = schema.properties.tone.anyOf.find((entry) => entry.type === 'STRING');
  const arrayBranch = schema.properties.tone.anyOf.find((entry) => entry.type === 'ARRAY');
  assert.deepEqual(stringBranch, { type: 'STRING', minLength: 1, maxLength: 4000 });
  assert.deepEqual(arrayBranch, { type: 'ARRAY', minItems: 1, maxItems: 50, items: { type: 'STRING', minLength: 1, maxLength: 1000 } });
});

test('Recommendation validator remains fail-closed with safe contract diagnostics', () => {
  assert.throws(() => validateAssistantRecommendationOutput({ schema_version: 1 }), (error) => error.details?.code === 'INVALID_SCHEMA_VERSION' && error.details?.field === 'schema_version');
  assert.throws(() => validateAssistantRecommendationOutput({ tone: '' }), (error) => error.details?.code === 'EMPTY_FIELD' && error.details?.field === 'tone');
  assert.throws(() => validateAssistantRecommendationOutput({ tone: [''] }), (error) => error.details?.code === 'EMPTY_FIELD' && error.details?.field === 'tone');
  assert.throws(() => validateAssistantRecommendationOutput({}), (error) => error.details?.code === 'NO_RECOMMENDATION_FIELDS' && error.details?.field === null);
  assert.throws(() => validateAssistantRecommendationOutput({ tone: 'x'.repeat(4001) }), (error) => error.details?.code === 'STRING_TOO_LONG' && error.details?.field === 'tone');
  assert.throws(() => validateAssistantRecommendationOutput({ tone: Array.from({ length: 51 }, () => 'x') }), (error) => error.details?.code === 'ARRAY_TOO_LARGE' && error.details?.field === 'tone');
  assert.throws(() => validateAssistantRecommendationOutput({ tone: ['x'.repeat(1001)] }), (error) => error.details?.code === 'ARRAY_ITEM_TOO_LONG' && error.details?.field === 'tone');
  assert.throws(() => validateAssistantRecommendationOutput({ unexpected: 'x' }), (error) => error.details?.code === 'UNEXPECTED_FIELD' && error.details?.field === 'unexpected');
  assert.deepEqual(validateAssistantRecommendationOutput({ schema_version: 2, tone: 'Professional' }), { schema_version: 2, tone: 'Professional' });
});

test('Gemini Assistant Recommendation uses bounded low thinking without changing the global timeout', async () => {
  const requests = [];
  const provider = createKnowledgeGenerationProvider({
    env: {
      KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI',
      KNOWLEDGE_GENERATION_MODEL: 'gemini-3-flash-preview',
      KNOWLEDGE_GENERATION_TIMEOUT_MS: '20000',
      GEMINI_API_KEY: 'test-key',
    },
    fetchImpl: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '{"schema_version":2,"tone":"Professional"}' }] } }] }),
      };
    },
  });

  await provider.generateAssistantRecommendation({ prompt: 'ACTIVE tenant profile' });

  assert.deepEqual(requests[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(provider.timeoutMs, 20000);
  assert.equal(provider.assistantGenerationPolicy, 'gemini-structured-v2:thinking-low:timeout-30000');
  assert.equal(provider.recommendationTimeoutMs, 30000);
  assert.equal(provider.configurationTimeoutMs, 30000);
});

test('Gemini boundary telemetry records safe request and fulfilled status events', async () => {
  const events = [];
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'secret-key', KNOWLEDGE_GENERATION_TIMEOUT_MS: '20000' },
    telemetry: (event) => events.push(event),
    fetchImpl: async (_url, request) => ({ ok: true, status: 200, headers: {}, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"schema_version":2,"tone":"Professional"}' }] } }] }) }),
  });

  await provider.generateAssistantRecommendation({ prompt: 'PRIVATE PROMPT SHOULD NOT LOG', runId: 'run-123', requestFingerprint: 'fingerprint-abcdef123456' });

  assert.deepEqual(events.map((event) => event.event), ['request_started', 'http_status_received', 'fetch_fulfilled']);
  assert.equal(events[0].run_id, 'run-123');
  assert.equal(events[0].provider, 'GEMINI');
  assert.equal(events[0].model, 'gemini-3-flash-preview');
  assert.equal(events[0].correlation, 'fingerprint-abcd');
  assert.equal(events[1].http_status, 200);
  assert.ok(Number.isInteger(events[2].elapsed_ms));
  assert.equal(JSON.stringify(events).includes('PRIVATE PROMPT'), false);
  assert.equal(JSON.stringify(events).includes('secret-key'), false);
});

test('Gemini boundary telemetry records abort and preserves public timeout error', async () => {
  const events = [];
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'secret-key', KNOWLEDGE_GENERATION_TIMEOUT_MS: '1000' },
    telemetry: (event) => events.push(event),
    fetchImpl: (_url, request) => new Promise((resolve, reject) => request.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); })),
  });

  await assert.rejects(() => provider.generateBusinessProfile({ prompt: 'PRIVATE PROMPT', runId: 'run-timeout' }), (error) => error.code === 'KNOWLEDGE_GENERATION_TIMEOUT');
  assert.equal(events.at(-1).event, 'fetch_aborted');
  assert.equal(events.at(-1).classification, 'ABORT_TIMEOUT');
  assert.ok(Number.isInteger(events.at(-1).elapsed_ms));
});

test('Gemini boundary telemetry records network errors without provider details', async () => {
  const events = [];
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'secret-key' },
    telemetry: (event) => events.push(event),
    fetchImpl: async () => { throw new Error('socket detail should not log'); },
  });

  await assert.rejects(() => provider.generateAssistantRecommendation({ prompt: 'PRIVATE PROMPT', runId: 'run-network' }), (error) => error.code === 'KNOWLEDGE_GENERATION_PROVIDER_FAILED');
  assert.equal(events.at(-1).event, 'network_error');
  assert.equal(events.at(-1).classification, 'NETWORK_ERROR');
  assert.equal(JSON.stringify(events).includes('socket detail'), false);
});

test('Gemini Assistant Configuration uses the same bounded low-thinking generation policy', async () => {
  const requests = [];
  const provider = createKnowledgeGenerationProvider({
    env: { KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'test-key' },
    fetchImpl: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: '{"schema_version":2,"tone":"Professional"}' }] } }] }),
      };
    },
  });

  await provider.generateAssistantConfiguration({ prompt: 'Approved recommendation' });

  assert.deepEqual(requests[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
});

test('Business Profile and identity analysis retain the global 20 second timeout policy', () => {
  const provider = createKnowledgeGenerationProvider({ env: { GEMINI_API_KEY: 'test-key' }, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.equal(provider.timeoutMs, 20000);
  assert.equal(provider.businessProfileTimeoutMs, 20000);
  assert.equal(provider.identityAnalysisTimeoutMs, 20000);
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
        return { choices: [{ message: { content: '{"schema_version":2,"tone":"Professional","assistant_instructions":"Use approved facts."}' } }] };
      } } },
    },
  });

  const output = await provider.generateAssistantConfiguration({ prompt: 'Approved profile and knowledge' });

  assert.equal(calls[0].model, 'gpt-5-mini');
  assert.equal(calls[0].temperature, 0);
  assert.deepEqual(output, { schema_version: 2, tone: 'Professional', assistant_instructions: 'Use approved facts.' });
});
