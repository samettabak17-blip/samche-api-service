import assert from 'node:assert/strict';
import test from 'node:test';
import {
  upsertWhatsAppConversation,
  WhatsAppInboxError,
} from '../services/whatsapp-live-inbox-service.js';

test('conversation activity convergence never updates tenant ownership columns', async () => {
  let capturedSql = '';
  const client = {
    async query(sql) {
      capturedSql = sql;
      return { rowCount: 1, rows: [{ id: 'conversation-1', tenant_id: 'tenant-a', channel_id: 'channel-a' }] };
    },
  };

  const conversation = await upsertWhatsAppConversation(client, {
    tenantId: 'tenant-a',
    channelId: 'channel-a',
    customerPhone: '15551234567',
  });

  assert.equal(conversation.tenant_id, 'tenant-a');
  assert.doesNotMatch(capturedSql, /DO UPDATE SET\s+tenant_id/i);
  assert.match(capturedSql, /conversations\.tenant_id = EXCLUDED\.tenant_id/i);
  assert.match(capturedSql, /conversations\.channel_id = EXCLUDED\.channel_id/i);
});

test('cross-tenant conversation conflict fails closed without returning a hijacked conversation', async () => {
  const client = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
  };

  await assert.rejects(
    upsertWhatsAppConversation(client, {
      tenantId: 'tenant-b',
      channelId: 'channel-a',
      customerPhone: '15551234567',
    }),
    (error) => error instanceof WhatsAppInboxError
      && error.code === 'WHATSAPP_CONVERSATION_OWNERSHIP_CONFLICT'
  );
});
