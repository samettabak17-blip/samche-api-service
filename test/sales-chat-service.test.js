import test from 'node:test';
import assert from 'node:assert/strict';
import * as salesChat from '../services/sales-chat-service.js';

for (const reply of [
  "Your demo has been confirmed for tomorrow.",
  "We have sent an email confirming your demo.",
  "We've successfully booked your appointment.",
  "Our sales team has scheduled your meeting for tomorrow.",
  "The team has set a meeting for tomorrow.",
  "Your demo is on the calendar for tomorrow.",
  "Our team will book an appointment tomorrow.",
  "No problem, your demo has been confirmed.",
  "I have not sent an email, but your demo has been booked.",
  "تم تأكيد موعد العرض التوضيحي غداً.",
  "لقد حجزنا موعدك غداً.",
  "سنرسل رسالة بريد إلكتروني لتأكيد موعد العرض.",
  "تم تحديد موعد العرض غداً.",
  "سيتم تحديد موعد العرض غداً.",
  "قام فريقنا بحجز اجتماعك غداً.",
  "موعدك مؤكد غداً.",
  "لا مشكلة، تم حجز موعد العرض."
]) {
  test(`final regression: backend blocks ${reply}`, () => {
    assert.notEqual(salesChat.sanitizeSalesReply(reply), reply);
    for (const safeReply of ["Your demo has not been confirmed.","We have not booked your appointment.","No appointment has been scheduled.","We have not sent an email confirming your demo.","Please share your preferred appointment time.","Your preferred demo time is tomorrow.","لم يتم تأكيد موعد العرض.","لم نرسل بريداً إلكترونياً لتأكيد موعدك.","يرجى مشاركة الوقت المفضل للعرض."]) assert.equal(salesChat.sanitizeSalesReply(safeReply), safeReply);
  });
}

for (const [reason, override] of [
  ['invalid_intent', { intent: 'synthetic.person@example.com' }],
  ['invalid_response_mode', { responseMode: 'synthetic.person@example.com' }],
  ['invalid_next_field', { requestedNextField: 'synthetic.person@example.com' }],
  ['invalid_action', { actionIntent: ['synthetic.person@example.com'] }],
  ['unsupported_field', { extractedFields: { 'synthetic.person@example.com': 'secret' } }],
]) {
  test(`final regression: staging diagnostics redact ${reason}`, async () => {
    const logs = [];
    const service = createSalesChatService({
      openaiClient: providerWith(JSON.stringify({
        reply: 'Tell me about your business.', intent: 'qualification', responseMode: 'qualification_answer',
        resumePendingQuestion: true, extractedFields: {}, requestedNextField: null, actionIntent: [], ...override,
      })),
      commercialFacts, environment: { NODE_ENV: 'staging' }, logger: { warn: (...args) => logs.push(args) },
    });
    const result = await service.handle({ body: requestBody() });
    assert.equal(result.status, 422);
    assert.deepEqual(logs, [['sales_chat_validation_failed', { reason }]]);
    assert.doesNotMatch(JSON.stringify(logs), /synthetic\.person@example\.com|secret/);
  });
}


const { createSalesChatRateLimiter, createSalesChatService, validateSalesLlmOutput } = salesChat;

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

test('rewrites unavailable scheduling and email confirmation claims to preference-only availability', () => {
  for (const reply of [
    'Your demo is confirmed tomorrow at 18:00. You will receive an email confirmation.',
    'Your demo is set for tomorrow.',
    'I have sent your confirmation email.',
    'I scheduled your demo.',
    'We booked your appointment.',
    'I will send a confirmation email.',
  ]) {
    const result = salesChat.sanitizeSalesReply(reply);
    assert.match(result, /preferred demo time/i);
    assert.match(result, /confirm availability/i);
    assert.doesNotMatch(result, /confirmed|scheduled|booked|set for|sent your confirmation email|send a confirmation email|email confirmation/i);
  }
});

test('preserves safe denials and preferences during sales reply sanitization', () => {
  for (const reply of ['I cannot confirm an appointment.', 'Please share your preferred appointment time.']) {
    assert.equal(salesChat.sanitizeSalesReply(reply), reply);
  }
});

test('ignores client capability overrides in provider context', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'Tell me about your business.', intent: 'qualification', extractedFields: {},
      requestedNextField: 'industry', actionIntent: [], responseMode: 'qualification_answer', resumePendingQuestion: true,
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({ actionCapabilities: { canConfirmAppointment: true } }) });
  assert.equal(result.context.capabilities.canConfirmAppointment, false);
});

test('sanitizes unsafe claims from interrupt responses and removes action intent', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'Your demo is booked for tomorrow.', intent: 'demo_question', extractedFields: {},
      requestedNextField: null, actionIntent: ['REQUEST_DEMO'], responseMode: 'demo_interrupt', resumePendingQuestion: true,
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({ responseMode: 'demo_interrupt', userMessage: 'Book a demo.' }) });
  assert.match(result.body.reply, /preferred demo time|confirm availability/i);
  assert.match(result.body.reply, /What type of business do you operate\?/i);
  assert.equal(result.body.resumePendingQuestion, true);
  assert.deepEqual(result.body.actionIntent, []);
});

test('rewrites future-tense and Arabic scheduling or email promises', () => {
  for (const unsafe of [
    'We will schedule your demo tomorrow.',
    'We will confirm your appointment tomorrow.',
    'We will email you a confirmation.',
    'Would you like to proceed with setting up a demo tomorrow at 18:00?',
    'Shall we proceed with scheduling your demo for tomorrow at 18:00?',
    'سنحدد موعد العرض غداً.',
    'سيقوم فريقنا بجدولة اجتماعك غداً.',
  ]) {
    const safe = salesChat.sanitizeSalesReply(unsafe);
    assert.notEqual(safe, unsafe, unsafe);
    assert.doesNotMatch(safe, /\b(?:will|going to)\s+(?:schedule|book|email)\b|\b(?:will|going to)\s+confirm(?!\s+availability)\b|(?:demo|appointment|meeting).{0,40}(?:scheduled|booked|confirmed)|(?:سنحدد|بجدولة|تأكيد موعد|حجز موعد)/i);
  }
});

test('does not return provider-selected actions for usable interrupt responses', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'SamChe AI supports first-response work while human sales staff remain important for languages and closing.',
      intent: 'capability_question', extractedFields: {}, requestedNextField: 'languages',
      actionIntent: ['REQUEST_DEMO', 'WHATSAPP_HANDOFF'], responseMode: 'capability_interrupt', resumePendingQuestion: true,
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({
    responseMode: 'capability_interrupt', userMessage: 'Can this AI replace staff?',
    pendingQualificationField: 'languages', lastPendingQuestion: 'Which languages do you need?',
  }) });
  assert.deepEqual(result.body.actionIntent, []);
});

test('builds bounded context from server-owned commercial facts and returns validated output', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'Which channels bring you the most enquiries?', intent: 'qualification', extractedFields: {},
      requestedNextField: 'channels', actionIntent: [], responseMode: 'qualification_answer', resumePendingQuestion: true,
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
      requestedNextField: null, actionIntent: [], responseMode: 'pricing_interrupt', resumePendingQuestion: true,
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
  openaiClient: { chat: { completions: { create: async (...args) => { request = args[0]; return { choices: [{ message: { content: JSON.stringify({ reply: 'Tell me about your business.', intent: 'qualification', extractedFields: {}, requestedNextField: 'industry', actionIntent: [], responseMode: 'qualification_answer', resumePendingQuestion: true }) } }] }; } } } },
    commercialFacts,
  });
  const result = await service.handle({ body: requestBody() });
  assert.equal(result.status, 200);
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.equal(request.response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(request.response_format.json_schema.schema.required, ['reply', 'intent', 'responseMode', 'resumePendingQuestion', 'extractedFields', 'requestedNextField', 'actionIntent']);
});

test('normalizes only explicit safe enum and field aliases before validation', () => {
  const result = validateSalesLlmOutput({
    reply: 'Growth may be the closest fit for your business.',
    intent: 'off-topic',
    extractedFields: { team_users: '3' },
    requestedNextField: 'team_users',
    actionIntent: [], responseMode: 'off_topic', resumePendingQuestion: true,
  }, { plans: commercialFacts.plans, products: commercialFacts.products });
  assert.equal(result.ok, true);
  assert.equal(result.value.intent, 'off_topic');
  assert.equal(result.value.requestedNextField, 'teamUsers');
  assert.deepEqual(result.value.extractedFields, { teamUsers: '3' });
});

test('does not normalize unknown extracted field names', () => {
  const result = validateSalesLlmOutput({
    reply: 'Tell me more about your team.', intent: 'qualification', extractedFields: { teamSize: '3' },
    requestedNextField: 'teamUsers', actionIntent: [], responseMode: 'qualification_answer', resumePendingQuestion: true,
  }, { plans: commercialFacts.plans, products: commercialFacts.products });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported_field');
  assert.equal(result.field, 'teamSize');
});

test('logs only sanitized validation diagnostics in the staging environment', async () => {
  const logs = [];
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({ reply: 'I can help.', intent: 'general', extractedFields: {}, requestedNextField: null, actionIntent: [], responseMode: 'qualification_answer', resumePendingQuestion: true })),
    commercialFacts,
    environment: { RENDER_SERVICE_NAME: 'samche-api-staging' },
    logger: { warn: (...args) => logs.push(args) },
  });
  const result = await service.handle({ body: requestBody() });
  assert.equal(result.status, 422);
  assert.deepEqual(logs, [['sales_chat_validation_failed', { reason: 'invalid_intent' }]]);
});

test('preserves an explicit capability interrupt mode and pending-question resume contract', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'SamChe AI supports first-response work while human sales staff remain important for complex negotiations and closing.',
      intent: 'capability_question', extractedFields: {}, requestedNextField: 'languages', actionIntent: [],
      responseMode: 'capability_interrupt', resumePendingQuestion: true,
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({
    responseMode: 'capability_interrupt',
    userMessage: 'Can this AI replace one of my sales staff?',
    pendingQualificationField: 'languages',
    lastPendingQuestion: 'Which languages do you need the assistant to support?',
  }) });

  assert.equal(result.status, 200);
  assert.equal(result.context.responseMode, 'capability_interrupt');
  assert.equal(result.context.userMessage, 'Can this AI replace one of my sales staff?');
  assert.equal(result.body.responseMode, 'capability_interrupt');
  assert.equal(result.body.resumePendingQuestion, true);
});

test('server enforcement repairs conflicting capability intent and removes model actions', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'Which languages do you need?', intent: 'off_topic', extractedFields: {}, requestedNextField: 'languages',
      actionIntent: ['REQUEST_DEMO', 'WHATSAPP_HANDOFF'], responseMode: 'capability_interrupt', resumePendingQuestion: true,
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({
    responseMode: 'capability_interrupt', detectedIntent: 'capability_question',
    pendingQualificationField: 'languages', lastPendingQuestion: 'Which languages do you need?',
    userMessage: 'Can this AI replace one of my sales staff?',
  }) });

  assert.equal(result.status, 200);
  assert.equal(result.body.intent, 'capability_question');
  assert.equal(result.body.responseMode, 'capability_interrupt');
  assert.deepEqual(result.body.actionIntent, []);
  assert.match(result.body.reply, /first-response|sales staff|negotiat|human/i);
  assert.match(result.body.reply, /languages/i);
});

test('server enforcement falls back to approved pricing when the model returns only the pending question', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'How many people will use the shared inbox?', intent: 'pricing_question', extractedFields: {}, requestedNextField: 'teamUsers',
      actionIntent: ['REQUEST_DEMO', 'WHATSAPP_HANDOFF'], responseMode: 'pricing_interrupt', resumePendingQuestion: true,
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({
    responseMode: 'pricing_interrupt', detectedIntent: 'pricing_question', recommendedPlan: 'growth',
    pendingQualificationField: 'teamUsers', lastPendingQuestion: 'How many people will use the shared inbox?',
    userMessage: 'How much does Growth cost?',
  }) });

  assert.equal(result.status, 200);
  assert.equal(result.body.intent, 'pricing_question');
  assert.equal(result.body.responseMode, 'pricing_interrupt');
  assert.deepEqual(result.body.actionIntent, []);
  assert.match(result.body.reply, /AED 3,990\/month/);
  assert.match(result.body.reply, /shared inbox|team/i);
});

test('server enforcement keeps AI Guide as a product interrupt even when the model misclassifies it', async () => {
  const service = createSalesChatService({
    openaiClient: providerWith(JSON.stringify({
      reply: 'AI Guide is useful.', intent: 'capability_question', extractedFields: {}, requestedNextField: 'languages',
      actionIntent: ['REQUEST_DEMO'], responseMode: 'in_scope_interrupt', resumePendingQuestion: true,
    })), commercialFacts,
  });
  const result = await service.handle({ body: requestBody({
    responseMode: 'in_scope_interrupt', detectedIntent: 'product_question', pendingQualificationField: 'languages',
    lastPendingQuestion: 'Which languages do you need?', userMessage: 'How does AI Guide work?',
  }) });

  assert.equal(result.status, 200);
  assert.equal(result.body.intent, 'feature_question');
  assert.equal(result.body.responseMode, 'in_scope_interrupt');
  assert.deepEqual(result.body.actionIntent, []);
  assert.match(result.body.reply, /AI Guide/i);
  assert.match(result.body.reply, /languages/i);
});
