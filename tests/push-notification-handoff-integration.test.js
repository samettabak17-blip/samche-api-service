import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueHumanHandoffPushNotification } from '../services/push-notification-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conversationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('human handoff creates one tenant-scoped push intent only for resolved operators', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', tenant_id: tenantId, event_id: `human-handoff:outbox-1` }] };
    },
  };
  await enqueueHumanHandoffPushNotification({
    database,
    tenantId,
    conversationId,
    handoffOutboxId: 'outbox-1',
    recipients: [{ id: userId }],
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params[1], 'human-handoff:outbox-1');
  assert.equal(calls[0].params[2], 'HUMAN_HANDOFF_REQUESTED');
  assert.equal(calls[0].params[3], `/app/${tenantId}/conversations/whatsapp/${conversationId}`);
  assert.deepEqual(calls[1].params, ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', [userId]]);
});

test('human handoff rejects recipients without a valid user identity', async () => {
  await assert.rejects(
    () => enqueueHumanHandoffPushNotification({
      database: { query: async () => ({ rows: [] }) }, tenantId, conversationId, handoffOutboxId: 'outbox-2', recipients: [{}],
    }),
    (error) => error.code === 'PUSH_RECIPIENT_INVALID',
  );
});
