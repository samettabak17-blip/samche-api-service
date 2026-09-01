import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('owner manual tenant plan changes have an additive, auditable migration', async () => {
  const sql = await readFile(new URL('../migrations/045_owner_tenant_plan_manual_change.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tenant_plan_change_audit/i);
  assert.match(sql, /OWNER_MANUAL_CHANGE/);
  assert.match(sql, /previous_plan_code/);
  assert.match(sql, /new_plan_code/);
  assert.match(sql, /changed_by_user_id/);
});
