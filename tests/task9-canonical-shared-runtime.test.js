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

test('TASK 9.1 RESTORATION: Inbound Image Context is preserved and forwarded with parity to Vertex and OpenAI failover', async () => {
  const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const imagePart = {
    inlineData: { mimeType: 'image/png', data: fakeBase64 },
    inline_data: { mime_type: 'image/png', data: fakeBase64 },
  };

  let vertexReceived = null;
  let openaiReceived = null;

  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async (p) => {
      vertexReceived = p;
      return { candidates: [{ content: { parts: [{ text: 'I see a red dot in the image.' }] } }] };
    },
  };

  const mockOpenAi = {
    chat: {
      completions: {
        create: async (p) => {
          openaiReceived = p;
          return { choices: [{ message: { content: 'OpenAI vision: I see an image with a red dot.' } }] };
        },
      },
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
  });

  // 1. Primary Vertex execution with image
  const res1 = await runtime.generateAiResponse({
    systemInstruction: 'You are Blue Dune visual assistant.',
    prompt: 'What is this image?',
    multimodalParts: [imagePart],
    channel: 'WHATSAPP',
  });
  assert.equal(res1.provider, 'vertex');
  assert.equal(res1.text, 'I see a red dot in the image.');
  assert.ok(vertexReceived);
  assert.equal(vertexReceived.contents[0].parts[0].text, 'What is this image?');
  assert.equal(vertexReceived.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(vertexReceived.contents[0].parts[1].inlineData.data, fakeBase64);

  // 2. OpenAI failover execution with image
  mockGemini.generateContent = async () => { throw Object.assign(new Error('503 High Demand'), { status: 503 }); };
  const res2 = await runtime.generateAiResponse({
    systemInstruction: 'You are Blue Dune visual assistant.',
    prompt: 'What is this image?',
    multimodalParts: [imagePart],
    channel: 'WHATSAPP',
  });
  assert.equal(res2.provider, 'openai');
  assert.equal(res2.text, 'OpenAI vision: I see an image with a red dot.');
  assert.ok(openaiReceived);
  const userMsg = openaiReceived.messages.find((m) => m.role === 'user');
  assert.ok(userMsg);
  assert.ok(Array.isArray(userMsg.content));
  assert.equal(userMsg.content[0].type, 'text');
  assert.equal(userMsg.content[0].text, 'What is this image?');
  assert.equal(userMsg.content[1].type, 'image_url');
  assert.equal(userMsg.content[1].image_url.url, `data:image/png;base64,${fakeBase64}`);
});

test('TASK 9.1 RESTORATION: Inbound PDF/Document Extracted Context is preserved and forwarded with parity', async () => {
  const extractedPdfEvidence = '<customer_document_evidence>\nINVOICE #9821\nAmount Due: 4500 AED\nCompany: Blue Dune LLC\n</customer_document_evidence>';
  const docPart = { text: extractedPdfEvidence };

  let vertexReceived = null;
  let openaiReceived = null;

  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async (p) => {
      vertexReceived = p;
      return { candidates: [{ content: { parts: [{ text: 'The invoice amount is 4500 AED.' }] } }] };
    },
  };

  const mockOpenAi = {
    chat: {
      completions: {
        create: async (p) => {
          openaiReceived = p;
          return { choices: [{ message: { content: 'OpenAI: Invoice #9821 is 4500 AED.' } }] };
        },
      },
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
  });

  // 1. Primary Vertex with PDF document text
  const res1 = await runtime.generateAiResponse({
    systemInstruction: 'You are document assistant.',
    contents: [{
      role: 'user',
      parts: [
        { text: 'Please summarize this PDF invoice' },
        docPart,
      ],
    }],
    channel: 'WHATSAPP',
  });
  assert.equal(res1.provider, 'vertex');
  assert.equal(res1.text, 'The invoice amount is 4500 AED.');
  assert.equal(vertexReceived.contents[0].parts[0].text, 'Please summarize this PDF invoice');
  assert.equal(vertexReceived.contents[0].parts[1].text, extractedPdfEvidence);

  // 2. OpenAI failover with PDF document text
  mockGemini.generateContent = async () => { throw new Error('Vertex 503'); };
  const res2 = await runtime.generateAiResponse({
    systemInstruction: 'You are document assistant.',
    contents: [{
      role: 'user',
      parts: [
        { text: 'Please summarize this PDF invoice' },
        docPart,
      ],
    }],
    channel: 'WHATSAPP',
  });
  assert.equal(res2.provider, 'openai');
  assert.equal(res2.text, 'OpenAI: Invoice #9821 is 4500 AED.');
  const userMsg = openaiReceived.messages.find((m) => m.role === 'user');
  assert.ok(userMsg);
  assert.ok(userMsg.content.includes(extractedPdfEvidence));
});



test('TASK 9.1 RESTORATION: Inbound URL/Link reading context is preserved and forwarded with parity', async () => {
  const urlPageContext = 'EXTERNAL_URL_CONTEXT:\nTitle: Dubai Mainland Commercial License Guide\nSummary: 100% foreign ownership allowed.';
  const urlImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const urlImagePart = {
    inlineData: { mimeType: 'image/jpeg', data: urlImageBase64 },
    inline_data: { mime_type: 'image/jpeg', data: urlImageBase64 },
  };

  let vertexReceived = null;
  let openaiReceived = null;

  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async (p) => {
      vertexReceived = p;
      return { candidates: [{ content: { parts: [{ text: 'Based on the link, 100% foreign ownership is supported.' }] } }] };
    },
  };

  const mockOpenAi = {
    chat: {
      completions: {
        create: async (p) => {
          openaiReceived = p;
          return { choices: [{ message: { content: 'OpenAI: The link confirms 100% foreign ownership.' } }] };
        },
      },
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
  });

  const res1 = await runtime.generateAiResponse({
    systemInstruction: `You are company consultant.\n${urlPageContext}`,
    prompt: 'Check this license link https://example.com/dubai-license',
    multimodalParts: [urlImagePart],
    channel: 'WHATSAPP',
  });

  assert.equal(res1.provider, 'vertex');
  assert.ok(vertexReceived.systemInstruction.parts[0].text.includes(urlPageContext));
  assert.equal(vertexReceived.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');

  mockGemini.generateContent = async () => { throw new Error('Vertex 503'); };
  const res2 = await runtime.generateAiResponse({
    systemInstruction: `You are company consultant.\n${urlPageContext}`,
    prompt: 'Check this license link https://example.com/dubai-license',
    multimodalParts: [urlImagePart],
    channel: 'WHATSAPP',
  });

  assert.equal(res2.provider, 'openai');
  assert.ok(openaiReceived.messages[0].content.includes(urlPageContext));
  const userMsg = openaiReceived.messages.find((m) => m.role === 'user');
  assert.equal(userMsg.content[1].type, 'image_url');
});

test('TASK 9.1 ADDENDUM: Visual AI Coexistence and Orchestration Parity during Provider Failover', async () => {
  // Visual AI intent classification and request parsing operate before inference
  const visualUserText = 'Can you generate an image of a luxury modern office in Dubai?';
  const tenantGrounding = 'BUSINESS_IDENTITY: Blue Dune Luxury Real Estate & Design.';
  let openaiCalled = false;

  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => {
      // Simulate Vertex capacity outage
      throw Object.assign(new Error('503 Service Unavailable'), { status: 503 });
    },
  };

  const mockOpenAi = {
    chat: {
      completions: {
        create: async (payload) => {
          openaiCalled = true;
          assert.ok(payload.messages[0].content.includes(tenantGrounding));
          assert.equal(payload.messages[1].content, visualUserText);
          return {
            choices: [{
              message: {
                content: 'I will prepare your visual generation request for the luxury modern office in Dubai.',
              },
            }],
          };
        },
      },
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
  });

  const res = await runtime.generateAiResponse({
    systemInstruction: tenantGrounding,
    prompt: visualUserText,
    channel: 'WHATSAPP',
  });

  assert.equal(res.provider, 'openai');
  assert.equal(openaiCalled, true);
  assert.ok(res.text.includes('luxury modern office'));
});

test('TASK 9.1 ADDENDUM: Web Chat Page & Entity Awareness Parity during Provider Failover', async () => {
  const pageContextPrompt = 'PAGE_CONTEXT:\nActive Page: https://example.com/products/dubai-pro-setup\nEntity: Dubai Pro Setup Package\nPrice: 12500 AED';
  const customerQuestion = 'What is included in the package shown on my screen?';

  let openaiPayload = null;
  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => { throw new Error('Vertex 503'); },
  };
  const mockOpenAi = {
    chat: {
      completions: {
        create: async (p) => {
          openaiPayload = p;
          return {
            choices: [{
              message: {
                content: 'The Dubai Pro Setup Package on your screen includes licensing, visa quota, and corporate bank assistance.',
              },
            }],
          };
        },
      },
    },
  };

  const runtime = createSharedAiRuntime({
    geminiProvider: mockGemini,
    openaiClient: mockOpenAi,
  });

  const res = await runtime.generateAiResponse({
    systemInstruction: `You are assistant.\n${pageContextPrompt}`,
    prompt: customerQuestion,
    channel: 'WEB_CHAT',
  });

  assert.equal(res.provider, 'openai');
  assert.ok(openaiPayload);
  assert.ok(openaiPayload.messages[0].content.includes(pageContextPrompt));
  assert.equal(openaiPayload.messages[1].content, customerQuestion);
  assert.ok(res.text.includes('Dubai Pro Setup Package'));
});



test('TASK 9.1 PHYSICAL FIX: Real Guide Path Tests (Vertex success, 403 failover, 503 failover, timeout failover, user cancellation)', async () => {
  const guideSystemInstruction = 'You are SamChe AI Guide. Provide strategic business planning.';
  const guideUserText = 'Plan our tech startup formation in Dubai.';

  // Test 1: Guide -> Vertex Success
  const mockGeminiSuccess = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => ({ candidates: [{ content: { parts: [{ text: 'Vertex Guide Plan for Tech Startup' }] } }] }),
  };
  let openaiCalled1 = false;
  const mockOpenAi1 = {
    chat: {
      completions: {
        create: async () => {
          openaiCalled1 = true;
          return { choices: [{ message: { content: 'OpenAI output' } }] };
        },
      },
    },
  };
  const runtime1 = createSharedAiRuntime({ geminiProvider: mockGeminiSuccess, openaiClient: mockOpenAi1, circuitBreaker: new ProviderCircuitBreaker() });
  const res1 = await runtime1.generateAiResponse({
    systemInstruction: guideSystemInstruction,
    prompt: guideUserText,
    channel: 'SAMCHEGUIDE',
  });
  assert.equal(res1.provider, 'vertex');
  assert.equal(res1.text, 'Vertex Guide Plan for Tech Startup');
  assert.equal(openaiCalled1, false);

  // Test 2: Guide -> Simulated Vertex 403 -> OpenAI called
  const mockGemini403 = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => { throw Object.assign(new Error('Vertex AI authentication or permission was denied'), { code: 'GOOGLE_VERTEX_PERMISSION_DENIED', status: 403 }); },
  };
  const mockOpenAi2 = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: 'OpenAI Guide Plan for Tech Startup (403 Failover)' } }] }),
      },
    },
  };
  const runtime2 = createSharedAiRuntime({ geminiProvider: mockGemini403, openaiClient: mockOpenAi2, circuitBreaker: new ProviderCircuitBreaker() });
  const res2 = await runtime2.generateAiResponse({
    systemInstruction: guideSystemInstruction,
    prompt: guideUserText,
    channel: 'SAMCHEGUIDE',
  });
  assert.equal(res2.provider, 'openai');
  assert.equal(res2.text, 'OpenAI Guide Plan for Tech Startup (403 Failover)');

  // Test 3: Guide -> Simulated Vertex 503 -> OpenAI called
  const mockGemini503 = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => { throw Object.assign(new Error('503 The service is temporarily unavailable due to high demand'), { status: 503 }); },
  };
  const runtime3 = createSharedAiRuntime({ geminiProvider: mockGemini503, openaiClient: mockOpenAi2, circuitBreaker: new ProviderCircuitBreaker() });
  const res3 = await runtime3.generateAiResponse({
    systemInstruction: guideSystemInstruction,
    prompt: guideUserText,
    channel: 'SAMCHEGUIDE',
  });
  assert.equal(res3.provider, 'openai');
  assert.equal(res3.failoverReason, 'PROVIDER_CAPACITY_UNAVAILABLE');

  // Test 4: Guide -> Simulated Vertex Timeout -> Fresh OpenAI attempt succeeds
  const mockGeminiTimeout = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => {
      const err = new Error('Google Gemini request timed out');
      err.name = 'AbortError';
      err.code = 'GOOGLE_GEMINI_TIMEOUT';
      throw err;
    },
  };
  let openaiReceivedSignalAborted = null;
  const mockOpenAi4 = {
    chat: {
      completions: {
        create: async (payload, options) => {
          openaiReceivedSignalAborted = Boolean(options?.signal?.aborted);
          return { choices: [{ message: { content: 'OpenAI Guide Plan after Vertex Timeout' } }] };
        },
      },
    },
  };
  const runtime4 = createSharedAiRuntime({ geminiProvider: mockGeminiTimeout, openaiClient: mockOpenAi4, circuitBreaker: new ProviderCircuitBreaker() });
  const callerController = new AbortController();
  const res4 = await runtime4.generateAiResponse({
    systemInstruction: guideSystemInstruction,
    prompt: guideUserText,
    signal: callerController.signal,
    channel: 'SAMCHEGUIDE',
  });
  assert.equal(res4.provider, 'openai');
  assert.equal(res4.text, 'OpenAI Guide Plan after Vertex Timeout');
  assert.equal(openaiReceivedSignalAborted, false, 'OpenAI MUST receive a fresh UNABORTED signal');

  // Test 5: Upstream / User cancellation -> cancels all provider work safely
  const canceledController = new AbortController();
  canceledController.abort(new Error('Client socket closed'));
  await assert.rejects(
    () => runtime1.generateAiResponse({
      systemInstruction: guideSystemInstruction,
      prompt: guideUserText,
      signal: canceledController.signal,
      channel: 'SAMCHEGUIDE',
    }),
    (err) => {
      assert.match(err.message, /Client socket closed|Request was aborted by caller/);
      return true;
    }
  );
});

test('TASK 9.1 PHYSICAL FIX: Real Orchestration Paths for WhatsApp, Instagram, Web Chat, Guide failover', async () => {
  const mockFailingGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => { throw Object.assign(new Error('Vertex 503 High Demand'), { status: 503 }); },
  };

  const channelsToTest = ['WHATSAPP', 'INSTAGRAM', 'WEB_CHAT', 'SAMCHEGUIDE'];
  for (const ch of channelsToTest) {
    let capturedOpenAiChannel = null;
    const mockOpenAi = {
      chat: {
        completions: {
          create: async () => {
            capturedOpenAiChannel = ch;
            return { choices: [{ message: { content: `OpenAI response for channel ${ch}` } }] };
          },
        },
      },
    };

    const runtime = createSharedAiRuntime({
      geminiProvider: mockFailingGemini,
      openaiClient: mockOpenAi,
      circuitBreaker: new ProviderCircuitBreaker({ failureThreshold: 10 }),
    });

    const res = await runtime.generateAiResponse({
      systemInstruction: `You are assistant on channel ${ch}.`,
      prompt: `Customer message on ${ch}`,
      channel: ch,
    });

    assert.equal(res.provider, 'openai');
    assert.equal(res.text, `OpenAI response for channel ${ch}`);
    assert.equal(capturedOpenAiChannel, ch);
    assert.equal(res.fallbackUsed, false);
  }
});


test('TASK 9.1 PHYSICAL REGRESSION FIX: WhatsApp Multi-turn Image Follow-up (Vertex & OpenAI failover)', async () => {
  // Scenario: Turn 1 image uploaded ("SAMCHE IMAGE 8472"), Turn 2 customer asks "WHAT IS THE NUMBER?"
  const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const imagePart = {
    inlineData: { mimeType: 'image/png', data: fakeBase64 },
    inline_data: { mime_type: 'image/png', data: fakeBase64 },
  };

  const history = [
    { sender_type: 'CUSTOMER', content: '' },
    { sender_type: 'ASSISTANT', content: 'Your image has been received. What would you like me to examine? I can read visible text, inspect specific details, or answer questions based on the image.' },
  ];

  const tenant = {
    companyName: 'Blue Dune',
    assistantName: 'Blue Dune Assistant',
    systemPrompt: 'Blue Dune event management and luxury design policy.',
  };

  const { systemInstruction, userPrompt } = (await import('../services/whatsapp-tenant-context-service.js')).buildWhatsAppTenantModelContext({
    tenant,
    history,
    customerText: 'WHAT IS THE NUMBER?',
    communicationLanguage: 'en',
  });

  // Verify prompt and history formatting
  assert.ok(systemInstruction.includes('ATTACHED EVIDENCE & MULTIMODAL GROUNDING'));
  assert.ok(userPrompt.includes('WHAT IS THE NUMBER?'));

  // Test 1: Vertex Primary execution
  let vertexReceivedParts = null;
  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async ({ contents }) => {
      vertexReceivedParts = contents[0].parts;
      return { candidates: [{ content: { parts: [{ text: 'The number visible in the image is 8472.' }] } }] };
    },
  };
  const runtime1 = createSharedAiRuntime({ geminiProvider: mockGemini, circuitBreaker: new ProviderCircuitBreaker() });
  const res1 = await runtime1.generateAiResponse({
    systemInstruction,
    prompt: userPrompt,
    multimodalParts: [imagePart],
    channel: 'WHATSAPP',
  });
  assert.equal(res1.provider, 'vertex');
  assert.match(res1.text, /8472/);
  assert.ok(vertexReceivedParts.some((p) => p.inlineData?.data === fakeBase64));

  // Test 2: OpenAI Failover execution
  let openaiReceivedContent = null;
  const mockOpenAi = {
    chat: {
      completions: {
        create: async (payload) => {
          openaiReceivedContent = payload.messages[1].content;
          return { choices: [{ message: { content: 'Based on the attached image, the number is 8472.' } }] };
        },
      },
    },
  };
  const mockFailingGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => { throw Object.assign(new Error('503 High Demand'), { status: 503 }); },
  };
  const runtime2 = createSharedAiRuntime({ geminiProvider: mockFailingGemini, openaiClient: mockOpenAi, circuitBreaker: new ProviderCircuitBreaker() });
  const res2 = await runtime2.generateAiResponse({
    systemInstruction,
    prompt: userPrompt,
    multimodalParts: [imagePart],
    channel: 'WHATSAPP',
  });
  assert.equal(res2.provider, 'openai');
  assert.match(res2.text, /8472/);
  assert.ok(Array.isArray(openaiReceivedContent));
  assert.equal(openaiReceivedContent[1].type, 'image_url');
  assert.equal(openaiReceivedContent[1].image_url.url, `data:image/png;base64,${fakeBase64}`);
});

test('TASK 9.1 PHYSICAL REGRESSION FIX: Multi-turn PDF & URL natural follow-ups and intent switching', async () => {
  // 1. PDF follow-up
  const pdfEvidence = '<customer_document_evidence>\nINVOICE #9821\nTotal: 4500 AED\n</customer_document_evidence>';
  const mockGeminiPdf = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => ({ candidates: [{ content: { parts: [{ text: 'The total amount on invoice #9821 is 4500 AED.' }] } }] }),
  };
  const runtimePdf = createSharedAiRuntime({ geminiProvider: mockGeminiPdf, circuitBreaker: new ProviderCircuitBreaker() });
  const resPdf = await runtimePdf.generateAiResponse({
    systemInstruction: 'You are assistant with attached document grounding.',
    prompt: 'Recent conversation history:\nASSISTANT: Your document has been received.\n\nCurrent customer message:\nWhat is the total?',
    multimodalParts: [{ text: pdfEvidence }],
    channel: 'WHATSAPP',
  });
  assert.equal(resPdf.provider, 'vertex');
  assert.match(resPdf.text, /4500 AED/);

  // 2. Intent Switching (User changes topic to booking problem)
  const bookingQuestion = 'I have a problem with an existing booking.';
  const { classifyWhatsAppCurrentCustomerIntent } = await import('../services/whatsapp-tenant-context-service.js');
  const classifiedIntent = classifyWhatsAppCurrentCustomerIntent(bookingQuestion);
  assert.equal(classifiedIntent, 'TOPIC_PRESENT');
});


test('TASK 9.1 PHYSICAL REGRESSION FIX: Real Path WhatsApp URL Reading - Direct HTTPS on Vertex & OpenAI failover', async () => {
  const { processMessageUrlIntelligence } = await import('../services/url-intelligence-service.js');
  const { buildContextualIntelligencePromptSection, updateSessionBrowsingStateWithEntity } = await import('../services/contextual-intelligence-service.js');
  const { buildWhatsAppActivePersonaTenantContext, buildWhatsAppTenantModelContext } = await import('../services/whatsapp-tenant-context-service.js');

  const directHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Dubai Luxury Event Package 2026</title>
        <meta property="og:description" content="Exclusive desert gala package with VIP setup and staging for 25000 AED." />
      </head>
      <body>
        <h1>Dubai Luxury Event Package</h1>
        <p>Complete luxury setup includes audio visual, catering, and venue management.</p>
      </body>
    </html>
  `;

  const mockDirectFetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => directHtml,
  });

  const mockDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  // 1. Inbound URL Detection & Safe Fetch
  const urlResultA = await processMessageUrlIntelligence({
    text: 'Please check our event link https://example.com/packages/luxury-desert-gala',
    fetchImpl: mockDirectFetch,
    lookupImpl: mockDnsLookup,
  });

  assert.equal(urlResultA.hasUrl, true);
  assert.equal(urlResultA.success, true);
  assert.ok(urlResultA.entity);
  assert.match(urlResultA.entity.entity_name, /Dubai Luxury Event Package/i);
  assert.match(urlResultA.entity.summary, /25000 AED/);

  // 2. Canonical Context Construction
  let browsingState = updateSessionBrowsingStateWithEntity({
    currentState: null,
    newEntity: urlResultA.entity,
  });
  const contextualSection = buildContextualIntelligencePromptSection({
    currentEntity: browsingState.currentEntity,
    channelType: 'WHATSAPP',
  });

  const activePersona = {
    available: true,
    companyIdentity: 'Blue Dune',
    assistantIdentity: 'Blue Dune Assistant',
    profile: {},
    configuration: {},
  };

  const runtimeTenantContext = buildWhatsAppActivePersonaTenantContext({
    persona: activePersona,
    communicationLanguage: 'en',
    contextualIntelligence: contextualSection,
  });

  const modelContextTurn1 = buildWhatsAppTenantModelContext({
    tenant: runtimeTenantContext,
    history: [],
    customerText: 'Please check our event link https://example.com/packages/luxury-desert-gala',
    communicationLanguage: 'en',
  });

  // Verify Vertex Primary receives extracted URL context & does not refuse
  let vertexReceivedTurn1 = null;
  const mockGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async (p) => {
      vertexReceivedTurn1 = p;
      return { candidates: [{ content: { parts: [{ text: 'I checked your link. The Dubai Luxury Event Package is 25000 AED and includes VIP staging and desert gala setup.' }] } }] };
    },
  };
  const runtimeVertex = createSharedAiRuntime({ geminiProvider: mockGemini, circuitBreaker: new ProviderCircuitBreaker() });
  const resTurn1 = await runtimeVertex.generateAiResponse({
    systemInstruction: modelContextTurn1.systemInstruction,
    prompt: modelContextTurn1.userPrompt,
    channel: 'WHATSAPP',
  });
  assert.equal(resTurn1.provider, 'vertex');
  assert.match(resTurn1.text, /25000 AED/);
  assert.doesNotMatch(resTurn1.text, /cannot access external links/i);
  assert.ok(vertexReceivedTurn1.systemInstruction.parts[0].text.includes('Dubai Luxury Event Package'));

  // Multi-turn Follow-up Turn 2: "What is included in the package on that page?"
  const modelContextTurn2 = buildWhatsAppTenantModelContext({
    tenant: runtimeTenantContext,
    history: [
      { sender_type: 'CUSTOMER', content: 'Please check our event link https://example.com/packages/luxury-desert-gala' },
      { sender_type: 'ASSISTANT', content: resTurn1.text },
    ],
    customerText: 'What is included in the package on that page?',
    communicationLanguage: 'en',
  });

  // Test Turn 2 on OpenAI Failover
  const mockOpenAi = {
    chat: {
      completions: {
        create: async (payload) => {
          assert.ok(payload.messages[0].content.includes('25000 AED'));
          return { choices: [{ message: { content: 'Based on the page you shared, the package includes audio visual, catering, and venue management.' } }] };
        },
      },
    },
  };
  const mockFailingGemini = {
    mode: 'vertex',
    runtimeMetadata: () => ({ provider: 'GOOGLE_GEMINI', mode: 'vertex', model: 'gemini-3.7-flash', endpoint_class: 'VERTEX_GENERATE_CONTENT' }),
    generateContent: async () => { throw Object.assign(new Error('503 High Demand'), { status: 503 }); },
  };
  const runtimeOpenAi = createSharedAiRuntime({ geminiProvider: mockFailingGemini, openaiClient: mockOpenAi, circuitBreaker: new ProviderCircuitBreaker() });
  const resTurn2 = await runtimeOpenAi.generateAiResponse({
    systemInstruction: modelContextTurn2.systemInstruction,
    prompt: modelContextTurn2.userPrompt,
    channel: 'WHATSAPP',
  });
  assert.equal(resTurn2.provider, 'openai');
  assert.match(resTurn2.text, /audio visual/i);
  assert.doesNotMatch(resTurn2.text, /cannot access external links/i);
});


test('TASK 9.1 PHYSICAL REGRESSION FIX: Real Path WhatsApp URL Reading - Safe Redirect & Share URL', async () => {
  const { processMessageUrlIntelligence } = await import('../services/url-intelligence-service.js');

  const redirectTargetHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Google Shared Doc - Conference Gala Schedule</title>
        <meta property="og:description" content="Conference opening gala starts at 7:00 PM at Grand Ballroom." />
      </head>
      <body>
        <p>Event schedule details</p>
      </body>
    </html>
  `;

  let redirectHopCount = 0;
  const mockRedirectFetch = async (url) => {
    if (url.includes('share.google/doc-123')) {
      redirectHopCount++;
      return {
        status: 302,
        ok: false,
        headers: new Headers({ location: 'https://docs.google.com/document/d/doc-123/view' }),
      };
    }
    return {
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => redirectTargetHtml,
    };
  };

  const mockDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  const urlResultB = await processMessageUrlIntelligence({
    text: 'Here is the schedule link: https://share.google/doc-123',
    fetchImpl: mockRedirectFetch,
    lookupImpl: mockDnsLookup,
  });

  assert.equal(urlResultB.hasUrl, true);
  assert.equal(urlResultB.success, true);
  assert.equal(redirectHopCount, 1);
  assert.match(urlResultB.entity.entity_name, /Conference Gala Schedule/i);
  assert.match(urlResultB.entity.summary, /7:00 PM/);
});



