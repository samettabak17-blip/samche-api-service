import assert from 'node:assert/strict';
import test from 'node:test';
import { recordWhatsAppDeliveryStatus } from '../services/live-inbox-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

function databaseFixture({ matched = true } = {}) {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes('UPDATE conversation_messages m')) {
        return matched ? { rowCount: 1, rows: [{ tenant_id: tenantId, conversation_id: conversationId, id: 'message-id', delivery_status: parameters[0] }] } : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  return { database: { async connect() { return client; } }, calls };
}

test('correlates delivered WhatsApp status only through the mapped phone number and external message ID', async () => {
  const { database, calls } = databaseFixture();
  const result = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '948536645017374',
    status: { id: 'wamid.agent-media-1', status: 'delivered' },
    database,
  });
  assert.deepEqual(result, { updated: true, count: 1, deliveryStatus: 'DELIVERED' });
  const update = calls.find(({ sql }) => sql.includes('UPDATE conversation_messages m'));
  assert.deepEqual(update.parameters, ['DELIVERED', null, 'wamid.agent-media-1', '948536645017374']);
  assert.ok(calls.some(({ sql, parameters }) => sql.includes('SELECT pg_notify') && String(parameters[1]).includes('WHATSAPP_DELIVERY_STATUS')));
});

test('does not mutate another tenant when no message matches the mapped provider identifier', async () => {
  const { database, calls } = databaseFixture({ matched: false });
  const result = await recordWhatsAppDeliveryStatus({
    phoneNumberId: 'other-tenant-phone',
    status: { id: 'wamid.agent-media-1', status: 'read' },
    database,
  });
  assert.deepEqual(result, { updated: false, count: 0, deliveryStatus: 'READ' });
  assert.equal(calls.filter(({ sql }) => sql.includes('SELECT pg_notify')).length, 0);
});
