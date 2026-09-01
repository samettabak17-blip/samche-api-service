import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyPlatformOwnersOfPlanUpgrade } from '../services/tenant-plan-notification-service.js';

test('persistent notification resolves active platform OWNER recipients without hardcoding an address', async () => {
  let call;
  const result = await notifyPlatformOwnersOfPlanUpgrade({ database: { query: async (sql, params) => { call = { sql, params }; return { rowCount: 2 }; } }, requestId: 'request-1' });
  assert.equal(result.notified, 2);
  assert.match(call.sql, /system_role = 'OWNER'/);
  assert.match(call.sql, /status = 'ACTIVE'/);
  assert.deepEqual(call.params, ['request-1']);
});
