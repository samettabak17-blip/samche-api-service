import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { INSERT_CONVERSATION_MESSAGE_SQL, recordWhatsAppDeliveryStatus, UPDATE_WHATSAPP_DELIVERY_STATUS_SQL } from '../services/live-inbox-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

function databaseFixture({ matched = true, matchOnAttempt = 1 } = {}) {
  const calls = [];
  let updateAttempts = 0;
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes('UPDATE conversation_messages m')) {
        updateAttempts += 1;
        return matched && updateAttempts >= matchOnAttempt
          ? { rowCount: 1, rows: [{ tenant_id: tenantId, conversation_id: conversationId, id: 'message-id', delivery_status: parameters[0] }] }
          : { rowCount: 0, rows: [] };
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


test('maps SENT and FAILED provider events without changing delivery correlation', async () => {
  const { database, calls } = databaseFixture();
  const sent = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '948536645017374',
    status: { id: 'wamid.lifecycle-1', status: 'sent' },
    database,
  });
  const failed = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '948536645017374',
    status: { id: 'wamid.lifecycle-1', status: 'failed', errors: [{ code: 131000 }] },
    database,
  });

  assert.equal(sent.deliveryStatus, 'SENT');
  assert.equal(failed.deliveryStatus, 'FAILED');
  const updates = calls.filter(({ sql }) => sql.includes('UPDATE conversation_messages m'));
  assert.deepEqual(updates.map(({ parameters }) => parameters), [
    ['SENT', null, 'wamid.lifecycle-1', '948536645017374'],
    ['FAILED', '131000', 'wamid.lifecycle-1', '948536645017374'],
  ]);
});

test('regression: every provider delivery status executes against the staging SQL contract', { skip: !process.env.DATABASE_URL }, async (t) => {
  const database = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await database.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const target = await client.query(
      `SELECT c.id AS conversation_id, c.tenant_id, tc.external_channel_id
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
        WHERE tc.channel_type = 'WHATSAPP'
          AND tc.external_channel_id IS NOT NULL
        LIMIT 1`
    );
    if (!target.rows[0]) {
      t.skip('No staging WhatsApp conversation is available for the delivery-status SQL-contract check');
      return;
    }

    const fixture = target.rows[0];
    const providerMessageId = `ci-delivery-status-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const idempotencyKey = `ci-delivery-status-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const inserted = await client.query(INSERT_CONVERSATION_MESSAGE_SQL, [
      fixture.tenant_id,
      fixture.conversation_id,
      'AGENT',
      'Delivery status SQL contract regression check',
      null,
      idempotencyKey,
      providerMessageId,
      'SENT',
    ]);
    assert.equal(inserted.rowCount, 1);

    const cases = [
      { status: 'SENT', failureCode: null, expectedFailureCode: null },
      { status: 'DELIVERED', failureCode: null, expectedFailureCode: null },
      { status: 'READ', failureCode: null, expectedFailureCode: null },
      { status: 'FAILED', failureCode: '131000', expectedFailureCode: '131000' },
      { status: 'FAILED', failureCode: null, expectedFailureCode: 'WHATSAPP_DELIVERY_FAILED' },
    ];
    for (const entry of cases) {
      const updated = await client.query(UPDATE_WHATSAPP_DELIVERY_STATUS_SQL, [
        entry.status,
        entry.failureCode,
        providerMessageId,
        fixture.external_channel_id,
      ]);
      assert.equal(updated.rowCount, 1);
      assert.equal(updated.rows[0].delivery_status, entry.status);
      assert.equal(updated.rows[0].delivery_failure_code, entry.expectedFailureCode);
    }
  } finally {
    if (transactionOpen) await client.query('ROLLBACK');
    client.release();
    await database.end();
  }
});


test('reconciles an early status webhook after the assistant wamid is committed', async () => {
  const { database, calls } = databaseFixture({ matchOnAttempt: 2 });
  const result = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '948536645017374',
    status: { id: 'TEST_WAMID', status: 'sent' },
    database,
    reconciliationDelaysMs: [0, 0],
  });

  assert.deepEqual(result, { updated: true, count: 1, deliveryStatus: 'SENT' });
  assert.equal(calls.filter(({ sql }) => sql.includes('UPDATE conversation_messages m')).length, 2);
});


test('reconciles an early FAILED voice status after the outbound transaction commit boundary', async () => {
  const { database, calls } = databaseFixture({ matchOnAttempt: 4 });
  const result = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '948536645017374',
    status: { id: 'wamid.voice-131053', status: 'failed', errors: [{ code: 131053 }] },
    database,
    reconciliationDelaysMs: [0, 0, 0, 0],
  });
  assert.deepEqual(result, { updated: true, count: 1, deliveryStatus: 'FAILED' });
  const updates = calls.filter(({ sql }) => sql.includes('UPDATE conversation_messages m'));
  assert.equal(updates.length, 4);
  assert.deepEqual(updates.at(-1).parameters, ['FAILED', '131053', 'wamid.voice-131053', '948536645017374']);
});
