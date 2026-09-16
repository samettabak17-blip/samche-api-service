import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesChatRateLimiter, createSalesChatService, validateSalesLlmOutput } from '../services/sales-chat-service.js';

const commercialFacts = {
  plans: [
    { slug: 'growth', name: 'GROWTH', monthly: 3990, setup: 5000, yearly: 40698, interactions: '20,000', features: ['Web Chatbot + WhatsApp AI', 'Up to 5 Team Users'] },
  ],
  products: [
    { name: 'Web Chatbot', status: 'Available' },
    { name: 'WhatsApp AI', status: 'Available' },
    { name: 'AI Guide', status: 'Available' },
  ],
};

function providerWith(content) {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } };
}

function requestBody(overrides = {}) {
  return {
    locale: 'en', conversationHistory: [], leadState: {}, qualificationStage: 'discovery',
    pendingQualificationField: 'industry', lastPendingQuestion: 'What type of business do you operate?',
    recommendedPlan: '', userMessage: 'I run a real estate company in Dubai.', ...overrides,
  };
}

test('builds bounded context from server-owned commercial facts and returns validated output', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'Which channels bring you the most enquiries?', intent: 'qualification', extractedFields: {},
      requestedNextField: 'channels', actionIntent: [],
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({ approvedPlanFacts: [{ slug: 'business', monthly: 1 }], leadState: { industry: 'Real Estate' } }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.requestedNextField, 'channels');
  assert.equal(result.context.approvedPlanFacts[0].monthly, 3990);
  assert.equal(result.context.approvedPlanFacts[0].slug, 'growth');
  assert.equal(result.context.leadState.industry, 'Real Estate');
});

test('rejects provider output with unsupported commercial claims without exposing provider details', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'Growth is free and unlimited at AED 1,000.', intent: 'pricing', extractedFields: {},
      requestedNextField: null, actionIntent: [],
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({ userMessage: 'What is the price?' }) });
  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { error: 'Sales assistant response was not usable.' });
});

test('returns a safe response when the OpenAI client fails', async () => {
  const service = createSalesChatService({
    openaiClient: { chat: { completions: { create: async () => { throw new Error('secret provider failure'); } } } }, commercialFacts,
  });
  const result = await service.handle({ body: requestBody() });
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: 'Sales assistant is temporarily unavailable.' });
});

test('rejects oversized messages and histories before calling OpenAI', async () => {
  let calls = 0;
  const service = createSalesChatService({
    openaiClient: { chat: { completions: { create: async () => { calls += 1; return {}; } } } }, commercialFacts,
  });
  const result = await service.handle({ body: requestBody({ userMessage: 'x'.repeat(2001), conversationHistory: Array.from({ length: 13 }, () => ({ role: 'user', text: 'x' })) }) });
  assert.equal(result.status, 400);
  assert.equal(calls, 0);
});

test('rate limiter allows the configured burst and rejects the next request', () => {
  let now = 1000;
  const limiter = createSalesChatRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.allow('203.0.113.5'), true);
  assert.equal(limiter.allow('203.0.113.5'), true);
  assert.equal(limiter.allow('203.0.113.5'), false);
  now += 1001;
  assert.equal(limiter.allow('203.0.113.5'), true);
});

test('uses strict JSON Schema response format for the provider contract', async () => {
  let request;
  const service = createSalesChatService({
    openaiClient: { chat: { completions: { create: async (...args) => { request = args[0]; return { choices: [{ message: { content: JSON.stringify({ reply: 'Tell me about your business.', intent: 'qualification', extractedFields: {}, requestedNextField: 'industry', actionIntent: [] }) } }] }; } } } },
    commercialFacts,
  });
  const result = await service.handle({ body: requestBody() });
  assert.equal(result.status, 200);
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(request.response_format.json_schema.schema.required, ['reply', 'intent', 'extractedFields', 'requestedNextField', 'actionIntent']);
});

test('normalizes only explicit safe enum and field aliases before validation', () => {
  const result = validateSalesLlmOutput({
    reply: 'Growth may be the closest fit for your business.',
    intent: 'off-topic',
    extractedFields: { team_users: '3' },
    requestedNextField: 'team_users',
    actionIntent: [],
  }, { plans: commercialFacts.plans, products: commercialFacts.products });
  assert.equal(result.ok, true);
  assert.equal(result.value.intent, 'off_topic');
  assert.equal(result.value.requestedNextField, 'teamUsers');
  assert.deepEqual(result.value.extractedFields, { teamUsers: '3' });
});

test('does not normalize unknown extracted field names', () => {
  const result = validateSalesLlmOutput({
    reply: 'Tell me more about your team.', intent: 'qualification', extractedFields: { teamSize: '3' },
    requestedNextField: 'teamUsers', actionIntent: [],
  }, { plans: commercialFacts.plans, products: commercialFacts.products });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported_field');
  assert.equal(result.field, 'teamSize');
});

test('logs only sanitized validation diagnostics in the staging environment', async () => {
  const logs = [];
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({ reply: 'I can help.', intent: 'general', extractedFields: {}, requestedNextField: null, actionIntent: [] })),
    commercialFacts,
    environment: { RENDER_SERVICE_NAME: 'samche-api-staging' },
    logger: { warn: (...args) => logs.push(args) },
  });
  const result = await service.handle({ body: requestBody() });
  assert.equal(result.status, 422);
  assert.deepEqual(logs, [['sales_chat_validation_failed', { reason: 'invalid_intent', value: 'general' }]]);
});
