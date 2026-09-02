import test from 'node:test';
import assert from 'node:assert/strict';
import { assignKnowledgeSourceBusinessIdentity } from '../services/knowledge-source-business-identity-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const identityId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function database({ existing = [] } = {}) {
  const calls = [];
  const client = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM knowledge_base_documents/i.test(sql)) return { rowCount: 1, rows: [{ id: sourceId }] };
    if (/FROM business_identities/i.test(sql)) return { rowCount: 1, rows: [{ id: identityId, display_name: 'Northstar Events' }] };
    if (/FROM knowledge_source_business_identities/i.test(sql) && /FOR UPDATE/i.test(sql)) return { rowCount: existing.length, rows: existing.map((business_identity_id) => ({ business_identity_id })) };
    return { rowCount: 0, rows: [] };
  }, release() {} };
  return { calls, connect: async () => client };
}

test('explicitly assigns a tenant source to an active tenant Business Identity with audit metadata', async () => {
  const db = database();
  const result = await assignKnowledgeSourceBusinessIdentity({ database: db, tenantId, sourceId, businessIdentityId: identityId, assignedBy: actorId });
  assert.equal(result.changed, true);
  const insert = db.calls.find(({ sql }) => /INSERT INTO knowledge_source_business_identities/i.test(sql));
  assert.deepEqual(insert.params, [tenantId, sourceId, identityId, actorId]);
  assert.match(insert.sql, /HUMAN_CONFIRMED_SOURCE_IDENTITY/);
  assert.ok(db.calls.some(({ sql }) => /knowledge_source_business_identity_assignment_events/i.test(sql)));
});

test('does not rewrite an identical explicit assignment or generate duplicate audit events', async () => {
  const db = database({ existing: [identityId] });
  const result = await assignKnowledgeSourceBusinessIdentity({ database: db, tenantId, sourceId, businessIdentityId: identityId, assignedBy: actorId });
  assert.equal(result.changed, false);
  assert.equal(db.calls.some(({ sql }) => /INSERT INTO knowledge_source_business_identity_assignment_events/i.test(sql)), false);
});

test('snapshots historical evidence before explicit reassignment without rewriting candidates', async () => {
  const db = database({ existing: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'] });
  await assignKnowledgeSourceBusinessIdentity({ database: db, tenantId, sourceId, businessIdentityId: identityId, assignedBy: actorId });
  const snapshot = db.calls.find(({ sql }) => /UPDATE knowledge_candidate_image_evidence/i.test(sql));
  assert.deepEqual(snapshot.params, [tenantId, sourceId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']);
  assert.equal(db.calls.some(({ sql }) => /UPDATE knowledge_candidates/i.test(sql)), false);
});
