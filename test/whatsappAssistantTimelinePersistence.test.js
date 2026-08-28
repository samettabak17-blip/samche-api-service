import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { INSERT_CONVERSATION_MESSAGE_SQL, UPDATE_WHATSAPP_ASSISTANT_PROVIDER_ACCEPTANCE_SQL, persistAssistantResponseIfCurrent } from '../services/live-inbox-service.js';
import { persistAndDeliverWhatsAppAssistant } from '../services/whatsapp-assistant-response-service.js';
import { WhatsAppDeliveryError, deliverWhatsAppText } from '../services/whatsapp-delivery-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

function fakeDatabase(currentConversation) {
  const messages = [];
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes('SELECT * FROM conversations WHERE id')) return { rows: [currentConversation.value] };
      if (sql.includes('INSERT INTO conversation_messages')) {
        const message = { id: `assistant-${messages.length + 1}`, sender_type: 'ASSISTANT', content: parameters[3] };
        messages.push(message);
        return { rows: [message] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { database: { async connect() { return client; } }, messages, calls };
}

test('regression: normal WhatsApp AI response persistence never depends on media-only tracing', async () => {
  const currentConversation = { value: { status: 'open', handling_mode: 'AI', handling_version: 4 } };
  const { database, messages, calls } = fakeDatabase(currentConversation);
  const result = await persistAssistantResponseIfCurrent({
    tenantId, conversationId, content: 'Assistant response', handlingVersion: 4, database,
  });

  assert.equal(result.delivered, true);
  assert.deepEqual(messages.map((message) => message.sender_type), ['ASSISTANT']);
  assert.ok(calls.some(({ sql, parameters }) => sql.includes('INSERT INTO conversation_messages') && parameters[2] === 'ASSISTANT'));
  assert.ok(calls.some(({ sql }) => sql.includes('SELECT pg_notify')));
});

test('multiple normal AI responses retain chronological ASSISTANT entries', async () => {
  const currentConversation = { value: { status: 'open', handling_mode: 'AI', handling_version: 7 } };
  const { database, messages } = fakeDatabase(currentConversation);
  await persistAssistantResponseIfCurrent({ tenantId, conversationId, content: 'First', handlingVersion: 7, database });
  await persistAssistantResponseIfCurrent({ tenantId, conversationId, content: 'Second', handlingVersion: 7, database });

  assert.deepEqual(messages.map((message) => message.content), ['First', 'Second']);
  assert.deepEqual(messages.map((message) => message.sender_type), ['ASSISTANT', 'ASSISTANT']);
});

test('takeover race blocks persistence and channel delivery for a stale AI result', async () => {
  const currentConversation = { value: { status: 'open', handling_mode: 'HUMAN', handling_version: 8 } };
  const { database, messages } = fakeDatabase(currentConversation);
  let deliveries = 0;
  const outcome = await persistAndDeliverWhatsAppAssistant({
    tenantId, conversationId, handlingVersion: 7, recipient: 'whatsapp:15551234567', content: 'Stale response',
    persistAssistantResponse: (input) => persistAssistantResponseIfCurrent({ ...input, database }),
    persistProviderMessageId: async ({ providerMessageId }) => ({ id: 'assistant-provider-message', external_message_id: providerMessageId }),
    deliver: async () => { deliveries += 1; return { providerMessageId: 'wamid.assistant-test' }; },
  });

  assert.equal(outcome.delivered, false);
  assert.equal(messages.length, 0);
  assert.equal(deliveries, 0);
});

test('returning to AI allows only the next new assistant response to persist and deliver', async () => {
  const currentConversation = { value: { status: 'open', handling_mode: 'HUMAN', handling_version: 9 } };
  const { database, messages } = fakeDatabase(currentConversation);
  let deliveries = 0;
  const persistProviderMessageId = async ({ messageId, providerMessageId }) => ({ id: messageId, external_message_id: providerMessageId });
  const blocked = await persistAndDeliverWhatsAppAssistant({
    tenantId, conversationId, handlingVersion: 9, recipient: 'whatsapp:15551234567', content: 'Paused response',
    persistAssistantResponse: (input) => persistAssistantResponseIfCurrent({ ...input, database }),
    persistProviderMessageId,
    deliver: async () => { deliveries += 1; return { providerMessageId: 'wamid.assistant-test' }; },
  });
  currentConversation.value = { status: 'open', handling_mode: 'AI', handling_version: 10 };
  const resumed = await persistAndDeliverWhatsAppAssistant({
    tenantId, conversationId, handlingVersion: 10, recipient: 'whatsapp:15551234567', content: 'New response',
    persistAssistantResponse: (input) => persistAssistantResponseIfCurrent({ ...input, database }),
    persistProviderMessageId,
    deliver: async () => { deliveries += 1; return { providerMessageId: 'wamid.assistant-test' }; },
  });

  assert.equal(blocked.delivered, false);
  assert.equal(resumed.delivered, true);
  assert.equal(deliveries, 1);
  assert.deepEqual(messages.map((message) => message.content), ['New response']);
});


test('regression: nullable assistant delivery status has a concrete PostgreSQL type', { skip: !process.env.DATABASE_URL }, async (t) => {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const database = new pg.Pool({
    host: databaseUrl.hostname,
    port: Number(databaseUrl.port || 5432),
    user: decodeURIComponent(databaseUrl.username),
    password: decodeURIComponent(databaseUrl.password),
    database: decodeURIComponent(databaseUrl.pathname.replace(/^\//, '')),
    ssl: process.env.DATABASE_SSL === 'false'
      ? false
      : { rejectUnauthorized: true, servername: databaseUrl.hostname },
  });
  const client = await database.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const conversation = await client.query(
      `SELECT id, tenant_id
         FROM conversations
        WHERE status = 'open'
        ORDER BY last_activity_at DESC NULLS LAST
        LIMIT 1`
    );
    if (!conversation.rows[0]) {
      t.skip('No staging conversation is available for the SQL-contract regression check');
      return;
    }

    const target = conversation.rows[0];
    const inserted = await client.query(INSERT_CONVERSATION_MESSAGE_SQL, [
      target.tenant_id,
      target.id,
      'ASSISTANT',
      'SQL contract regression check',
      null,
      null,
      null,
      null,
    ]);

    assert.equal(inserted.rowCount, 1);
    const accepted = await client.query(UPDATE_WHATSAPP_ASSISTANT_PROVIDER_ACCEPTANCE_SQL, [
      'TEST_WAMID',
      inserted.rows[0].id,
      target.tenant_id,
      target.id,
    ]);
    assert.equal(accepted.rowCount, 1);
    assert.equal(accepted.rows[0].external_message_id, 'TEST_WAMID');
    assert.equal(accepted.rows[0].delivery_status, 'SENT');
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
    client.release();
    await database.end();
  }
});


test('persists the exact Meta wamid on the assistant message after provider acceptance', async () => {
  const persistedIds = [];
  const outcome = await persistAndDeliverWhatsAppAssistant({
    tenantId,
    conversationId,
    handlingVersion: 4,
    recipient: 'whatsapp:15551234567',
    content: 'Assistant response',
    persistAssistantResponse: async () => ({ delivered: true, message: { id: 'assistant-message-id' } }),
    deliver: async () => ({ providerMessageId: 'TEST_WAMID' }),
    persistProviderMessageId: async (input) => {
      persistedIds.push(input);
      return { id: input.messageId, external_message_id: input.providerMessageId, delivery_status: 'SENT' };
    },
  });

  assert.equal(outcome.delivered, true);
  assert.equal(outcome.providerMessageId, 'TEST_WAMID');
  assert.deepEqual(persistedIds, [{
    tenantId,
    conversationId,
    messageId: 'assistant-message-id',
    providerMessageId: 'TEST_WAMID',
  }]);
  assert.equal(outcome.message.external_message_id, 'TEST_WAMID');
});

test('does not mark an assistant response delivered when Meta rejects the request', async () => {
  let wamidPersisted = false;
  await assert.rejects(persistAndDeliverWhatsAppAssistant({
    tenantId,
    conversationId,
    handlingVersion: 4,
    recipient: 'whatsapp:15551234567',
    content: 'Assistant response',
    persistAssistantResponse: async () => ({ delivered: true, message: { id: 'assistant-message-id' } }),
    deliver: async () => { throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_FAILED'); },
    persistProviderMessageId: async () => { wamidPersisted = true; },
  }), (error) => error.code === 'WHATSAPP_DELIVERY_FAILED');
  assert.equal(wamidPersisted, false);
});

test('extracts Meta messages[0].id for an assistant text delivery', async () => {
  const result = await deliverWhatsAppText({
    phoneNumberId: '948536645017374',
    recipient: 'whatsapp:15551234567',
    content: 'Merhaba',
    requireProviderMessageId: true,
    env: { WHATSAPP_PHONE_ID: '948536645017374', WHATSAPP_TOKEN: 'test-token' },
    httpClient: { async post() { return { data: { messages: [{ id: 'TEST_WAMID' }] } }; } },
  });

  assert.equal(result.providerMessageId, 'TEST_WAMID');
  assert.deepEqual(result.providerMessageIds, ['TEST_WAMID']);
});

test('rejects an assistant text delivery without a real Meta wamid', async () => {
  await assert.rejects(deliverWhatsAppText({
    phoneNumberId: '948536645017374',
    recipient: 'whatsapp:15551234567',
    content: 'Merhaba',
    requireProviderMessageId: true,
    env: { WHATSAPP_PHONE_ID: '948536645017374', WHATSAPP_TOKEN: 'test-token' },
    httpClient: { async post() { return { data: { messages: [] } }; } },
  }), (error) => error instanceof WhatsAppDeliveryError && error.code === 'WHATSAPP_DELIVERY_UNCORRELATED');
});
