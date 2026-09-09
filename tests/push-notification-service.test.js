import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerPushSubscription,
  unsubscribePushSubscription,
  createPushNotificationIntent,
  processPushNotificationOutbox,
} from '../services/push-notification-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherTenantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const subscription = { endpoint: 'https://push.example.test/subscription/one', keys: { p256dh: 'key-a', auth: 'auth-a' } };

test('registers a tenant/user scoped subscription idempotently without trusting client tenant authority', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FROM users u/.test(sql)) return { rowCount: 1, rows: [{ system_role: 'ADMIN', tenant_role: 'ADMIN' }] };
      return { rowCount: 1, rows: [{ id: 'subscription-1', tenant_id: tenantId, user_id: userId, endpoint: subscription.endpoint, enabled: true }] };
    },
  };
  const result = await registerPushSubscription({ database, tenantId, userId, subscription });
  assert.equal(result.id, 'subscription-1');
  const insertCall = calls.find((c) => /ON CONFLICT \(tenant_id, user_id, endpoint\)/.test(c.sql));
  assert.ok(insertCall);
  assert.deepEqual(insertCall.params.slice(0, 3), [tenantId, userId, subscription.endpoint]);
});

test('never deletes a different tenant or user subscription', async () => {
  let call;
  const database = { query: async (sql, params = []) => { call = { sql, params }; return { rowCount: 0, rows: [] }; } };
  const removed = await unsubscribePushSubscription({ database, tenantId, userId, endpoint: subscription.endpoint });
  assert.equal(removed, false);
  assert.match(call.sql, /tenant_id = \$1 AND user_id = \$2 AND endpoint = \$3/);
  assert.deepEqual(call.params, [tenantId, userId, subscription.endpoint]);
  assert.notEqual(tenantId, otherTenantId);
});

test('delivery failure is observational and an expired endpoint is disabled without changing the intent origin', async () => {
  const calls = [];
  const database = {
    connect: async () => ({
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (/FOR UPDATE OF outbox SKIP LOCKED/.test(sql)) return { rows: [{ id: 'outbox-1', tenant_id: tenantId, recipient_user_id: userId, event_type: 'REVIEW_REQUIRED', deep_link: '/app/' + tenantId + '/knowledge', subscription_id: 'sub-1', endpoint: subscription.endpoint, p256dh: 'key-a', auth: 'auth-a', attempts: 0 }] };
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  const outcome = await processPushNotificationOutbox({ database, deliver: async () => ({ statusCode: 410 }) });
  assert.equal(outcome.expired, 1);
  assert.ok(calls.some(({ sql }) => /UPDATE push_notification_subscriptions SET enabled = FALSE/.test(sql)));
  assert.ok(calls.some(({ sql }) => /UPDATE push_notification_outbox SET status = 'FAILED'/.test(sql)));
});

test('deduplicates a domain event intent by tenant and event id', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => { calls.push({ sql, params }); return { rows: [{ id: 'intent-1', tenant_id: tenantId, event_id: 'event-1' }] }; } };
  const intent = await createPushNotificationIntent({ database, tenantId, eventId: 'event-1', eventType: 'CONFIGURATION_READY', deepLink: '/app/' + tenantId + '/knowledge' });
  assert.equal(intent.id, 'intent-1');
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, event_id\)/);
  assert.match(calls[1].sql, /ON CONFLICT \(tenant_id, intent_id, subscription_id\)/);
});

test('records a deterministic no-recipient outcome without failing the domain event', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO push_notification_intents')) return { rowCount: 1, rows: [{ id: 'intent-no-recipient', tenant_id: tenantId, event_id: 'empty-event' }] };
    if (sql.includes('INSERT INTO push_notification_outbox')) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT count(*)')) return { rows: [{ count: 0 }] };
    return { rowCount: 1, rows: [] };
  } };
  const intent = await createPushNotificationIntent({ database, tenantId, eventId: 'empty-event', eventType: 'REVIEW_REQUIRED', deepLink: '/app/' + tenantId + '/knowledge' });
  assert.equal(intent.id, 'intent-no-recipient');
  assert.ok(calls.some(({ sql }) => /SET status='NO_RECIPIENT'/.test(sql)));
});

test('restricts a handoff notification to resolved same-tenant recipients', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => { calls.push({ sql, params }); return { rows: [{ id: 'intent-1', tenant_id: tenantId, event_id: 'handoff-1' }] }; } };
  await createPushNotificationIntent({
    database,
    tenantId,
    eventId: 'handoff-1',
    eventType: 'HUMAN_HANDOFF_REQUESTED',
    deepLink: '/app/' + tenantId + '/conversations/whatsapp/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    recipientUserIds: [userId],
  });
  assert.match(calls[1].sql, /subscription\.user_id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(calls[1].params, ['intent-1', [userId]]);
});

test('rejects a malformed or external notification deep link before persistence', async () => {
  await assert.rejects(
    () => createPushNotificationIntent({ database: { query: async () => ({ rows: [] }) }, tenantId, eventId: 'bad-link', eventType: 'REVIEW_REQUIRED', deepLink: 'https://attacker.example/app/' + tenantId }),
    (error) => error.code === 'PUSH_DEEP_LINK_INVALID',
  );
  await assert.rejects(
    () => createPushNotificationIntent({ database: { query: async () => ({ rows: [] }) }, tenantId, eventId: 'bad-path', eventType: 'REVIEW_REQUIRED', deepLink: '/app/' + tenantId + '/../settings' }),
    (error) => error.code === 'PUSH_DEEP_LINK_INVALID',
  );
});

test('stops retrying after the bounded push delivery attempt limit', async () => {
  const calls = [];
  const database = {
    connect: async () => ({
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (/FOR UPDATE OF outbox SKIP LOCKED/.test(sql)) return { rows: [{ id: 'outbox-1', tenant_id: tenantId, recipient_user_id: userId, event_type: 'REVIEW_REQUIRED', deep_link: '/app/' + tenantId + '/knowledge', subscription_id: 'sub-1', endpoint: subscription.endpoint, p256dh: 'key-a', auth: 'auth-a', attempts: 2 }] };
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  const outcome = await processPushNotificationOutbox({ database, deliver: async () => ({ retryable: true }) });
  assert.equal(outcome.failed, 1);
  assert.ok(calls.some(({ sql }) => /status='FAILED'.*RETRY_EXHAUSTED/s.test(sql)));
});

test('a transport exception becomes a bounded retry instead of rolling back the notification outbox claim', async () => {
  const calls = [];
  const database = { connect: async () => ({
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FOR UPDATE OF outbox SKIP LOCKED/.test(sql)) return { rows: [{ id: 'outbox-1', tenant_id: tenantId, subscription_id: 'sub-1', attempts: 0, endpoint: subscription.endpoint, p256dh: 'key', auth: 'auth', event_type: 'HUMAN_HANDOFF_REQUESTED', deep_link: `/app/${tenantId}/conversations/whatsapp/${otherTenantId}` }] };
      return { rows: [] };
    },
    release: () => {},
  }) };
  const result = await processPushNotificationOutbox({ database, deliver: async () => { throw new Error('network unavailable'); } });
  assert.equal(result.retried, 1);
  assert.ok(calls.some(({ sql }) => sql.includes("status='RETRY'")));
});

test('reclaims only a stale processing notification after a worker interruption', async () => {
  const calls = [];
  const database = { connect: async () => ({
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FOR UPDATE OF outbox SKIP LOCKED/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  }) };
  await processPushNotificationOutbox({ database, deliver: async () => ({ status: 'DELIVERED' }) });
  const claim = calls.find(({ sql }) => /FOR UPDATE OF outbox SKIP LOCKED/.test(sql));
  assert.match(claim.sql, /outbox\.status='PROCESSING' AND outbox\.processing_started_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'/);
});

test('can process a tenant-scoped notification intent without claiming another tenant outbox row', async () => {
  const calls = [];
  const database = { connect: async () => ({
    query: async (sql, params = []) => { calls.push({ sql, params }); return { rows: [] }; },
    release: () => {},
  }) };
  await processPushNotificationOutbox({ database, tenantId, deliver: async () => ({ status: 'DELIVERED' }) });
  const claim = calls.find(({ sql }) => /FOR UPDATE OF outbox SKIP LOCKED/.test(sql));
  assert.match(claim.sql, /outbox\.tenant_id=\$1/);
  assert.deepEqual(claim.params, [tenantId]);
});

test('ACCEPTED_BY_PUSH_SERVICE marks outbox delivered and updates subscription delivery timestamp', async () => {
  const calls = [];
  const database = {
    connect: async () => ({
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (/FOR UPDATE OF outbox SKIP LOCKED/.test(sql)) {
          return { rows: [{ id: 'outbox-1', tenant_id: tenantId, recipient_user_id: userId, event_type: 'HUMAN_HANDOFF_REQUESTED', deep_link: `/app/${tenantId}/conversations/whatsapp/${otherTenantId}`, subscription_id: 'sub-1', endpoint: subscription.endpoint, p256dh: 'key-a', auth: 'auth-a', attempts: 0 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  const outcome = await processPushNotificationOutbox({
    database,
    deliver: async () => ({ status: 'ACCEPTED_BY_PUSH_SERVICE', statusCode: 201 }),
  });
  assert.equal(outcome.delivered, 1);
  assert.ok(calls.some(({ sql }) => /UPDATE push_notification_outbox SET status='DELIVERED'/.test(sql)));
  assert.ok(calls.some(({ sql }) => /UPDATE push_notification_subscriptions SET last_delivered_at=CURRENT_TIMESTAMP/.test(sql)));
});

test('401/403 provider response marks subscription as AUTH_ERROR failure code', async () => {
  const calls = [];
  const database = {
    connect: async () => ({
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (/FOR UPDATE OF outbox SKIP LOCKED/.test(sql)) {
          return { rows: [{ id: 'outbox-1', tenant_id: tenantId, recipient_user_id: userId, event_type: 'HUMAN_HANDOFF_REQUESTED', deep_link: `/app/${tenantId}/conversations/whatsapp/${otherTenantId}`, subscription_id: 'sub-1', endpoint: subscription.endpoint, p256dh: 'key-a', auth: 'auth-a', attempts: 0 }] };
        }
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  const outcome = await processPushNotificationOutbox({
    database,
    deliver: async () => ({ statusCode: 401, errorClass: 'WebPushError' }),
  });
  assert.equal(outcome.failed, 1);
  assert.ok(calls.some(({ sql }) => /failure_code='AUTH_ERROR'/.test(sql)));
});

