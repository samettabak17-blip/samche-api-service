import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanupFixture } from '../scripts/cleanup_staging_task6_e2e.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SOURCE_A = '33333333-3333-4333-8333-333333333333';

function state() {
  return {
    marker: 'TASK6_E2E_123_1', tenantIds: [TENANT_A, TENANT_B], assistantIds: [], channelIds: [],
    integrationIds: [], sourceIds: [SOURCE_A], conversationIds: [], userIds: [],
    storageObjects: [{ tenantId: TENANT_A, sourceId: SOURCE_A, key: `knowledge/${TENANT_A}/${SOURCE_A}/abc.txt` }],
  };
}

function database({ wrongName = false, failDelete = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
    if (/SELECT id, name FROM tenants/.test(sql)) {
        return { rows: [TENANT_A, TENANT_B].map((id, index) => ({ id, name: wrongName && index === 0 ? 'Customer' : `TASK6_E2E_123_1 tenant ${index}` })) };
      }
      if (/SELECT id, tenant_id, title FROM knowledge_base_documents/.test(sql)) return { rows: [] };
      if (/DELETE FROM knowledge_chunks/.test(sql) && failDelete) throw new Error('DELETE_FAILED');
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ sql: 'RELEASE', params: [] }); },
  };
  return { calls, connect: async () => client };
}

test('cleanup refuses a tenant whose name is not owned by the run marker', async () => {
  const db = database({ wrongName: true });
  await assert.rejects(cleanupFixture({ database: db, storage: { remove: async () => {} }, state: state() }), /TASK6_E2E_OWNERSHIP_MISMATCH/);
  assert.equal(db.calls.some(({ sql }) => /^DELETE /i.test(sql.trim())), false);
});

test('cleanup deletes a marker-owned source from an existing staging tenant without deleting that tenant', async () => {
  const fixture = state();
  fixture.scopedTenantIds = ['44444444-4444-4444-8444-444444444444'];
  fixture.scopedSourceIds = ['55555555-5555-4555-8555-555555555555'];
  const db = database();
  const originalConnect = db.connect;
  db.connect = async () => {
    const client = await originalConnect();
    const originalQuery = client.query;
    client.query = async (sql, params = []) => {
      if (/SELECT id, tenant_id, title FROM knowledge_base_documents/.test(sql)) {
        db.calls.push({ sql, params });
        return { rows: [{ id: fixture.scopedSourceIds[0], tenant_id: fixture.scopedTenantIds[0], title: `${fixture.marker} shared channel source` }] };
      }
      return originalQuery(sql, params);
    };
    return client;
  };
  await cleanupFixture({ database: db, storage: { remove: async () => {} }, state: fixture });
  assert.ok(db.calls.some(({ sql, params }) => /DELETE FROM knowledge_base_documents WHERE tenant_id = \$1 AND id = ANY/.test(sql) && params[0] === fixture.scopedTenantIds[0]));
  assert.equal(db.calls.some(({ sql, params }) => /DELETE FROM tenants/.test(sql) && params[0]?.includes(fixture.scopedTenantIds[0])), false);
});

test('cleanup uses marker-owned parameterized deletes and removes only verified storage keys', async () => {
  const db = database();
  const removed = [];
  await cleanupFixture({ database: db, storage: { remove: async ({ key }) => removed.push(key) }, state: state() });
  const deletes = db.calls.filter(({ sql }) => /^DELETE /i.test(sql.trim()));
  assert.ok(deletes.length > 20);
  assert.ok(deletes.every(({ sql, params }) => /\$1/.test(sql) && params.length === 1));
  assert.deepEqual(removed, [`knowledge/${TENANT_A}/${SOURCE_A}/abc.txt`]);
  assert.ok(db.calls.some(({ sql }) => sql === 'COMMIT'));
});

test('cleanup rolls back when a scoped delete fails', async () => {
  const db = database({ failDelete: true });
  await assert.rejects(cleanupFixture({ database: db, storage: { remove: async () => {} }, state: state() }), /DELETE_FAILED/);
  assert.ok(db.calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(db.calls.some(({ sql }) => sql === 'COMMIT'), false);
});

test('cleanup refuses a storage key outside its recorded tenant and source namespace', async () => {
  const fixture = state();
  fixture.storageObjects[0].key = 'knowledge/other/source/secret.txt';
  const db = database();
  await assert.rejects(cleanupFixture({ database: db, storage: { remove: async () => {} }, state: fixture }), /TASK6_E2E_STORAGE_OWNERSHIP_MISMATCH/);
  assert.equal(db.calls.some(({ sql }) => /^DELETE /i.test(sql.trim())), false);
});
