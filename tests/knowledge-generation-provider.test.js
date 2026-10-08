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
import { ProviderCircuitBreakerRegistry } from '../services/shared-ai-provider-resilience.js';

const validRecommendationJson = JSON.stringify({
  schema_version: 2,
  tone: 'Professional',
  recommendation_rationale: 'Approved tenant evidence supports this tone.',
});

function failoverProvider({ vertex, openai, telemetry = null, circuitRegistry = new ProviderCircuitBreakerRegistry() }) {
  return createKnowledgeGenerationProvider({
    env: {
      DASHBOARD_AI_PROVIDER_FAILOVER_ENABLED: 'true',
      GOOGLE_GENAI_MODE: 'vertex',
      OPENAI_API_KEY: 'test-openai-key',
    },
    googleProviderFactory: () => ({ generateContent: vertex }),
    openaiClient: { chat: { completions: { create: openai } } },
    telemetry,
    circuitRegistry,
  });
}

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

test('Gemini image semantic boundary preserves mixed durable and behavior artifacts from one BUSINESS segment', async () => {
  const requests = [];
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'test-key' },
    fetchImpl: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ classifications: [
          { segment_order: 4, category: 'DURABLE_BUSINESS_FACT', canonical_fact: 'The company works with venues for corporate events.', confidence: 0.9 },
          { segment_order: 4, category: 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION', canonical_fact: 'Ask whether the customer already has a venue.', confidence: 0.8 },
        ] }) }] } }] }),
      };
    },
  });

  const output = await provider.classifyImageKnowledgeSegments({
    segments: [{ segment_order: 4, text: 'Do you already have a venue? We work with venues for corporate events.' }],
  });

  assert.equal(output.classifications.length, 2);
  assert.deepEqual(output.classifications.map((item) => item.category), [
    'DURABLE_BUSINESS_FACT',
    'ASSISTANT_BEHAVIOR_OR_QUALIFICATION',
  ]);
  assert.equal(requests[0].generationConfig.responseSchema.properties.classifications.items.properties.category.type, 'STRING');
  assert.equal(provider.imageSemanticTimeoutMs, 60000);
  assert.deepEqual(requests[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
});

test('Recommendation response schema mirrors canonical validator constraints', () => {
  const schema = buildRecommendationResponseSchema();
  assert.equal(schema.type, 'OBJECT');
  assert.deepEqual(schema.properties.schema_version, { type: 'INTEGER' });
  const stringBranch = schema.properties.tone.anyOf.find((entry) => entry.type === 'STRING');
  const arrayBranch = schema.properties.tone.anyOf.find((entry) => entry.type === 'ARRAY');
  assert.deepEqual(stringBranch, { type: 'STRING' });
  assert.deepEqual(arrayBranch, { type: 'ARRAY', items: { type: 'STRING' } });
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

test('Vertex success does not call OpenAI for Assistant Recommendation', async () => {
  let openaiCalls = 0;
  const provider = failoverProvider({
    vertex: async () => ({ structured_text: validRecommendationJson }),
    openai: async () => { openaiCalls += 1; throw new Error('must not run'); },
  });

  const output = await provider.generateAssistantRecommendation({ prompt: 'ACTIVE tenant profile' });
  assert.equal(output.tone, 'Professional');
  assert.equal(openaiCalls, 0);
});

test('suspended Vertex project falls back to OpenAI and preserves Recommendation V2', async () => {
  const signals = [];
  const events = [];
  const provider = failoverProvider({
    telemetry: (event) => events.push(event),
    vertex: async ({ signal }) => {
      signals.push(signal);
      const error = new Error("Consumer project has been suspended");
      error.code = 'GOOGLE_VERTEX_PERMISSION_DENIED';
      throw error;
    },
    openai: async (_request, { signal }) => {
      signals.push(signal);
      return { choices: [{ message: { content: validRecommendationJson } }] };
    },
  });

  const output = await provider.generateAssistantRecommendation({
    prompt: 'ACTIVE tenant profile',
    requestFingerprint: 'tenant-safe-correlation-1234',
  });
  assert.deepEqual(output, JSON.parse(validRecommendationJson));
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.equal(events.some((event) => event.event === 'fallback_succeeded' && event.selected_provider === 'OPENAI'), true);
  assert.equal(JSON.stringify(events).includes('suspended'), false);
});

test('OpenAI fallback rejection emits only allowlisted diagnostics with generation correlation', async () => {
  const events = [];
  class BadRequestError extends Error {}
  const rejection = new BadRequestError('PRIVATE PROVIDER MESSAGE with sk-secret-value and customer content');
  Object.assign(rejection, {
    status: 400,
    type: 'invalid_request_error',
    code: 'unsupported_value',
    param: 'temperature',
    request_id: 'req_safe123',
    headers: { authorization: 'Bearer sk-secret-value' },
    error: { message: 'PRIVATE RESPONSE BODY', customer: 'PRIVATE CUSTOMER CONTENT' },
    response: { body: 'PRIVATE RAW RESPONSE' },
    request: { body: 'PRIVATE RAW REQUEST' },
  });
  const provider = failoverProvider({
    telemetry: (event) => events.push(event),
    vertex: async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); },
    openai: async () => { throw rejection; },
  });

  await assert.rejects(
    provider.generateAssistantRecommendation({
      prompt: 'PRIVATE PROMPT',
      runId: 'run-openai-rejection',
      requestFingerprint: '229bad1b44a8a41d-extra',
    }),
    (error) => error === rejection,
  );

  const diagnostic = events.find((event) => event.event === 'openai_request_rejected');
  assert.deepEqual(diagnostic, {
    event: 'openai_request_rejected',
    run_id: 'run-openai-rejection',
    operation: 'ASSISTANT_RECOMMENDATION',
    provider: 'OPENAI',
    model: 'gpt-4o-mini',
    correlation: '229bad1b44a8a41d',
    timestamp: diagnostic.timestamp,
    http_status: 400,
    provider_error_type: 'invalid_request_error',
    provider_error_code: 'unsupported_value',
    rejected_parameter: 'temperature',
    sdk_error_class: 'BadRequestError',
    openai_request_id: 'req_safe123',
  });
  assert.match(diagnostic.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  const serialized = JSON.stringify(events);
  for (const sensitiveValue of [
    'PRIVATE PROVIDER MESSAGE',
    'sk-secret-value',
    'PRIVATE CUSTOMER CONTENT',
    'PRIVATE RESPONSE BODY',
    'PRIVATE RAW RESPONSE',
    'PRIVATE RAW REQUEST',
    'PRIVATE PROMPT',
    '"authorization"',
    '"headers"',
    '"request"',
    '"response"',
    '"message"',
    '"error"',
  ]) assert.equal(serialized.includes(sensitiveValue), false, sensitiveValue);
});

test('OpenAI fallback network errors preserve existing behavior without rejection diagnostics', async () => {
  const events = [];
  const networkError = Object.assign(new Error('PRIVATE NETWORK DETAIL'), { code: 'ECONNRESET' });
  const provider = failoverProvider({
    telemetry: (event) => events.push(event),
    vertex: async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); },
    openai: async () => { throw networkError; },
  });

  await assert.rejects(
    provider.generateAssistantRecommendation({
      prompt: 'PRIVATE PROMPT',
      runId: 'run-openai-network',
      requestFingerprint: 'network-correlation-safe',
    }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_PROVIDERS_UNAVAILABLE'
      && error.cause?.safeMetadata?.secondaryClassification === 'PROVIDER_NETWORK_ERROR',
  );
  assert.equal(events.some((event) => event.event === 'openai_request_rejected'), false);
  assert.equal(JSON.stringify(events).includes('PRIVATE NETWORK DETAIL'), false);
  assert.equal(JSON.stringify(events).includes('PRIVATE PROMPT'), false);
});

test('Vertex network and timeout failures use independent OpenAI attempts', async () => {
  for (const vertexError of [
    Object.assign(new Error('socket'), { code: 'ECONNRESET' }),
    Object.assign(new Error('deadline exceeded'), { code: 'GOOGLE_GEMINI_TIMEOUT' }),
  ]) {
    let fallbackCalls = 0;
    const provider = failoverProvider({
      circuitRegistry: new ProviderCircuitBreakerRegistry(),
      vertex: async () => { throw vertexError; },
      openai: async () => {
        fallbackCalls += 1;
        return { choices: [{ message: { content: validRecommendationJson } }] };
      },
    });
    assert.equal((await provider.generateAssistantRecommendation({ prompt: 'profile' })).schema_version, 2);
    assert.equal(fallbackCalls, 1);
  }
});

test('open primary circuit selects OpenAI without a Vertex request', async () => {
  const registry = new ProviderCircuitBreakerRegistry();
  registry.get({ provider: 'VERTEX', model: 'gemini-3-flash-preview', capability: 'STRUCTURED_TEXT' })
    .recordFailure('PROVIDER_PERMISSION_DENIED');
  let vertexCalls = 0;
  const provider = failoverProvider({
    circuitRegistry: registry,
    vertex: async () => { vertexCalls += 1; throw new Error('must not run'); },
    openai: async () => ({ choices: [{ message: { content: validRecommendationJson } }] }),
  });
  assert.equal((await provider.generateAssistantRecommendation({ prompt: 'profile' })).tone, 'Professional');
  assert.equal(vertexCalls, 0);
});

test('both structured providers unavailable returns bounded safe failure', async () => {
  const provider = failoverProvider({
    vertex: async () => { throw Object.assign(new Error('private vertex detail'), { code: 'ECONNRESET' }); },
    openai: async () => { throw Object.assign(new Error('private OpenAI detail'), { status: 503 }); },
  });
  await assert.rejects(
    provider.generateAssistantRecommendation({ prompt: 'private prompt' }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_PROVIDERS_UNAVAILABLE'
      && !/private|vertex|openai/i.test(error.message),
  );
});

test('invalid OpenAI output is terminal schema failure', async () => {
  let openaiCalls = 0;
  const provider = failoverProvider({
    vertex: async () => { throw Object.assign(new Error('suspended'), { status: 403 }); },
    openai: async () => {
      openaiCalls += 1;
      return { choices: [{ message: { content: '{"schema_version":2,"unexpected":"value"}' } }] };
    },
  });
  await assert.rejects(
    provider.generateAssistantRecommendation({ prompt: 'profile' }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_SCHEMA_INVALID',
  );
  assert.equal(openaiCalls, 1);
});

test('Vertex schema failure does not invoke OpenAI', async () => {
  let openaiCalls = 0;
  const provider = failoverProvider({
    vertex: async () => ({ structured_text: '{"schema_version":2,"unexpected":"value"}' }),
    openai: async () => { openaiCalls += 1; return { choices: [] }; },
  });
  await assert.rejects(
    provider.generateAssistantRecommendation({ prompt: 'profile' }),
    (error) => error.code === 'KNOWLEDGE_GENERATION_SCHEMA_INVALID',
  );
  assert.equal(openaiCalls, 0);
});

test('Gemini Assistant Recommendation uses bounded minimal thinking and a concise output budget without changing the global timeout', async () => {
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

  assert.deepEqual(requests[0].generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(requests[0].generationConfig.maxOutputTokens, 1024);
  assert.equal(provider.timeoutMs, 20000);
  assert.equal(provider.assistantGenerationPolicy, 'gemini-structured-v3:thinking-minimal:max-output-1024:timeout-30000');
  assert.equal(provider.recommendationTimeoutMs, 30000);
  assert.equal(provider.configurationTimeoutMs, 90000);
});

test('Gemini boundary telemetry records safe request and fulfilled status events', async () => {
  const events = [];
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'secret-key', KNOWLEDGE_GENERATION_TIMEOUT_MS: '20000' },
    telemetry: (event) => events.push(event),
    fetchImpl: async (_url, request) => ({ ok: true, status: 200, headers: {}, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"schema_version":2,"tone":"Professional"}' }] } }] }) }),
  });

  await provider.generateAssistantRecommendation({ prompt: 'PRIVATE PROMPT SHOULD NOT LOG', runId: 'run-123', requestFingerprint: 'fingerprint-abcdef123456' });

  assert.deepEqual(events.map((event) => event.event), [
    'request_started',
    'http_status_received',
    'fetch_fulfilled',
    'structured_response_shape',
    'structured_parse_result',
  ]);
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

  await assert.rejects(() => provider.generateBusinessIdentityAnalysis({ source: { id: 'source-timeout', title: 'Private source', content: 'PRIVATE PROMPT' } }), (error) => error.code === 'KNOWLEDGE_GENERATION_TIMEOUT');
  assert.equal(events.at(-1).event, 'fetch_aborted');
  assert.equal(events.at(-1).classification, 'ABORT_TIMEOUT');
  assert.ok(Number.isInteger(events.at(-1).elapsed_ms));
});

test('Gemini developer transport does not serialize its abort signal into the provider payload', async () => {
  let captured;
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'test-key' },
    fetchImpl: async (_url, request) => {
      captured = { signal: request.signal, body: JSON.parse(request.body) };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"schema_version":2,"company_summary":"Tenant facts"}' }] } }] }) };
    },
  });

  await provider.generateBusinessProfile({ prompt: 'Approved tenant knowledge' });

  assert.ok(captured.signal instanceof AbortSignal);
  assert.equal(captured.body.generationConfig.abortSignal, undefined);
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

test('Gemini Assistant Configuration uses a bounded minimal-thinking policy with an explicit output budget', async () => {
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

  assert.deepEqual(requests[0].generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(requests[0].generationConfig.maxOutputTokens, 4096);
  assert.equal(provider.configurationTimeoutMs, 90000);
  assert.equal(provider.assistantConfigurationGenerationPolicy, 'gemini-assistant-configuration-v4:thinking-minimal:max-output-4096:timeout-90000');
});

test('Gemini strips provider thinking parts before parsing structured Assistant Configuration JSON', async () => {
  const provider = createKnowledgeGenerationProvider({
    env: { KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'test-key' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          finishReason: 'STOP',
          content: {
            parts: [
              { thought: true, text: 'Internal provider reasoning that is not JSON output.' },
              { text: '{"schema_version":2,"tone":"Professional"}' },
            ],
          },
        }],
      }),
    }),
  });

  const output = await provider.generateAssistantConfiguration({ prompt: 'Approved profile and recommendation' });

  assert.deepEqual(output, { schema_version: 2, tone: 'Professional' });
});

test('Gemini accepts multiple thought parts and one fenced final JSON payload', async () => {
  const provider = createKnowledgeGenerationProvider({
    env: { KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'test-key' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [
      { thought: true, text: 'internal one' },
      { thought: true, text: 'internal two' },
      { text: '```json\n{"schema_version":2,"tone":"Professional"}\n```' },
    ] } }] }) }),
  });
  assert.deepEqual(await provider.generateAssistantConfiguration({ prompt: 'Approved profile and recommendation' }), { schema_version: 2, tone: 'Professional' });
});

test('Gemini rejects prefix/suffix text and multiple final payload parts without concatenating them', async () => {
  const malformed = createKnowledgeGenerationProvider({
    env: { KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'test-key' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Here is JSON: {"schema_version":2}' }] } }] }) }),
  });
  await assert.rejects(() => malformed.generateAssistantConfiguration({ prompt: 'Approved profile' }), (error) => error.code === 'KNOWLEDGE_GENERATION_RESPONSE_INVALID');

  const multiple = createKnowledgeGenerationProvider({
    env: { KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'test-key' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [
      { text: '{"schema_version":2}' }, { text: '{"tone":"Professional"}' },
    ] } }] }) }),
  });
  await assert.rejects(() => multiple.generateAssistantConfiguration({ prompt: 'Approved profile' }), (error) => error.code === 'KNOWLEDGE_GENERATION_RESPONSE_INVALID');
});

test('Gemini rejects empty, malformed, truncated, and schema-invalid structured configuration output', async () => {
  const cases = [
    { response: { candidates: [{ content: { parts: [] } }] }, code: 'KNOWLEDGE_GENERATION_RESPONSE_INVALID' },
    { response: { candidates: [{ content: { parts: [{ text: '{not-json' }] } }] }, code: 'KNOWLEDGE_GENERATION_RESPONSE_INVALID' },
    { response: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"schema_version":2' }] } }] }, code: 'KNOWLEDGE_GENERATION_OUTPUT_TRUNCATED' },
    { response: { candidates: [{ content: { parts: [{ text: '[]' }] } }] }, code: 'KNOWLEDGE_GENERATION_SCHEMA_INVALID' },
  ];
  for (const fixture of cases) {
    const provider = createKnowledgeGenerationProvider({
      env: { KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'test-key' },
      fetchImpl: async () => ({ ok: true, json: async () => fixture.response }),
    });
    await assert.rejects(() => provider.generateAssistantConfiguration({ prompt: 'Approved profile' }), (error) => error.code === fixture.code);
  }
});

test('Gemini emits safe structured response-shape telemetry without retaining final text', async () => {
  const events = [];
  const provider = createKnowledgeGenerationProvider({
    env: { KNOWLEDGE_GENERATION_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'test-key' },
    telemetry: (event) => events.push(event),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ candidates: [{
        finishReason: 'STOP',
        content: { parts: [
          { thought: true, text: 'Private chain of thought' },
          { text: '{"schema_version":2,"tone":"Professional"}' },
        ] },
      }] }),
    }),
  });

  await provider.generateAssistantConfiguration({ prompt: 'Approved profile and recommendation' });

  const shape = events.find((event) => event.event === 'structured_response_shape')?.response_shape;
  assert.equal(shape.candidate_count, 1);
  assert.equal(shape.part_summaries[0].thought, true);
  assert.equal(shape.part_summaries[1].text_present, true);
  assert.match(shape.part_summaries[1].text_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(events).includes('Professional'), false);
  assert.equal(JSON.stringify(events).includes('Private chain of thought'), false);
});

test('Business Profile uses bounded low thinking and an operation-specific timeout', async () => {
  const requests = [];
  const provider = createKnowledgeGenerationProvider({
    env: { GEMINI_API_KEY: 'test-key', KNOWLEDGE_GENERATION_TIMEOUT_MS: '20000' },
    fetchImpl: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"schema_version":2,"company_summary":"Tenant facts"}' }] } }] }) };
    },
  });

  await provider.generateBusinessProfile({ prompt: 'Approved tenant knowledge' });

  assert.equal(provider.timeoutMs, 20000);
  assert.equal(provider.businessProfileTimeoutMs, 30000);
  assert.equal(provider.identityAnalysisTimeoutMs, 20000);
  assert.deepEqual(requests[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
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
