import test from 'node:test';
import assert from 'node:assert/strict';
import { presentKnowledgeSourceWithProfileEligibility, resolveKnowledgeSourceProfileEligibility } from '../services/knowledge-source-profile-eligibility.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function database(row) {
  return { async query(sql) {
    if (/FROM knowledge_base_documents source/i.test(sql)) return { rows: [row] };
    return { rows: [] };
  } };
}

function ready(overrides = {}) {
  return {
    id: sourceId, tenant_id: tenantId, enabled: true, status: 'active', source_type: 'DOCUMENT',
    mime_type: 'application/pdf', content: 'Trusted source text.', processing_status: 'READY', indexing_status: 'READY',
    content_hash: 'a'.repeat(64), indexed_chunk_count: 1, direct_identity_count: 0, ...overrides,
  };
}

test('marks only sources accepted by the canonical Business Profile lifecycle as eligible', async () => {
  assert.deepEqual(await resolveKnowledgeSourceProfileEligibility(database(ready()), tenantId, sourceId), {
    business_profile_eligible: true,
    business_profile_eligibility_reason: 'ELIGIBLE',
  });
  assert.equal((await resolveKnowledgeSourceProfileEligibility(database(ready({ indexing_status: 'PROCESSING', indexed_chunk_count: 0 })), tenantId, sourceId)).business_profile_eligibility_reason, 'INDEXING_NOT_READY');
  assert.equal((await resolveKnowledgeSourceProfileEligibility(database(ready({ content_hash: null })), tenantId, sourceId)).business_profile_eligibility_reason, 'CONTENT_HASH_MISSING');
});

test('reports bounded canonical reasons without exposing internal errors', async () => {
  assert.equal((await resolveKnowledgeSourceProfileEligibility(database(ready({ enabled: false })), tenantId, sourceId)).business_profile_eligibility_reason, 'SOURCE_DISABLED');
  assert.equal((await resolveKnowledgeSourceProfileEligibility(database(ready({ status: 'archived' })), tenantId, sourceId)).business_profile_eligibility_reason, 'SOURCE_INACTIVE');
  assert.equal((await resolveKnowledgeSourceProfileEligibility(database(ready({ processing_status: 'FAILED' })), tenantId, sourceId)).business_profile_eligibility_reason, 'PROCESSING_NOT_READY');
});

test('reports that a processed raw image requires canonical candidate approval rather than falsely claiming indexing is pending', async () => {
  const result = await resolveKnowledgeSourceProfileEligibility(database(ready({
    mime_type: 'image/png', content: 'Extracted mixed business and customer context.', indexing_status: 'DISABLED', direct_identity_count: 1,
  })), tenantId, sourceId);
  assert.deepEqual(result, {
    business_profile_eligible: false,
    business_profile_eligibility_reason: 'CANONICAL_CANDIDATE_APPROVAL_REQUIRED',
  });
});

test('presents the durable source state without exposing source content or raw lifecycle columns as eligibility authority', async () => {
  const source = { ...ready({ mime_type: 'image/png', indexing_status: 'DISABLED', direct_identity_count: 1 }), content_hash: 'a'.repeat(64), status: 'active' };
  const result = await presentKnowledgeSourceWithProfileEligibility(database(source), tenantId, source);
  assert.equal(result.business_profile_eligibility_reason, 'CANONICAL_CANDIDATE_APPROVAL_REQUIRED');
  assert.equal('content_hash' in result, false);
  assert.equal('status' in result, false);
});
