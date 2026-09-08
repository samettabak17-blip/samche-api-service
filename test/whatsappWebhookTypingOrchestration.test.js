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
