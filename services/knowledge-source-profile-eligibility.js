import { resolveKnowledgeSourceCanonicalState } from './knowledge-source-canonical-state.js';

export async function resolveKnowledgeSourceProfileEligibility(database, tenantId, sourceId) {
  const state = await resolveKnowledgeSourceCanonicalState({ database, tenantId, sourceId });
  if (!state) {
    return {
      business_profile_eligible: false,
      business_profile_eligibility_reason: 'SOURCE_NOT_FOUND',
    };
  }

  return {
    business_profile_eligible: state.profileEligible,
    business_profile_eligibility_reason: state.profileEligibilityReason,
  };
}

export async function presentKnowledgeSourceWithProfileEligibility(database, tenantId, source) {
  const eligibility = await resolveKnowledgeSourceProfileEligibility(database, tenantId, source.id);
  const { content_hash: _contentHash, status: _status, ...publicSource } = source;
  return { ...publicSource, ...eligibility };
}
