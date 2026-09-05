import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTenantWithPlatformCapabilities,
  provisionTenantPlatformCapabilities,
  repairTenantPlatformCapabilities,
} from '../services/tenant-platform-provisioning-service.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function provisioningClient({ tenantId = TENANT_A, planCode = 'STARTER', featureState = {} } = {}) {
  const state = { ensured: [], transactions: [], inserts: 0 };
  return {
    state,
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        state.transactions.push(sql);
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO tenants')) {
        state.inserts += 1;
        return { rowCount: 1, rows: [{ id: tenantId, name: params[0], status: 'active', plan_code: params[1] }] };
      }
      if (sql.includes('SELECT id, plan_code, status FROM tenants')) {
        return { rowCount: 1, rows: [{ id: params[0], plan_code: planCode, status: 'active' }] };
      }
      if (sql.includes('ensure_tenant_platform_capabilities')) {
        state.ensured.push({ tenantId: params[0], manifestVersion: params[1] });
        return { rowCount: 1, rows: [{ ensure_tenant_platform_capabilities: null }] };
      }
      if (sql.includes('AS assistant_enabled')) {
        return { rowCount: 1, rows: [{
          assistant_enabled: false,
          web_chat_enabled: false,
          whatsapp_enabled: false,
          guide_enabled: false,
          human_support_enabled: true,
          ...featureState,
        }] };
      }
      if (sql.includes('SELECT id FROM tenants ORDER BY id')) {
        return { rowCount: 2, rows: [{ id: TENANT_A }, { id: TENANT_B }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
}

test('normal provisioning ensures baseline idempotently and keeps availability separate from enablement', async () => {
  const client = provisioningClient();
  const first = await provisionTenantPlatformCapabilities({ client, tenantId: TENANT_A });
  const second = await provisionTenantPlatformCapabilities({ client, tenantId: TENANT_A });

  assert.equal(client.state.ensured.length, 2);
  assert.deepEqual(client.state.ensured[0], { tenantId: TENANT_A, manifestVersion: 1 });
  assert.deepEqual(first, second);
  assert.equal(first.capabilities.platform_foundation.available, true);
  assert.equal(first.capabilities.platform_foundation.enabled, true);
  assert.equal(first.capabilities.guide.available, true);
  assert.equal(first.capabilities.guide.enabled, false);
  assert.equal(first.capabilities.human_support.enabled, true);
});

test('feature rows are reported enabled only after their normal enablement state exists', async () => {
  const client = provisioningClient({ featureState: { assistant_enabled: true, whatsapp_enabled: true } });
  const result = await provisionTenantPlatformCapabilities({ client, tenantId: TENANT_A });
  assert.equal(result.capabilities.assistant_core.enabled, true);
  assert.equal(result.capabilities.whatsapp.enabled, true);
  assert.equal(result.capabilities.guide.enabled, false);
});

test('tenant creation and existing-tenant repair invoke the same canonical ensure operation', async () => {
  const client = provisioningClient();
  const database = { connect: async () => client };

  const created = await createTenantWithPlatformCapabilities({ database, name: 'Synthetic Company', planCode: 'STARTER' });
  assert.equal(created.id, TENANT_A);
  assert.deepEqual(client.state.transactions, ['BEGIN', 'COMMIT']);
  assert.equal(client.state.ensured.length, 1);

  const repaired = await repairTenantPlatformCapabilities({ database, tenantId: TENANT_A });
  assert.equal(repaired.length, 1);
  assert.equal(client.state.ensured.length, 2);
  assert.equal(client.state.ensured[0].manifestVersion, client.state.ensured[1].manifestVersion);
});

test('all-tenant repair remains tenant-scoped and uses one transaction per tenant', async () => {
  const listing = provisioningClient();
  const clients = [provisioningClient({ tenantId: TENANT_A }), provisioningClient({ tenantId: TENANT_B })];
  let connections = 0;
  const database = {
    async query(sql) { return listing.query(sql); },
    async connect() { return clients[connections++]; },
  };

  const repaired = await repairTenantPlatformCapabilities({ database });
  assert.deepEqual(repaired.map((item) => item.tenant_id), [TENANT_A, TENANT_B]);
  assert.deepEqual(clients[0].state.transactions, ['BEGIN', 'COMMIT']);
  assert.deepEqual(clients[1].state.transactions, ['BEGIN', 'COMMIT']);
  assert.deepEqual(clients[0].state.ensured[0].tenantId, TENANT_A);
  assert.deepEqual(clients[1].state.ensured[0].tenantId, TENANT_B);
});
