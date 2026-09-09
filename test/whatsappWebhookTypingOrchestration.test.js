import assert from 'node:assert/strict';
import test from 'node:test';
import { WhatsAppDeliveryError } from '../services/whatsapp-delivery-service.js';
import { orchestrateWhatsAppInboundAiResponse } from '../services/whatsapp-inbound-ai-orchestrator.js';

function eligibleInbox(overrides = {}) {
  return {
    duplicate: false,
    shouldInvokeAi: true,
    conversation: { handling_mode: 'AI' },
    integration: {
      tenant_id: 'tenant-12345678',
      channel_id: 'channel-12345678',
      external_channel_id: '948536645017374',
    },
    ...overrides,
  };
}

test('real inbound AI orchestration awaits native typing before generation and uses canonical runtime context', async () => {
  const order = [];
  let transportInput;
  const result = await orchestrateWhatsAppInboundAiResponse({
    whatsappInbox: eligibleInbox(),
    incomingMessageId: 'wamid.REAL_WEBHOOK_PATH',
    sendTyping: async (input) => {
      transportInput = input;
      order.push('typing-start');
      await Promise.resolve();
      order.push('typing-complete');
      return { ok: true, providerStatus: 200 };
    },
    processAiResponse: async () => {
      order.push('generation-start');
      return { delivered: true };
    },
    logger: { info() {} },
  });

  assert.deepEqual(order, ['typing-start', 'typing-complete', 'generation-start']);
  assert.deepEqual(transportInput, {
    phoneNumberId: '948536645017374',
    incomingMessageId: 'wamid.REAL_WEBHOOK_PATH',
  });
  assert.equal(result.typing.attempted, true);
  assert.equal(result.typing.succeeded, true);
  assert.equal(result.outboundProceeded, true);
});

test('typing provider failure is secret-safe, observable, awaited, and does not suppress outbound AI processing', async () => {
  const logs = [];
  let processed = false;
  const secret = 'never-print-this-token';
  const result = await orchestrateWhatsAppInboundAiResponse({
    whatsappInbox: eligibleInbox(),
    incomingMessageId: 'wamid.FAILURE',
    sendTyping: async () => {
      throw new WhatsAppDeliveryError('WHATSAPP_TYPING_INDICATOR_FAILED', 'failed', {
        providerStatus: 503,
        providerCode: '131000',
      });
    },
    processAiResponse: async () => {
      processed = true;
      return { delivered: true };
    },
    logger: { info(message) { logs.push(message); } },
    diagnosticProbe: secret,
  });

  assert.equal(processed, true);
  assert.equal(result.typing.succeeded, false);
  assert.equal(result.typing.providerStatus, 503);
  assert.match(logs.join('\n'), /attempted=1/);
  assert.match(logs.join('\n'), /failure_category=PROVIDER/);
  assert.match(logs.join('\n'), /outbound_proceeded=1/);
  assert.doesNotMatch(logs.join('\n'), new RegExp(secret));
  assert.doesNotMatch(logs.join('\n'), /948536645017374/);
});

test('human takeover and AI suppression never emit native typing or invoke AI processing', async () => {
  let typingCalls = 0;
  let processCalls = 0;
  const result = await orchestrateWhatsAppInboundAiResponse({
    whatsappInbox: eligibleInbox({ conversation: { handling_mode: 'HUMAN' } }),
    incomingMessageId: 'wamid.HUMAN',
    sendTyping: async () => { typingCalls += 1; },
    processAiResponse: async () => { processCalls += 1; },
    logger: { info() {} },
  });

  assert.equal(result.suppressed, true);
  assert.equal(typingCalls, 0);
  assert.equal(processCalls, 0);
});

test('Return to AI restores typing on the next eligible inbound message', async () => {
  let typingCalls = 0;
  const result = await orchestrateWhatsAppInboundAiResponse({
    whatsappInbox: eligibleInbox({ conversation: { handling_mode: 'AI' }, shouldInvokeAi: true }),
    incomingMessageId: 'wamid.RETURNED_TO_AI',
    sendTyping: async () => { typingCalls += 1; return { ok: true, providerStatus: 200 }; },
    processAiResponse: async () => ({ delivered: true }),
    logger: { info() {} },
  });

  assert.equal(result.suppressed, false);
  assert.equal(typingCalls, 1);
  assert.equal(result.outboundProceeded, true);
});
test('native typing executes repeatedly on every turn of a multi-turn conversation', async () => {
  const typingAttempts = [];
  const logs = [];
  const customLogger = { info(msg) { logs.push(msg); } };

  // Turn 1: First AI reply (greeting)
  const turn1 = await orchestrateWhatsAppInboundAiResponse({
    whatsappInbox: eligibleInbox({ isFirstAssistantResponse: true }),
    incomingMessageId: 'wamid.TURN_1',
    sendTyping: async ({ incomingMessageId }) => {
      typingAttempts.push(incomingMessageId);
      return { ok: true, providerStatus: 200 };
    },
    typingAttemptNumber: 1,
    processAiResponse: async () => ({ delivered: true, aiResponsePath: 'DETERMINISTIC_GREETING' }),
    logger: customLogger,
  });
  assert.equal(turn1.typing.attempted, true);
  assert.equal(turn1.typing.succeeded, true);
  assert.equal(turn1.aiResponsePath, 'DETERMINISTIC_GREETING');

  // Turn 2: Second AI reply (knowledge response)
  const turn2 = await orchestrateWhatsAppInboundAiResponse({
    whatsappInbox: eligibleInbox({
      isFirstAssistantResponse: false,
      conversationHistory: [
        { sender_type: 'CUSTOMER', content: 'Merhaba' },
        { sender_type: 'ASSISTANT', content: 'Merhaba! Nasıl yardımcı olabilirim?' },
      ],
    }),
    incomingMessageId: 'wamid.TURN_2',
    sendTyping: async ({ incomingMessageId }) => {
      typingAttempts.push(incomingMessageId);
      return { ok: true, providerStatus: 200 };
    },
    typingAttemptNumber: 2,
    processAiResponse: async () => ({ delivered: true, aiResponsePath: 'KNOWLEDGE_INTELLIGENCE' }),
    logger: customLogger,
  });
  assert.equal(turn2.typing.attempted, true);
  assert.equal(turn2.typing.succeeded, true);
  assert.equal(turn2.aiResponsePath, 'KNOWLEDGE_INTELLIGENCE');

  // Turn 3: Third AI reply (contextual multi-turn)
  const turn3 = await orchestrateWhatsAppInboundAiResponse({
    whatsappInbox: eligibleInbox({
      isFirstAssistantResponse: false,
      conversationHistory: [
        { sender_type: 'CUSTOMER', content: 'Merhaba' },
        { sender_type: 'ASSISTANT', content: 'Merhaba! Nasıl yardımcı olabilirim?' },
        { sender_type: 'CUSTOMER', content: 'Peyzaj projesi ne kadar sürer?' },
        { sender_type: 'ASSISTANT', content: 'Proje büyüklüğüne göre 2-4 hafta sürebilir.' },
      ],
    }),
    incomingMessageId: 'wamid.TURN_3',
    sendTyping: async ({ incomingMessageId }) => {
      typingAttempts.push(incomingMessageId);
      return { ok: true, providerStatus: 200 };
    },
    typingAttemptNumber: 3,
    processAiResponse: async () => ({ delivered: true, aiResponsePath: 'CONTEXTUAL_MULTI_TURN' }),
    logger: customLogger,
  });
  assert.equal(turn3.typing.attempted, true);
  assert.equal(turn3.typing.succeeded, true);
  assert.equal(turn3.aiResponsePath, 'CONTEXTUAL_MULTI_TURN');

  // Verify all 3 turns independently executed typing
  assert.deepEqual(typingAttempts, ['wamid.TURN_1', 'wamid.TURN_2', 'wamid.TURN_3']);

  // Verify secret-safe diagnostics captured required fields
  const logOutput = logs.join('\n');
  assert.match(logOutput, /INBOUND_MESSAGE_ID=wamid\.TURN_1/);
  assert.match(logOutput, /TYPING_ATTEMPT_NUMBER=1/);
  assert.match(logOutput, /AI_RESPONSE_PATH=DETERMINISTIC_GREETING/);
  assert.match(logOutput, /INBOUND_MESSAGE_ID=wamid\.TURN_2/);
  assert.match(logOutput, /TYPING_ATTEMPT_NUMBER=2/);
  assert.match(logOutput, /AI_RESPONSE_PATH=KNOWLEDGE_INTELLIGENCE/);
  assert.match(logOutput, /INBOUND_MESSAGE_ID=wamid\.TURN_3/);
  assert.match(logOutput, /TYPING_ATTEMPT_NUMBER=3/);
  assert.match(logOutput, /AI_RESPONSE_PATH=CONTEXTUAL_MULTI_TURN/);
});

