import assert from 'node:assert/strict';
import test from 'node:test';
import { processHumanSupportNotificationOutbox } from '../services/human-support-notification-outbox-service.js';

test('claims one tenant-scoped pending outbox row and marks a successful neutral delivery delivered', async () => {
  const calls = [];
  const database = { async connect() { return { async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('SELECT o.status')) return { rows: [{ status: 'PROCESSING', escalation_status: 'ACTIVE' }] };
    if (sql.includes('FROM human_support_notification_outbox')) return { rows: [{ id: 'outbox-a', tenant_id: 'tenant-a', conversation_id: 'conversation-a', level_order: 1, recipient_rule: 'ASSIGNED_OWNER' }] };
    return { rowCount: 1, rows: [] };
  }, release() {} }; } };
  const deliveries = [];
  const result = await processHumanSupportNotificationOutbox({ database, deliver: async (payload) => { deliveries.push(payload); return { status: 'DELIVERED' }; } });
  assert.equal(result.delivered, 1);
  assert.equal(deliveries[0].tenantId, 'tenant-a');
  assert.ok(calls.some(({ sql }) => sql.includes("status IN ('PENDING', 'RETRY')") && sql.includes('SKIP LOCKED')));
  assert.ok(calls.some(({ sql }) => sql.includes("status = 'DELIVERED'")));
});

test('completed escalation prevents a claimed outbox row from reaching delivery', async () => {
  const database = { async connect() { return { async query(sql) {
    if (sql.includes('SELECT o.status')) return { rows: [{ status: 'PROCESSING', escalation_status: 'COMPLETED' }] };
    if (sql.includes('FROM human_support_notification_outbox')) return { rows: [{ id: 'outbox-a', tenant_id: 'tenant-a', conversation_id: 'conversation-a', level_order: 1 }] };
    return { rowCount: 1, rows: [] };
  }, release() {} }; } };
  let sent = false;
  const result = await processHumanSupportNotificationOutbox({ database, deliver: async () => { sent = true; return { status: 'DELIVERED' }; } });
  assert.equal(sent, false);
  assert.equal(result.delivered, 0);
});

test('active processing lease is not reclaimed', async () => {
  const db = { async connect() { return { async query(sql) { if (sql.includes('FROM human_support_notification_outbox')) return { rows: [] }; return { rows: [] }; }, release() {} }; } };
  let sent = false;
  const result = await processHumanSupportNotificationOutbox({ database: db, deliver: async () => { sent = true; } });
  assert.deepEqual(result, { delivered: 0, retried: 0, failed: 0 });
  assert.equal(sent, false);
});

test('retryable and permanent adapter outcomes change only the same outbox lifecycle', async () => {
  for (const [outcome, expected] of [[{ retryable: true }, 'RETRY'], [{ retryable: false }, 'FAILED']]) {
    const states = [];
    const db = { async connect() { return { async query(sql) {
      if (sql.includes('SELECT o.status')) return { rows: [{ status: 'PROCESSING', escalation_status: 'ACTIVE' }] };
      if (sql.includes('FROM human_support_notification_outbox')) return { rows: [{ id: 'same-row', tenant_id: 'tenant-a', conversation_id: 'conversation-a', level_order: 1 }] };
      if (sql.includes('UPDATE human_support_notification_outbox SET status')) states.push(sql);
      return { rowCount: 1, rows: [] };
    }, release() {} }; } };
    await processHumanSupportNotificationOutbox({ database: db, deliver: async () => outcome });
    assert.ok(states.some((sql) => sql.includes(`status = '${expected}'`)));
  }
});

test('a notification is never delivered when server-side recipient resolution finds no eligible tenant user', async () => {
  const states = [];
  const db = { async connect() { return { async query(sql) {
    if (sql.includes('SELECT o.status')) return { rows: [{ status: 'PROCESSING', escalation_status: 'ACTIVE' }] };
    if (sql.includes('FROM human_support_notification_outbox')) return { rows: [{ id: 'outbox-a', tenant_id: 'tenant-a', conversation_id: 'conversation-a', level_order: 1, recipient_rule: 'ROLE', recipient_target: { role: 'AGENT' } }] };
    if (sql.includes('UPDATE human_support_notification_outbox SET status')) states.push(sql);
    return { rowCount: 1, rows: [] };
  }, release() {} }; } };
  let delivered = false;
  const result = await processHumanSupportNotificationOutbox({
    database: db,
    resolveRecipients: async () => [],
    deliver: async () => { delivered = true; return { status: 'DELIVERED' }; },
  });

  assert.equal(delivered, false);
  assert.equal(result.noRecipients, 1);
  assert.ok(states.some((sql) => sql.includes("status = 'FAILED'")));
});

test('the transport receives only the eligible recipients resolved for the outbox tenant', async () => {
  const db = { async connect() { return { async query(sql) {
    if (sql.includes('SELECT o.status')) return { rows: [{ status: 'PROCESSING', escalation_status: 'ACTIVE' }] };
    if (sql.includes('FROM human_support_notification_outbox')) return { rows: [{ id: 'outbox-a', tenant_id: 'tenant-a', conversation_id: 'conversation-a', level_order: 1, recipient_rule: 'USER', recipient_target: { userId: 'user-a' } }] };
    return { rowCount: 1, rows: [] };
  }, release() {} }; } };
  let payload;
  await processHumanSupportNotificationOutbox({
    database: db,
    resolveRecipients: async (input) => {
      assert.deepEqual(input, { tenantId: 'tenant-a', conversationId: 'conversation-a', rule: 'USER', target: { userId: 'user-a' } });
      return [{ id: 'user-a' }];
    },
    deliver: async (input) => { payload = input; return { status: 'DELIVERED' }; },
  });
  assert.deepEqual(payload.recipients, [{ id: 'user-a' }]);
});
