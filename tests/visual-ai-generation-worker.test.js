import test from 'node:test';
import assert from 'node:assert/strict';
import { processOneVisualAiGenerationJob, startVisualAiTypingPresence } from '../services/visual-ai-generation-worker.js';
import { createDeterministicMockVisualProvider, VisualAIProviderError } from '../services/visual-ai-provider-adapter.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const targetResourceId = '44444444-4444-4444-8444-444444444444';

function convergenceDatabase({ failMessageInsertOnce = false, failTerminalCompletionOnce = false } = {}) {
  const state = {
    job: {
      id: jobId,
      tenant_id: tenantId,
      conversation_id: conversationId,
      target_resource_id: targetResourceId,
      prompt_instruction: 'Make this garden modern',
      grounding_context: {},
      max_attempts: 3,
      attempts: 0,
      status: 'PENDING',
      generated_resource_id: null,
      output_message_id: null,
      provider_message_id: null,
    },
    resource: null,
    message: null,
    failMessageInsertOnce,
    failTerminalCompletionOnce,
    deliveries: 0,
  };

  return {
    state,
    async query(sql, params = []) {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        if (state.job.status !== 'PENDING') return { rows: [] };
        state.job.status = 'PROCESSING';
        state.job.attempts += 1;
        return { rows: [{ ...state.job }] };
      }
      if (sql.includes("WHERE status = 'PROCESSING' AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)")) {
        return { rows: [] };
      }
      if (sql.includes('SELECT status, handling_mode FROM conversations')) {
        return { rowCount: 1, rows: [{ status: 'open', handling_mode: 'AI' }] };
      }
      if (sql.includes('SELECT id, storage_key, mime_type, original_filename FROM conversation_resources')) {
        return { rowCount: 1, rows: [{ id: targetResourceId, storage_key: 'target-image', mime_type: 'image/jpeg', original_filename: 'garden.jpg' }] };
      }
      if (sql.includes('INSERT INTO conversation_resources')) {
        if (!state.resource) {
          state.resource = { id: params[0], tenant_id: tenantId, conversation_id: conversationId, storage_key: params[6], mime_type: 'image/png', original_filename: params[3] };
        }
        return { rowCount: 1, rows: [{ ...state.resource }] };
      }
      if (sql.includes('SELECT * FROM conversation_resources WHERE id = $1')) {
        return { rowCount: state.resource ? 1 : 0, rows: state.resource ? [{ ...state.resource }] : [] };
      }
      if (sql.includes('INSERT INTO conversation_messages')) {
        if (state.failMessageInsertOnce) {
          state.failMessageInsertOnce = false;
          throw new Error('simulated crash before canonical message creation');
        }
        if (!state.message) state.message = { id: '55555555-5555-4555-8555-555555555555', content: params[2] };
        return { rowCount: 1, rows: [{ ...state.message }] };
      }
      if (sql.includes('UPDATE conversation_resources SET message_id')) {
        state.resource.message_id = params[0];
        return { rows: [{ ...state.resource }] };
      }
      if (sql.includes('SELECT external_message_id FROM conversation_messages')) {
        return { rowCount: 1, rows: [{ external_message_id: 'wamid.customer-inbound-123' }] };
      }
      if (sql.includes('SELECT c.customer_external_id')) {
        return { rowCount: 1, rows: [{ customer_external_id: '15551234567', external_channel_id: 'phone-id', config: {} }] };
      }
      if (sql.includes('SELECT provider_message_id FROM visual_ai_generation_jobs')) {
        return { rows: [{ provider_message_id: state.job.provider_message_id }] };
      }
      if (sql.includes('UPDATE visual_ai_generation_jobs')) {
        if (sql.includes("SET status = 'COMPLETED'") && state.failTerminalCompletionOnce) {
          state.failTerminalCompletionOnce = false;
          throw new Error('simulated crash after durable WhatsApp acceptance');
        }
        if (sql.includes('generated_resource_id')) state.job.generated_resource_id = params[0];
        if (sql.includes('output_message_id')) state.job.output_message_id ??= params[0];
        if (sql.includes('provider_message_id')) state.job.provider_message_id ??= params[0];
        if (sql.includes("status = 'PENDING'")) state.job.status = 'PENDING';
        if (sql.includes('SET status = CASE')) state.job.status = params[0] ? 'PENDING' : 'FAILED';
        if (sql.includes("status = 'COMPLETED'")) state.job.status = 'COMPLETED';
        return { rowCount: 1, rows: [{ ...state.job }] };
      }
      return { rows: [] };
    },
  };
}

test('worker retries a crash after generated resource creation and converges one message, link, delivery, and completion', async () => {
  const database = convergenceDatabase({ failMessageInsertOnce: true });
  const storage = {
    get: async () => [Buffer.from('target-image')],
    put: async () => {},
  };
  const deliverWhatsAppMedia = async () => {
    database.state.deliveries += 1;
    return { providerMessageId: 'wamid.generated-once' };
  };

  await assert.rejects(
    () => processOneVisualAiGenerationJob({ database, storage, visualProvider: createDeterministicMockVisualProvider(), deliverWhatsAppMedia }),
    /simulated crash/
  );
  assert.equal(database.state.job.status, 'PENDING', 'a partial output must remain recoverable');

  const recovered = await processOneVisualAiGenerationJob({ database, storage, visualProvider: createDeterministicMockVisualProvider(), deliverWhatsAppMedia });

  assert.equal(recovered.status, 'COMPLETED');
  assert.equal(database.state.job.status, 'COMPLETED');
  assert.equal(database.state.resource.message_id, database.state.message.id);
  assert.equal(database.state.deliveries, 1);
});

test('worker completes a recovered post-delivery job without a second WhatsApp media submission', async () => {
  const database = convergenceDatabase({ failTerminalCompletionOnce: true });
  const storage = {
    get: async () => [Buffer.from('target-image')],
    put: async () => {},
  };
  const deliverWhatsAppMedia = async () => {
    database.state.deliveries += 1;
    return { providerMessageId: 'wamid.persisted-before-crash' };
  };

  await assert.rejects(
    () => processOneVisualAiGenerationJob({ database, storage, visualProvider: createDeterministicMockVisualProvider(), deliverWhatsAppMedia }),
    /simulated crash after durable WhatsApp acceptance/
  );
  assert.equal(database.state.job.status, 'PENDING');
  assert.equal(database.state.job.provider_message_id, 'wamid.persisted-before-crash');

  const recovered = await processOneVisualAiGenerationJob({ database, storage, visualProvider: createDeterministicMockVisualProvider(), deliverWhatsAppMedia });

  assert.equal(recovered.status, 'COMPLETED');
  assert.equal(database.state.deliveries, 1);
});

test('worker returns a temporary WhatsApp delivery failure to the bounded durable retry path', async () => {
  const database = convergenceDatabase();
  const storage = {
    get: async () => [Buffer.from('target-image')],
    put: async () => {},
  };

  await assert.rejects(
    () => processOneVisualAiGenerationJob({
      database,
      storage,
      visualProvider: createDeterministicMockVisualProvider(),
      deliverWhatsAppMedia: async () => {
        throw new VisualAIProviderError('WHATSAPP_MEDIA_SEND_FAILED', 'temporary WhatsApp outage', { retryable: true });
      },
    }),
    /temporary WhatsApp outage/
  );

  assert.equal(database.state.job.status, 'PENDING');
  assert.equal(database.state.resource.message_id, database.state.message.id);
});

test('worker localizes ready caption according to job/conversation language', async () => {
  for (const [lang, expected] of [
    ['en', 'Your visual concept preview is ready.'],
    ['tr', 'Görsel konsept önizlemeniz hazır.'],
    ['ar', 'معاينة المفهوم المرئي الخاص بك جاهزة.'],
  ]) {
    const database = convergenceDatabase();
    database.state.job.grounding_context = { language: lang };
    const storage = {
      get: async () => [Buffer.from('target-image')],
      put: async () => {},
    };
    let deliveredCaption = null;
    const deliverWhatsAppMedia = async (args) => {
      deliveredCaption = args.caption;
      return { providerMessageId: `wamid.lang-${lang}` };
    };

    const result = await processOneVisualAiGenerationJob({
      database,
      storage,
      visualProvider: createDeterministicMockVisualProvider(),
      deliverWhatsAppMedia,
    });

    assert.equal(result.status, 'COMPLETED');
    assert.equal(database.state.message.content, expected);
    assert.equal(deliveredCaption, expected);
  }
});


test('startVisualAiTypingPresence sends initial typing, periodic refresh, and cleans up without orphan timers', async () => {
  const sent = [];
  const sendTyping = async (args) => {
    sent.push({ ...args, time: Date.now() });
    return { ok: true };
  };

  const stop = startVisualAiTypingPresence({
    phoneNumberId: 'phone-123',
    incomingMessageId: 'wamid.inbound-1',
    integrationConfig: { cred: 'test' },
    sendTyping,
    intervalMs: 20,
    maxDurationMs: 100,
  });

  // Initial call was made synchronously
  assert.equal(sent.length, 1);
  assert.equal(sent[0].phoneNumberId, 'phone-123');
  assert.equal(sent[0].incomingMessageId, 'wamid.inbound-1');

  // Wait for 1-2 intervals
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.ok(sent.length >= 2, 'Typing indicator was refreshed during active period');

  // Stop typing presence
  stop();
  const countAtStop = sent.length;

  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.equal(sent.length, countAtStop, 'No further typing events sent after stop');
});

test('processOneVisualAiGenerationJob integrates typing presence and safely ignores typing transport errors', async () => {
  const database = convergenceDatabase();
  const storage = {
    get: async () => [Buffer.from('target-image')],
    put: async () => {},
  };
  const typingCalls = [];
  const failingSendTyping = async (args) => {
    typingCalls.push(args);
    throw new Error('Simulated Meta API transient 500 error');
  };

  const result = await processOneVisualAiGenerationJob({
    database,
    storage,
    visualProvider: createDeterministicMockVisualProvider(),
    deliverWhatsAppMedia: async () => ({ providerMessageId: 'wamid.typing-test' }),
    sendWhatsAppTyping: failingSendTyping,
  });

  assert.equal(result.status, 'COMPLETED');
  assert.ok(typingCalls.length >= 1, 'Typing presence was attempted');
  assert.equal(database.state.job.status, 'COMPLETED', 'Typing failure did not prevent job completion');
});