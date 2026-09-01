import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_CODES, isHigherPlan, requestTenantPlanUpgrade, resolveTenantPlanUpgrade, changeTenantPlanAsOwner, TenantPlanError } from '../services/tenant-plan-service.js';

function databaseFor(steps) {
  const calls = [];
  const client = {
    async query(sql, params = []) { calls.push({ sql: String(sql), params }); const step = steps.shift(); if (step instanceof Error) throw step; return step ?? { rowCount: 0, rows: [] }; },
    release() {},
  };
  return { database: { connect: async () => client }, calls };
}

test('has four stable canonical plans and strictly ascending hierarchy', () => {
  assert.deepEqual(PLAN_CODES, ['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE']);
  assert.equal(isHigherPlan('GROWTH', 'BUSINESS'), true);
  assert.equal(isHigherPlan('BUSINESS', 'GROWTH'), false);
  assert.equal(isHigherPlan('ENTERPRISE', 'ENTERPRISE'), false);
});

test('request persists pending upgrade without mutating the tenant plan', async () => {
  const { database, calls } = databaseFor([{}, { rowCount: 1, rows: [{ plan_code: 'GROWTH' }] }, { rowCount: 0, rows: [] }, { rowCount: 1, rows: [{ id: 'request-1', status: 'PENDING', current_plan_code: 'GROWTH', requested_plan_code: 'BUSINESS', created_at: 'now' }] }, {}]);
  const request = await requestTenantPlanUpgrade({ database, tenantId: 'tenant-1', requestedBy: 'user-1', requestedPlanCode: 'BUSINESS' });
  assert.equal(request.status, 'PENDING');
  assert.equal(request.reused, false);
  assert.equal(calls.some((call) => call.sql.startsWith('UPDATE tenants')), false);
});

test('same target reuses the pending request and a different target is not silently substituted', async () => {
  const same = databaseFor([{}, { rowCount: 1, rows: [{ plan_code: 'GROWTH' }] }, { rowCount: 1, rows: [{ id: 'request-1', requested_plan_code: 'BUSINESS' }] }, {}]);
  assert.equal((await requestTenantPlanUpgrade({ database: same.database, tenantId: 'tenant-1', requestedBy: 'user-1', requestedPlanCode: 'BUSINESS' })).reused, true);
  const different = databaseFor([{}, { rowCount: 1, rows: [{ plan_code: 'GROWTH' }] }, { rowCount: 1, rows: [{ id: 'request-1', requested_plan_code: 'BUSINESS' }] }, {}]);
  await assert.rejects(() => requestTenantPlanUpgrade({ database: different.database, tenantId: 'tenant-1', requestedBy: 'user-1', requestedPlanCode: 'ENTERPRISE' }), (error) => error instanceof TenantPlanError && error.code === 'PLAN_REQUEST_PENDING');
});

test('same or lower plan is rejected before persistence', async () => {
  const { database } = databaseFor([{}, { rowCount: 1, rows: [{ plan_code: 'BUSINESS' }] }, {}]);
  await assert.rejects(() => requestTenantPlanUpgrade({ database, tenantId: 'tenant-1', requestedBy: 'user-1', requestedPlanCode: 'GROWTH' }), (error) => error instanceof TenantPlanError && error.code === 'PLAN_UPGRADE_NOT_HIGHER');
});

test('owner approval atomically updates plan and audits previous/new values', async () => {
  const { database, calls } = databaseFor([{}, { rowCount: 1, rows: [{ id: 'request-1', tenant_id: 'tenant-1', status: 'PENDING', current_plan_code: 'GROWTH', requested_plan_code: 'BUSINESS' }] }, { rowCount: 1, rows: [{ plan_code: 'GROWTH' }] }, {}, { rowCount: 1, rows: [{ id: 'request-1', status: 'APPROVED', previous_plan_code: 'GROWTH', new_plan_code: 'BUSINESS' }] }, {}]);
  const resolved = await resolveTenantPlanUpgrade({ database, requestId: 'request-1', ownerUserId: 'owner-1', decision: 'APPROVED' });
  assert.equal(resolved.status, 'APPROVED');
  assert.equal(calls.some((call) => call.sql.startsWith('UPDATE tenants')), true);
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});

test('owner rejection leaves the tenant plan untouched', async () => {
  const { database, calls } = databaseFor([{}, { rowCount: 1, rows: [{ id: 'request-1', tenant_id: 'tenant-1', status: 'PENDING', current_plan_code: 'GROWTH', requested_plan_code: 'BUSINESS' }] }, { rowCount: 1, rows: [{ plan_code: 'GROWTH' }] }, { rowCount: 1, rows: [{ id: 'request-1', status: 'REJECTED', previous_plan_code: 'GROWTH', new_plan_code: null }] }, {}]);
  await resolveTenantPlanUpgrade({ database, requestId: 'request-1', ownerUserId: 'owner-1', decision: 'REJECTED' });
  assert.equal(calls.some((call) => call.sql.startsWith('UPDATE tenants')), false);
});

test('platform owner may explicitly assign any canonical plan and records the manual audit', async () => {
  const { database, calls } = databaseFor([{}, { rowCount: 1, rows: [{ plan_code: 'GROWTH' }] }, { rowCount: 0, rows: [] }, {}, { rowCount: 1, rows: [{ id: 'audit-1', tenant_id: 'tenant-1', previous_plan_code: 'GROWTH', new_plan_code: 'STARTER', change_source: 'OWNER_MANUAL_CHANGE' }] }, {}]);
  const change = await changeTenantPlanAsOwner({ database, tenantId: 'tenant-1', ownerUserId: 'owner-1', planCode: 'STARTER' });
  assert.equal(change.new_plan_code, 'STARTER');
  assert.equal(calls.some((call) => call.sql.startsWith('UPDATE tenants')), true);
  assert.equal(calls.some((call) => call.sql.includes('tenant_plan_change_audit')), true);
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
});

test('manual owner assignment is blocked while the tenant has a pending request', async () => {
  const { database } = databaseFor([{}, { rowCount: 1, rows: [{ plan_code: 'STARTER' }] }, { rowCount: 1, rows: [{ id: 'request-1' }] }, {}]);
  await assert.rejects(() => changeTenantPlanAsOwner({ database, tenantId: 'tenant-1', ownerUserId: 'owner-1', planCode: 'BUSINESS' }), (error) => error instanceof TenantPlanError && error.code === 'PLAN_MANUAL_CHANGE_PENDING_REQUEST');
});
