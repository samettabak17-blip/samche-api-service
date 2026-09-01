import test from 'node:test';
import assert from 'node:assert/strict';
import { listPlanUpgradeNotificationsForOwner, markPlanUpgradeNotificationRead, notifyPlatformOwnersOfPlanUpgrade } from '../services/tenant-plan-notification-service.js';

test('persistent notification resolves active platform OWNER recipients without hardcoding an address', async () => {
  let call;
  const result = await notifyPlatformOwnersOfPlanUpgrade({ database: { query: async (sql, params) => { call = { sql, params }; return { rowCount: 2 }; } }, requestId: 'request-1' });
  assert.equal(result.notified, 2);
  assert.match(call.sql, /system_role = 'OWNER'/);
  assert.match(call.sql, /status = 'ACTIVE'/);
  assert.deepEqual(call.params, ['request-1']);
});

test('owner notification feed is recipient-scoped and returns safe plan-review details', async () => {
  let call;
  const rows = [{ id: 'notification-1', title: 'Plan upgrade request', tenant_name: 'Blue Dune', current_plan_code: 'STARTER', requested_plan_code: 'BUSINESS', requested_by_email: 'admin@example.test', status: 'PENDING' }];
  const notifications = await listPlanUpgradeNotificationsForOwner({ database: { query: async (sql, params) => { call = { sql, params }; return { rows }; } }, ownerUserId: 'owner-1' });
  assert.deepEqual(notifications, rows);
  assert.match(call.sql, /recipient_user_id = \$1/);
  assert.match(call.sql, /tenant_plan_upgrade_notifications/);
  assert.deepEqual(call.params, ['owner-1']);
});

test('reading a plan notification only updates that OWNER recipient record', async () => {
  let call;
  const notification = await markPlanUpgradeNotificationRead({ database: { query: async (sql, params) => { call = { sql, params }; return { rowCount: 1, rows: [{ id: 'notification-1', status: 'READ' }] }; } }, ownerUserId: 'owner-1', notificationId: 'notification-1' });
  assert.equal(notification.status, 'READ');
  assert.match(call.sql, /recipient_user_id = \$2/);
  assert.match(call.sql, /status = 'PENDING'/);
  assert.deepEqual(call.params, ['notification-1', 'owner-1']);
});
