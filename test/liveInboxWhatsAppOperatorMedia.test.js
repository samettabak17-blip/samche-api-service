import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAgentMediaMessage, ConversationOperationError } from '../services/live-inbox-service.js';
import { WhatsAppDeliveryError } from '../services/whatsapp-delivery-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const actor = { userId: '33333333-3333-4333-8333-333333333333', systemRole: 'OWNER', tenantRole: 'ADMIN' };
const file = { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), size: 9, mimetype: 'image/png', originalname: 'company.png' };

function databaseFixture() {
  const calls = [];
  const conversation = { id: conversationId, tenant_id: tenantId, channel_id: '44444444-4444-4444-8444-444444444444', customer_external_id: 'whatsapp:15551234567', status: 'open', handling_mode: 'HUMAN', assigned_agent_user_id: actor.userId, channel_type: 'WHATSAPP', external_channel_id: '948536645017374', human_attention_state: 'REQUESTED' };
  const client = { async query(sql, parameters = []) {
    calls.push({ sql, parameters });
    if (sql.includes('FROM conversations c')) return { rows: [conversation] };
    if (sql.includes('FROM tenant_channels tc') && sql.includes('channel_integrations')) return { rowCount: 1, rows: [{ external_channel_id: conversation.external_channel_id }] };
    if (sql.includes('SELECT * FROM conversation_messages') && sql.includes('idempotency_key')) return { rows: [] };
    if (sql.includes('INSERT INTO conversation_messages')) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', sender_type: 'AGENT', content: 'See attachment' }] };
    if (sql.includes('INSERT INTO conversation_resources')) return { rows: [{ id: '66666666-6666-4666-8666-666666666666', media_category: 'IMAGE' }] };
    if (sql.includes("SET human_attention_state = 'ACKNOWLEDGED'")) return { rowCount: 1, rows: [{ id: conversationId }] };
    return { rows: [] };
  }, release() {} };
  return { database: { async connect() { return client; } }, calls };
}

test('persists an AGENT media resource only after mapped WhatsApp media delivery succeeds', async () => {
  const { database, calls } = databaseFixture();
  const stored = [];
  const delivered = [];
  const result = await appendAgentMediaMessage({
    tenantId, conversationId, actor, file, caption: 'See attachment', idempotencyKey: 'agent-media-1', database,
    deliverWhatsAppMedia: async (input) => { delivered.push(input); return { delivery: 'SENT_TO_WHATSAPP', mediaId: 'meta-media-1' }; },
    storage: { async put(input) { stored.push(input); }, async remove() {} },
  });
  assert.equal(result.delivery, 'SENT_TO_WHATSAPP');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].phoneNumberId, '948536645017374');
  assert.equal(stored.length, 1);
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO conversation_messages')));
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO conversation_resources')));
  assert.ok(calls.some(({ sql }) => sql.includes("SET human_attention_state = 'ACKNOWLEDGED'")));
  assert.ok(!calls.some(({ sql }) => sql.includes("handling_mode = 'AI'")));
});

test('does not persist an AGENT message/resource or acknowledge attention when provider media delivery fails', async () => {
  const { database, calls } = databaseFixture();
  await assert.rejects(appendAgentMediaMessage({
    tenantId, conversationId, actor, file, database,
    deliverWhatsAppMedia: async () => { throw new WhatsAppDeliveryError('WHATSAPP_MEDIA_SEND_FAILED'); },
    storage: { async put() { throw new Error('must not store'); } },
  }), (error) => error instanceof ConversationOperationError && error.code === 'WHATSAPP_MEDIA_SEND_FAILED');
  assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO conversation_messages')).length, 0);
  assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO conversation_resources')).length, 0);
  assert.equal(calls.filter(({ sql }) => sql.includes("SET human_attention_state = 'ACKNOWLEDGED'")).length, 0);
});
