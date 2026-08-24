import assert from 'node:assert/strict';
import test from 'node:test';
import { persistAssistantResponseIfCurrent } from '../services/live-inbox-service.js';
import { persistAndDeliverWhatsAppAssistant } from '../services/whatsapp-assistant-response-service.js';

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

test('normal AI response persists as ASSISTANT and is available to the unfiltered timeline history', async () => {
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
    deliver: async () => { deliveries += 1; },
  });

  assert.equal(outcome.delivered, false);
  assert.equal(messages.length, 0);
  assert.equal(deliveries, 0);
});

test('returning to AI allows only the next new assistant response to persist and deliver', async () => {
  const currentConversation = { value: { status: 'open', handling_mode: 'HUMAN', handling_version: 9 } };
  const { database, messages } = fakeDatabase(currentConversation);
  let deliveries = 0;
  const blocked = await persistAndDeliverWhatsAppAssistant({
    tenantId, conversationId, handlingVersion: 9, recipient: 'whatsapp:15551234567', content: 'Paused response',
    persistAssistantResponse: (input) => persistAssistantResponseIfCurrent({ ...input, database }),
    deliver: async () => { deliveries += 1; },
  });
  currentConversation.value = { status: 'open', handling_mode: 'AI', handling_version: 10 };
  const resumed = await persistAndDeliverWhatsAppAssistant({
    tenantId, conversationId, handlingVersion: 10, recipient: 'whatsapp:15551234567', content: 'New response',
    persistAssistantResponse: (input) => persistAssistantResponseIfCurrent({ ...input, database }),
    deliver: async () => { deliveries += 1; },
  });

  assert.equal(blocked.delivered, false);
  assert.equal(resumed.delivered, true);
  assert.equal(deliveries, 1);
  assert.deepEqual(messages.map((message) => message.content), ['New response']);
});
