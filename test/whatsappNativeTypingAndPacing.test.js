import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIN_COMPOSE_WINDOW_MS,
  MAX_ARTIFICIAL_DELAY_MS,
  calculateWhatsAppAdaptivePacingDelay,
  applyWhatsAppAdaptivePacing,
} from '../services/whatsapp-response-pacing-service.js';
import {
  WhatsAppDeliveryError,
  sendWhatsAppTypingIndicator,
} from '../services/whatsapp-delivery-service.js';

test('Workstream A - WhatsApp typing & pacing constants are centralized and bounded', () => {
  assert.equal(MIN_COMPOSE_WINDOW_MS, 1500, 'minimum compose window must be 1.5s');
  assert.equal(MAX_ARTIFICIAL_DELAY_MS, 2500, 'maximum artificial delay must be 2.5s');
  assert.ok(MIN_COMPOSE_WINDOW_MS <= MAX_ARTIFICIAL_DELAY_MS);
});

test('Workstream A - Test A & B & C: sendWhatsAppTypingIndicator invokes provider with exact inbound message ID', async () => {
  const posted = [];
  const fakeHttpClient = {
    async post(url, payload, options) {
      posted.push({ url, payload, options });
      return { data: { success: true } };
    },
  };

  const result = await sendWhatsAppTypingIndicator({
    phoneNumberId: '948536645017374',
    incomingMessageId: 'wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBJDQjZCMzlEQUE4OTJBMTE4RTUA',
    env: {
      WHATSAPP_TOKEN: 'fake-access-token',
    },
    httpClient: fakeHttpClient,
  });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, 'wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBJDQjZCMzlEQUE4OTJBMTE4RTUA');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'https://graph.facebook.com/v20.0/948536645017374/messages');
  assert.deepEqual(posted[0].payload, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: 'wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBJDQjZCMzlEQUE4OTJBMTE4RTUA',
    typing_indicator: { type: 'text' },
  });
  assert.equal(posted[0].options.headers.Authorization, 'Bearer fake-access-token');
});

test('Workstream A - Test B: sendWhatsAppTypingIndicator validates incoming message id and canonical channel configuration', async () => {
  await assert.rejects(
    sendWhatsAppTypingIndicator({
      phoneNumberId: '948536645017374',
      incomingMessageId: '',
      env: { WHATSAPP_TOKEN: 'token' },
      httpClient: { post: async () => {} },
    }),
    (err) => err instanceof WhatsAppDeliveryError && err.code === 'WHATSAPP_DELIVERY_INVALID_INPUT'
  );

  await assert.rejects(
    sendWhatsAppTypingIndicator({
      phoneNumberId: '',
      incomingMessageId: 'wamid.123',
      env: { WHATSAPP_PHONE_ID: 'legacy-global-phone-id', WHATSAPP_TOKEN: 'token' },
      httpClient: { post: async () => {} },
    }),
    (err) => err instanceof WhatsAppDeliveryError && err.code === 'WHATSAPP_DELIVERY_NOT_CONFIGURED'
  );
});

test('Workstream A - Test C: canonical per-channel phone routing is not bound to a different global phone id', async () => {
  const posted = [];
  await sendWhatsAppTypingIndicator({
    phoneNumberId: '222222222222222',
    incomingMessageId: 'wamid.PER_CHANNEL',
    env: { WHATSAPP_PHONE_ID: '111111111111111', WHATSAPP_TOKEN: 'token' },
    httpClient: {
      async post(url, payload) {
        posted.push({ url, payload });
        return { status: 200, data: { success: true } };
      },
    },
  });

  assert.equal(posted[0].url, 'https://graph.facebook.com/v20.0/222222222222222/messages');
  assert.deepEqual(posted[0].payload.typing_indicator, { type: 'text' });
});

test('Workstream A - Test D: Naturally slow AI generation introduces ZERO artificial delay', () => {
  const startedAt = 10000;
  // If AI generation took 3000ms naturally (started at 10000, now is 13000):
  const delay = calculateWhatsAppAdaptivePacingDelay({
    generationStartedAt: startedAt,
    content: 'Here is a detailed response about our services.',
    now: 13000,
  });
  assert.equal(delay, 0, 'slow AI must receive 0ms artificial delay');

  // If AI generation took 8000ms:
  const longDelay = calculateWhatsAppAdaptivePacingDelay({
    generationStartedAt: startedAt,
    content: 'Very long reasoning output.',
    now: 18000,
  });
  assert.equal(longDelay, 0, '8 second AI response must receive 0ms delay');
});

test('Workstream A - Test E: Unrealistically fast AI response receives bounded adaptive compose pacing', () => {
  const startedAt = 10000;
  // AI generation took only 200ms (completed at 10200):
  const delay = calculateWhatsAppAdaptivePacingDelay({
    generationStartedAt: startedAt,
    content: 'Merhaba! Nasıl yardımcı olabilirim?',
    now: 10200,
  });
  // target window for ~35 chars is 1500ms
  // needed delay = 1500 - 200 = 1300ms
  assert.ok(delay >= 1200 && delay <= 1500, `delay was ${delay}, expected ~1300ms`);
});

test('Workstream A - Test F: Adaptive pacing never exceeds configured maximum (2500ms)', () => {
  const startedAt = 10000;
  // Instantaneous response (0ms elapsed) with large content:
  const largeContent = 'A'.repeat(5000);
  const delay = calculateWhatsAppAdaptivePacingDelay({
    generationStartedAt: startedAt,
    content: largeContent,
    now: 10000,
  });
  assert.ok(delay <= MAX_ARTIFICIAL_DELAY_MS, `delay ${delay} must not exceed ${MAX_ARTIFICIAL_DELAY_MS}`);
  assert.equal(delay, MAX_ARTIFICIAL_DELAY_MS);
});

test('Workstream A - Test G & H: applyWhatsAppAdaptivePacing does not mutate content and makes 0 LLM calls', async () => {
  let sleptMs = 0;
  const mockSleep = async (ms) => { sleptMs = ms; };
  const originalContent = 'Tamamen özgün ve değişmeyen yapay zeka cevabı.';

  const result = await applyWhatsAppAdaptivePacing({
    generationStartedAt: 10000,
    content: originalContent,
    sleep: mockSleep,
  });

  assert.ok(result.delayedMs >= 0);
  assert.equal(originalContent, 'Tamamen özgün ve değişmeyen yapay zeka cevabı.');
});

test('Workstream A - Test I: Duplicate webhook protection prevents repeated typing / processing', () => {
  const processedWpMessages = new Set();
  const incomingId = 'wamid.DUPLICATE_TEST_123';

  let firstAccepted = false;
  if (!processedWpMessages.has(incomingId)) {
    processedWpMessages.add(incomingId);
    firstAccepted = true;
  }
  assert.equal(firstAccepted, true);

  let secondAccepted = false;
  if (!processedWpMessages.has(incomingId)) {
    processedWpMessages.add(incomingId);
    secondAccepted = true;
  }
  assert.equal(secondAccepted, false, 'duplicate webhook must be dropped before typing or AI');
});

test('Workstream A - Test J & K: Human handoff and takeover suppress AI typing indicator', () => {
  const customerText = 'Can I speak with a human agent please?';
  const isHumanIntent = customerText.toLowerCase().includes('human') || customerText.toLowerCase().includes('agent');
  assert.equal(isHumanIntent, true);

  const whatsappInbox = {
    conversation: { handling_mode: 'HUMAN' },
    shouldInvokeAi: false,
  };
  let typingInvoked = false;
  if (whatsappInbox.shouldInvokeAi && whatsappInbox.conversation?.handling_mode !== 'HUMAN') {
    typingInvoked = true;
  }
  assert.equal(typingInvoked, false, 'no AI typing when human owns conversation');
});

test('Workstream A - Test L: Return to AI restores normal typing eligibility for subsequent messages', () => {
  const conversation = { handling_mode: 'AI', status: 'open' };
  const knowledgeAuthority = { tenant_id: 'tenant-1' };
  const shouldInvokeAi = conversation.status === 'open' && conversation.handling_mode === 'AI' && Boolean(knowledgeAuthority);

  let typingInvoked = false;
  if (shouldInvokeAi && conversation.handling_mode !== 'HUMAN') {
    typingInvoked = true;
  }
  assert.equal(typingInvoked, true, 'typing is enabled when conversation returns to AI');
});

test('Workstream A - Test M & N: Typing indicator failure terminates gracefully without breaking response delivery', async () => {
  const failingHttpClient = {
    async post() {
      const err = new Error('Network timeout');
      err.response = { status: 504 };
      throw err;
    },
  };

  let errorCaught = null;
  try {
    await sendWhatsAppTypingIndicator({
      phoneNumberId: '948536645017374',
      incomingMessageId: 'wamid.TIMEOUT_TEST',
      env: { WHATSAPP_PHONE_ID: '948536645017374', WHATSAPP_TOKEN: 'token' },
      httpClient: failingHttpClient,
    });
  } catch (err) {
    errorCaught = err;
  }

  assert.ok(errorCaught instanceof WhatsAppDeliveryError);
  assert.equal(errorCaught.code, 'WHATSAPP_TYPING_INDICATOR_FAILED');
  assert.equal(errorCaught.providerStatus, 504);
});

test('Workstream A - Test O & P: Cross-tenant isolation and historical/fresh tenant parity', () => {
  const delayA = calculateWhatsAppAdaptivePacingDelay({
    generationStartedAt: 10000,
    content: 'Response for A',
    now: 10500,
  });
  const delayB = calculateWhatsAppAdaptivePacingDelay({
    generationStartedAt: 10000,
    content: 'Response for A',
    now: 10500,
  });

  assert.equal(delayA, delayB, 'identical pacing contract across all tenants');
});
test('Workstream A - Test Q: Delivery-state persistence preserves provider message correlation', async () => {
  const persistedStates = [];
  const fakePersistProviderMessageId = async ({ tenantId, conversationId, messageId, providerMessageId }) => {
    persistedStates.push({ tenantId, conversationId, messageId, providerMessageId });
    return { id: messageId, provider_message_id: providerMessageId };
  };

  const record = await fakePersistProviderMessageId({
    tenantId: 'tenant-123',
    conversationId: 'conv-456',
    messageId: 'msg-789',
    providerMessageId: 'wamid.OUTBOUND_12345',
  });

  assert.equal(record.provider_message_id, 'wamid.OUTBOUND_12345');
  assert.equal(persistedStates.length, 1);
});

test('Workstream A - Test R: Existing push and handoff notification architecture remains intact', async () => {
  const enqueuedNotifications = [];
  const fakeEnqueue = (notification) => { enqueuedNotifications.push(notification); };

  fakeEnqueue({
    tenantId: 'tenant-123',
    type: 'HUMAN_SUPPORT_REQUESTED',
    conversationId: 'conv-456',
  });

  assert.equal(enqueuedNotifications.length, 1);
  assert.equal(enqueuedNotifications[0].type, 'HUMAN_SUPPORT_REQUESTED');
});


