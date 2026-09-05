import { resolveKnowledgeSourceCanonicalState } from './knowledge-source-canonical-state.js';

export async function resolveKnowledgeSourceProfileEligibility(database, tenantId, sourceId) {
  const state = await resolveKnowledgeSourceCanonicalState({ database, tenantId, sourceId });
  if (!state) {
    return {
      business_profile_eligible: false,
      business_profile_eligibility_reason: 'SOURCE_NOT_FOUND',
    };
  }

  let reason = 'ELIGIBLE';
  if (!state.profileEligible) {
      if (!state.processingReady) reason = 'PROCESSING_NOT_READY';
      else if (!state.indexReady) reason = 'INDEXING_NOT_READY';
      else if (!state.identityValid) reason = 'IDENTITY_INVALID';
      else reason = 'UNKNOWN';
  }

  return {
    business_profile_eligible: reason === 'ELIGIBLE',
    business_profile_eligibility_reason: reason,
  };
}

export async function presentKnowledgeSourceWithProfileEligibility(database, tenantId, source) {
  const eligibility = await resolveKnowledgeSourceProfileEligibility(database, tenantId, source.id);
  const { content_hash: _contentHash, status: _status, ...publicSource } = source;
  return { ...publicSource, ...eligibility };
}

