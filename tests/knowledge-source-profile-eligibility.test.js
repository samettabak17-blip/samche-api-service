import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnowledgeSourceProfileEligibility } from '../services/knowledge-source-profile-eligibility.js';

const ready = {
  enabled: true,
  status: 'active',
  processing_status: 'READY',
  indexing_status: 'READY',
  content_hash: 'a'.repeat(64),
};

test('marks only sources accepted by the Business Profile lifecycle as eligible', () => {
  assert.deepEqual(resolveKnowledgeSourceProfileEligibility(ready), {
    business_profile_eligible: true,
    business_profile_eligibility_reason: 'ELIGIBLE',
  });
  assert.equal(resolveKnowledgeSourceProfileEligibility({ ...ready, indexing_status: 'PROCESSING' }).business_profile_eligibility_reason, 'INDEXING_NOT_READY');
  assert.equal(resolveKnowledgeSourceProfileEligibility({ ...ready, content_hash: null }).business_profile_eligibility_reason, 'CONTENT_HASH_MISSING');
});

test('reports bounded server-owned reasons without exposing internal errors', () => {
  assert.equal(resolveKnowledgeSourceProfileEligibility({ ...ready, enabled: false }).business_profile_eligibility_reason, 'SOURCE_DISABLED');
  assert.equal(resolveKnowledgeSourceProfileEligibility({ ...ready, status: 'archived' }).business_profile_eligibility_reason, 'SOURCE_INACTIVE');
  assert.equal(resolveKnowledgeSourceProfileEligibility({ ...ready, processing_status: 'FAILED' }).business_profile_eligibility_reason, 'PROCESSING_NOT_READY');
});
