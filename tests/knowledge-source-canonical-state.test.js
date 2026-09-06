import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnowledgeSourceCanonicalState } from '../services/knowledge-source-canonical-state.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function sourceRow(overrides = {}) {
  return {
    id: sourceId,
    tenant_id: tenantId,
    enabled: true,
    status: 'active',
    source_type: 'DOCUMENT',
    mime_type: 'image/png',
    content: 'Trusted extracted business facts.',
    content_hash: 'a'.repeat(64),
    processing_status: 'READY',
    indexing_status: 'PENDING',
    indexed_chunk_count: 0,
    direct_identity_count: 1,
    ...overrides,
  };
}

function stateDatabase(row) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM knowledge_base_documents source/i.test(sql)) return { rows: [row] };
      return { rows: [] };
    },
  };
}

test('canonical state keeps a processed image candidate source outside retrieval indexing', async () => {
  const database = stateDatabase(sourceRow());
  const state = await resolveKnowledgeSourceCanonicalState({ database, tenantId, sourceId });

  assert.equal(state.processingReady, true);
  assert.equal(state.identityValid, true);
  assert.equal(state.imageCandidateEligible, true);
  assert.equal(state.indexEligible, false);
  assert.equal(state.indexReady, false);
  assert.equal(state.profileEligible, false);
  assert.equal(state.profileEligibilityReason, 'CANONICAL_CANDIDATE_APPROVAL_REQUIRED');
  assert.ok(database.calls.every(({ params }) => params.includes(tenantId) || !params.length));
});

test('canonical state reports index readiness only for an indexed canonical source', async () => {
  const pending = await resolveKnowledgeSourceCanonicalState({
    database: stateDatabase(sourceRow({ mime_type: 'text/plain', source_type: 'CONVERSATION_CANDIDATE', indexing_status: 'PENDING', direct_identity_count: 0 })),
    tenantId,
    sourceId,
  });
  const indexed = await resolveKnowledgeSourceCanonicalState({
    database: stateDatabase(sourceRow({ mime_type: 'text/plain', source_type: 'CONVERSATION_CANDIDATE', indexing_status: 'READY', direct_identity_count: 0 })),
    tenantId,
    sourceId,
  });

  assert.equal(pending.indexEligible, true);
  assert.equal(pending.indexReady, false);
  assert.equal(indexed.indexReady, true);
  assert.equal(indexed.profileEligible, true);
});
