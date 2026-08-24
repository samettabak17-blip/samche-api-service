import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAgentMessage, ConversationOperationError } from '../services/live-inbox-service.js';
import { WhatsAppDeliveryError, deliverWhatsAppText } from '../services/whatsapp-delivery-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '99999999-9999-4999-8999-999999999999';
const conversationId = '22222222-2222-4222-8222-222222222222';
const actor = { userId: '33333333-3333-4333-8333-333333333333', systemRole: 'OWNER', tenantRole: 'ADMIN' };

function humanWhatsAppConversation() {
  return {
    id: conversationId,
    tenant_id: tenantId,
    channel_id: '44444444-4444-4444-8444-444444444444',
    customer_external_id: 'whatsapp:15551234567',
    status: 'open',
    handling_mode: 'HUMAN',
    assigned_agent_user_id: actor.userId,
    channel_type: 'WHATSAPP',
    external_channel_id: '948536645017374',
  };
}

function createDatabase({ conversation = humanWhatsAppConversation(), mapping = true } = {}) {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes('FROM conversations c')) return { rows: conversation ? [conversation] : [] };
      if (sql.includes('FROM tenant_channels tc') && sql.includes('channel_integrations')) {
        return { rows: mapping ? [{ external_channel_id: conversation.external_channel_id, integration_key: `WHATSAPP:${conversation.external_channel_id}` }] : [] };
      }
      if (sql.includes('SELECT * FROM conversation_messages') && sql.includes('idempotency_key')) return { rows: [] };
      if (sql.includes('INSERT INTO conversation_messages')) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', sender_type: 'AGENT' }] };
      return { rows: [] };
    },
    release() {},
  };
  return { database: { async connect() { return client; } }, calls };
}

test('operator message in HUMAN WhatsApp conversation uses only the mapped channel and persists after delivery', async () => {
  const { database, calls } = createDatabase();
  const deliveryCalls = [];
  const result = await appendAgentMessage({
    tenantId, conversationId, actor, content: 'Operator response', idempotencyKey: 'operator-1',
    database,
    deliverWhatsApp: async (input) => { deliveryCalls.push(input); return { deliveredChunks: 1, failedChunks: 0 }; },
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.delivery, 'SENT_TO_WHATSAPP');
  assert.equal(deliveryCalls.length, 1);
  assert.equal(deliveryCalls[0].phoneNumberId, '948536645017374');
  assert.equal(deliveryCalls[0].recipient, 'whatsapp:15551234567');
  assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO conversation_messages')).length, 1);
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO conversation_audit_events')));
  assert.ok(calls.some(({ sql }) => sql.includes('SELECT pg_notify')));
  assert.ok(!calls.some(({ sql }) => sql.includes("handling_mode = 'AI'")));
});

test('operator delivery failure is safe and does not persist a false successful AGENT message', async () => {
  const { database, calls } = createDatabase();
  await assert.rejects(
    appendAgentMessage({
      tenantId, conversationId, actor, content: 'Operator response', database,
      deliverWhatsApp: async () => { throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_FAILED'); },
    }),
    (error) => error instanceof ConversationOperationError && error.status === 502 && error.code === 'WHATSAPP_DELIVERY_FAILED'
  );
  assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO conversation_messages')).length, 0);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
});

test('missing tenant-scoped WhatsApp integration fails without a fallback delivery', async () => {
  const { database } = createDatabase({ mapping: false });
  let delivered = false;
  await assert.rejects(
    appendAgentMessage({
      tenantId, conversationId, actor, content: 'Operator response', database,
      deliverWhatsApp: async () => { delivered = true; },
    }),
    (error) => error instanceof ConversationOperationError && error.status === 409 && error.code === 'WHATSAPP_DELIVERY_NOT_CONFIGURED'
  );
  assert.equal(delivered, false);
});

test('cross-tenant conversation lookup cannot invoke WhatsApp delivery', async () => {
  const { database } = createDatabase({ conversation: null });
  let delivered = false;
  await assert.rejects(
    appendAgentMessage({
      tenantId: otherTenantId, conversationId, actor, content: 'Operator response', database,
      deliverWhatsApp: async () => { delivered = true; },
    }),
    (error) => error instanceof ConversationOperationError && error.status === 404 && error.code === 'CONVERSATION_NOT_FOUND'
  );
  assert.equal(delivered, false);
});

test('WhatsApp delivery refuses a channel/configuration mismatch before any provider request', async () => {
  let calls = 0;
  await assert.rejects(
    deliverWhatsAppText({
      phoneNumberId: 'different-phone-id',
      recipient: 'whatsapp:15551234567',
      content: 'Operator response',
      env: { WHATSAPP_PHONE_ID: '948536645017374', WHATSAPP_TOKEN: 'test-token' },
      httpClient: { async post() { calls += 1; } },
    }),
    (error) => error instanceof WhatsAppDeliveryError && error.code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH'
  );
  assert.equal(calls, 0);
});
