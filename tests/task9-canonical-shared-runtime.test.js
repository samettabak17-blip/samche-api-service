import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODEL_REGISTRY,
  resolveCanonicalPlatformModel,
  classifyAiProviderError,
  AllAiProvidersFailedError,
  ProviderCircuitBreaker,
  createSharedAiRuntime,
} from '../services/shared-ai-provider-resilience.js';

test('A5: Central model registry maps legacy and obsolete models to platform canonical models', () => {
  assert.equal(resolveCanonicalPlatformModel({ model: 'gemini-2.5-pro', provider: 'VERTEX' }), 'gemini-3.7-flash');
  assert.equal(resolveCanonicalPlatformModel({ model: 'gemini-2.5-flash', provider: 'VERTEX' }), 'gemini-3.7-flash');
  assert.equal(resolveCanonicalPlatformModel({ model: 'gemini-1.5-pro', provider: 'VERTEX' }), 'gemini-3.7-flash');
  assert.equal(resolveCanonicalPlatformModel({ model: 'gemini-1.5-flash', provider: 'VERTEX' }), 'gemini-3.7-flash');
  assert.equal(resolveCanonicalPlatformModel({ model: 'gemini-3.7-flash', provider: 'VERTEX' }), 'gemini-3.7-flash');
  assert.equal(resolveCanonicalPlatformModel({ model: null, provider: 'VERTEX' }), 'gemini-3.7-flash');
  assert.equal(resolveCanonicalPlatformModel({ model: '', provider: 'VERTEX' }), 'gemini-3.7-flash');

  assert.equal(resolveCanonicalPlatformModel({ model: 'gpt-3.5-turbo', provider: 'OPENAI' }), 'gpt-4o-mini');
  assert.equal(resolveCanonicalPlatformModel({ model: 'gpt-4', provider: 'OPENAI' }), 'gpt-4o');
  assert.equal(resolveCanonicalPlatformModel({ model: 'gpt-4o-mini', provider: 'OPENAI' }), 'gpt-4o-mini');
  assert.equal(resolveCanonicalPlatformModel({ model: null, provider: 'OPENAI' }), 'gpt-4o-mini');
});

test('A6: Error classification accurately categorizes provider errors and NEVER converts 503 to permission denied', () => {
  // 503 High Demand / Capacity
  const err503Status = { status: 503, message: 'The service is temporarily unavailable due to high demand.' };
  assert.equal(classifyAiProviderError(err503Status, 'VERTEX'), 'PROVIDER_CAPACITY_UNAVAILABLE');
  assert.notEqual(classifyAiProviderError(err503Status, 'VERTEX'), 'PROVIDER_PERMISSION_DENIED');

  const err503Msg = new Error('503 Service Unavailable: High demand on vertex models');
  assert.equal(classifyAiProviderError(err503Msg, 'VERTEX'), 'PROVIDER_CAPACITY_UNAVAILABLE');

  // 403 Permission / IAM
  const err403 = { status: 403, message: "aiplatform.endpoints.predict denied on resource 'projects/samche-ai-development-2'" };
  assert.equal(classifyAiProviderError(err403, 'VERTEX'), 'PROVIDER_PERMISSION_DENIED');

  // 404 Model Unavailable
  const err404 = { status: 404, message: 'models/gemini-2.5-pro is not found or unavailable' };
  assert.equal(classifyAiProviderError(err404, 'VERTEX'), 'MODEL_UNAVAILABLE');

  // 429 Rate Limit / Quota
  const err429 = { status: 429, message: 'Resource has been exhausted (e.g. check quota)' };
  assert.equal(classifyAiProviderError(err429, 'VERTEX'), 'PROVIDER_RATE_LIMITED');

  // Timeout
  const errTimeout = { name: 'AbortError', message: 'The operation was aborted due to deadline exceeded' };
  assert.equal(classifyAiProviderError(errTimeout, 'VERTEX'), 'PROVIDER_TIMEOUT');

  // Network Error
  const errNetwork = new Error('fetch failed: ECONNRESET');
  assert.equal(classifyAiProviderError(errNetwork, 'VERTEX'), 'PROVIDER_NETWORK_ERROR');

  // Empty response
  const errEmpty = new Error('empty response text returned');
  assert.equal(classifyAiProviderError(errEmpty, 'VERTEX'), 'EMPTY_RESPONSE');
});

test('A7: Phase A Safe Acceptance proves all 4 channels converge on canonical Vertex path with zero delivery', async () => {
  const fakeVertexResponse = {
    candidates: [{ content: { parts: [{ text: 'CanonicaL Vertex Response for SamChe' }] } }],
  };

  let geminiCalls = [];
  const mockGeminiProvider = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async (params) => {
      geminiCalls.push(params);
      return fakeVertexResponse;
    },
  };

  const sharedRuntime = createSharedAiRuntime({
    geminiProvider: mockGeminiProvider,
    circuitBreaker: new ProviderCircuitBreaker(),
  });

  // 1. INSTAGRAM
  const igRes = await sharedRuntime.generateAiResponse({
    systemInstruction: 'You are Instagram Assistant',
    text: 'Hello via Instagram',
    channel: 'INSTAGRAM',
  });
  assert.equal(igRes.canonicalSharedRuntime, true);
  assert.equal(igRes.provider, 'vertex');
  assert.equal(igRes.providerSuccess, true);
  assert.equal(Boolean(igRes.text && igRes.text.length > 0), true);
  assert.equal(igRes.fallbackUsed, false);
  assert.equal(igRes.model, 'gemini-3.7-flash');

  // 2. WHATSAPP
  const wpRes = await sharedRuntime.generateAiResponse({
    systemInstruction: 'You are WhatsApp Assistant',
    prompt: 'Hello via WhatsApp',
    model: 'gemini-2.5-pro', // Legacy model in DB must be mapped to gemini-3.7-flash
    channel: 'WHATSAPP',
  });
  assert.equal(wpRes.canonicalSharedRuntime, true);
  assert.equal(wpRes.provider, 'vertex');
  assert.equal(wpRes.providerSuccess, true);
  assert.equal(Boolean(wpRes.text && wpRes.text.length > 0), true);
  assert.equal(wpRes.fallbackUsed, false);
  assert.equal(wpRes.model, 'gemini-3.7-flash');

  // 3. WEB CHAT
  const webRes = await sharedRuntime.generateAiResponse({
    systemInstruction: 'You are Web Chat Assistant',
    messages: [
      { role: 'system', content: 'You are Web Chat Assistant' },
      { role: 'user', content: 'Hello via Web Chat' },
    ],
    channel: 'WEB_CHAT',
  });
  assert.equal(webRes.canonicalSharedRuntime, true);
  assert.equal(webRes.provider, 'vertex');
  assert.equal(webRes.providerSuccess, true);
  assert.equal(Boolean(webRes.text && webRes.text.length > 0), true);
  assert.equal(webRes.fallbackUsed, false);
  assert.equal(webRes.model, 'gemini-3.7-flash');

  // 4. AI GUIDE
  const guideRes = await sharedRuntime.generateAiResponse({
    systemInstruction: 'You are AI Guide Assistant',
    contents: [{ role: 'user', parts: [{ text: 'Hello via AI Guide' }] }],
    channel: 'SAMCHEGUIDE',
  });
  assert.equal(guideRes.canonicalSharedRuntime, true);
  assert.equal(guideRes.provider, 'vertex');
  assert.equal(guideRes.providerSuccess, true);
  assert.equal(Boolean(guideRes.text && guideRes.text.length > 0), true);
  assert.equal(guideRes.fallbackUsed, false);
  assert.equal(guideRes.model, 'gemini-3.7-flash');

  assert.equal(geminiCalls.length, 4);
});

test('B7: Deterministic Failover Tests: Vertex Success -> OpenAI NOT called', async () => {
  let openaiCalled = false;
  const mockOpenAi = {
    chat: {
      completions: {
        create: async () => {
          openaiCalled = true;
          return { choices: [{ message: { content: 'OpenAI output' } }] };
        },
      },
    },
  };
  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => ({
      candidates: [{ content: { parts: [{ text: 'Vertex Primary Success' }] } }],
    }),
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
  });

  const res = await runtime.generateAiResponse({
    text: 'Test prompt',
    channel: 'WHATSAPP',
  });

  assert.equal(res.provider, 'vertex');
  assert.equal(res.text, 'Vertex Primary Success');
  assert.equal(openaiCalled, false);
});

test('B7: Deterministic Failover Tests: Vertex 403, 404, 429, 503, timeout, empty -> Failover to OpenAI', async () => {
  const failureScenarios = [
    { name: '403 Forbidden', error: Object.assign(new Error('Permission denied'), { status: 403 }) },
    { name: '404 Model Unavailable', error: Object.assign(new Error('Model not found'), { status: 404 }) },
    { name: '429 Rate Limit', error: Object.assign(new Error('Rate limit exceeded'), { status: 429 }) },
    { name: '503 High Demand', error: Object.assign(new Error('Service unavailable due to high demand'), { status: 503 }) },
    { name: 'Timeout', error: Object.assign(new Error('Deadline exceeded'), { name: 'AbortError' }) },
    { name: 'Empty Response', error: null, returnEmpty: true },
  ];

  for (const scenario of failureScenarios) {
    let capturedOpenAiPayload = null;
    const mockOpenAi = {
      chat: {
        completions: {
          create: async (payload) => {
            capturedOpenAiPayload = payload;
            return { choices: [{ message: { content: `OpenAI response for ${scenario.name}` } }] };
          },
        },
      },
    };
    const mockGemini = {
      mode: 'vertex',
      runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
      generateContent: async () => {
        if (scenario.returnEmpty) return { candidates: [{ content: { parts: [{ text: '' }] } }] };
        throw scenario.error;
      },
    };

    const runtime = createSharedAiRuntime({
      geminiProvider: mockGemini,
      openaiClient: mockOpenAi,
      circuitBreaker: new ProviderCircuitBreaker({ failureThreshold: 10 }), // don't trip during test loop
    });

    const res = await runtime.generateAiResponse({
      systemInstruction: 'Tenant Policy Instruction',
      text: 'User query about company formation',
      channel: 'INSTAGRAM',
    });

    assert.equal(res.provider, 'openai', `Scenario ${scenario.name} should failover to OpenAI`);
    assert.equal(res.text, `OpenAI response for ${scenario.name}`);
    assert.equal(res.failoverFrom, 'vertex');
    assert.ok(capturedOpenAiPayload, `OpenAI should have been called for ${scenario.name}`);
    assert.equal(capturedOpenAiPayload.messages[0].content, 'Tenant Policy Instruction');
    assert.equal(capturedOpenAiPayload.messages[1].content, 'User query about company formation');
  }
});

test('B7: Both Vertex & OpenAI Fail -> Throws AllAiProvidersFailedError, NO fake customer static text', async () => {
  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => { throw new Error('Vertex down'); },
  };
  const mockOpenAi = {
    chat: {
      completions: {
        create: async () => { throw new Error('OpenAI down'); },
      },
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
  });

  await assert.rejects(
    () => runtime.generateAiResponse({ text: 'Customer query', channel: 'WEB_CHAT' }),
    (err) => {
      assert.equal(err instanceof AllAiProvidersFailedError, true);
      assert.equal(err.status, 502);
      assert.equal(err.code, 'ALL_AI_PROVIDERS_FAILED');
      return true;
    }
  );
});

test('B3 & B7: Circuit Breaker Trips OPEN on Repeated Failures, Probes on Recovery, Returns to Vertex', async () => {
  let vertexAttempts = 0;
  let vertexShouldFail = true;
  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => {
      vertexAttempts++;
      if (vertexShouldFail) throw Object.assign(new Error('503 High Demand'), { status: 503 });
      return { candidates: [{ content: { parts: [{ text: 'Vertex is back online' }] } }] };
    },
  };

  const mockOpenAi = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: 'OpenAI fallback answer' } }] }),
      },
    },
  };

  const cb = new ProviderCircuitBreaker({ failureThreshold: 2, cooldownMs: 50 });
  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
    circuitBreaker: cb,
  });

  // Call 1: Vertex fails (failure 1) -> Failover to OpenAI
  const r1 = await runtime.generateAiResponse({ text: 'Q1' });
  assert.equal(r1.provider, 'openai');
  assert.equal(cb.getState(), 'CLOSED');

  // Call 2: Vertex fails (failure 2) -> Circuit TRIPS OPEN -> Failover to OpenAI
  const r2 = await runtime.generateAiResponse({ text: 'Q2' });
  assert.equal(r2.provider, 'openai');
  assert.equal(cb.getState(), 'OPEN');

  // Call 3: Circuit is OPEN -> Vertex is SKIPPED -> Direct to OpenAI
  const attemptsBefore = vertexAttempts;
  const r3 = await runtime.generateAiResponse({ text: 'Q3' });
  assert.equal(r3.provider, 'openai');
  assert.equal(vertexAttempts, attemptsBefore, 'Vertex should not be hammered when circuit is OPEN');

  // Wait for cooldown
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(cb.getState(), 'HALF_OPEN');

  // Vertex recovers!
  vertexShouldFail = false;

  // Call 4: Probe in HALF_OPEN succeeds -> Circuit becomes CLOSED -> Primary Vertex response returned!
  const r4 = await runtime.generateAiResponse({ text: 'Q4' });
  assert.equal(r4.provider, 'vertex');
  assert.equal(r4.text, 'Vertex is back online');
  assert.equal(cb.getState(), 'CLOSED');
});

test('B1 & B7: Business Brain & Tenant Isolation Context Equivalence across Providers', async () => {
  const tenantPrompt = 'AUTHORITATIVE TENANT POLICY: UAE company setup costs start at 8000 AED.';
  const userQuery = 'What are the costs for Freezone company?';
  const history = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Welcome to SamChe Company LLC.' },
  ];

  let geminiPayloadReceived = null;
  let openaiPayloadReceived = null;

  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async (p) => {
      geminiPayloadReceived = p;
      return { candidates: [{ content: { parts: [{ text: 'Vertex answer' }] } }] };
    },
  };

  const mockOpenAi = {
    chat: {
      completions: {
        create: async (p) => {
          openaiPayloadReceived = p;
          return { choices: [{ message: { content: 'OpenAI answer' } }] };
        },
      },
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
  });

  // Run on Vertex
  await runtime.generateAiResponse({
    systemInstruction: tenantPrompt,
    conversationHistory: history,
    prompt: userQuery,
    channel: 'WHATSAPP',
  });

  assert.equal(geminiPayloadReceived.systemInstruction.parts[0].text, tenantPrompt);
  assert.equal(geminiPayloadReceived.contents[0].parts[0].text, 'Hello');
  assert.equal(geminiPayloadReceived.contents[1].parts[0].text, 'Welcome to SamChe Company LLC.');
  assert.equal(geminiPayloadReceived.contents[2].parts[0].text, userQuery);

  // Trigger failover to OpenAI
  mockGemini.generateContent = async () => { throw new Error('Vertex 503'); };
  await runtime.generateAiResponse({
    systemInstruction: tenantPrompt,
    conversationHistory: history,
    prompt: userQuery,
    channel: 'WHATSAPP',
  });

  assert.equal(openaiPayloadReceived.messages[0].role, 'system');
  assert.equal(openaiPayloadReceived.messages[0].content, tenantPrompt);
  assert.equal(openaiPayloadReceived.messages[1].role, 'user');
  assert.equal(openaiPayloadReceived.messages[1].content, 'Hello');
  assert.equal(openaiPayloadReceived.messages[2].role, 'assistant');
  assert.equal(openaiPayloadReceived.messages[2].content, 'Welcome to SamChe Company LLC.');
  assert.equal(openaiPayloadReceived.messages[3].role, 'user');
  assert.equal(openaiPayloadReceived.messages[3].content, userQuery);
});


