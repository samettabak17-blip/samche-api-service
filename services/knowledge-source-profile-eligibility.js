export function resolveKnowledgeSourceProfileEligibility(source) {
  let reason = 'ELIGIBLE';
  if (source?.enabled !== true) reason = 'SOURCE_DISABLED';
  else if (String(source?.status ?? '').toLowerCase() !== 'active') reason = 'SOURCE_INACTIVE';
  else if (source?.processing_status !== 'READY') reason = 'PROCESSING_NOT_READY';
  else if (source?.indexing_status !== 'READY') reason = 'INDEXING_NOT_READY';
  else if (source?.content_hash == null) reason = 'CONTENT_HASH_MISSING';
  return {
    business_profile_eligible: reason === 'ELIGIBLE',
    business_profile_eligibility_reason: reason,
  };
}

export function presentKnowledgeSourceWithProfileEligibility(source) {
  const { content_hash: _contentHash, status: _status, ...publicSource } = source;
  return { ...publicSource, ...resolveKnowledgeSourceProfileEligibility(source) };
}
