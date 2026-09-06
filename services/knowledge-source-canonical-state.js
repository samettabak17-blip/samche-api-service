const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) {
    const error = new Error('Knowledge source state identifier is invalid');
    error.code = code;
    throw error;
  }
  return String(value);
}

function isImageSource(source) {
  return /^image\/(jpeg|png)$/i.test(String(source?.mime_type ?? ''));
}

function identityCount(source) {
  if (Number.isInteger(Number(source?.direct_identity_count))) return Number(source.direct_identity_count);
  return new Set((source?.trusted_identity_ids ?? []).filter(Boolean).map(String)).size;
}

export function deriveKnowledgeSourceCanonicalState(source) {
  if (!source) return null;
  const image = isImageSource(source);
  const processingReady = source.enabled === true
    && source.status === 'active'
    && source.processing_status === 'READY'
    && /^[a-f0-9]{64}$/i.test(String(source.content_hash ?? ''));
  const imageCandidateEligible = image && processingReady && /^[a-f0-9]{64}$/i.test(String(source.extraction_hash ?? source.content_hash ?? ''));
  const indexEligible = !image && processingReady;
  const indexReady = indexEligible && source.indexing_status === 'READY';
  const identityValid = identityCount(source) === 1;

  let profileEligibilityReason = 'ELIGIBLE';
  if (source.enabled !== true) profileEligibilityReason = 'SOURCE_DISABLED';
  else if (source.status !== 'active') profileEligibilityReason = 'SOURCE_INACTIVE';
  else if (source.processing_status !== 'READY') profileEligibilityReason = 'PROCESSING_NOT_READY';
  else if (!/^[a-f0-9]{64}$/i.test(String(source.content_hash ?? ''))) profileEligibilityReason = 'CONTENT_HASH_MISSING';
  else if (image) profileEligibilityReason = 'CANONICAL_CANDIDATE_APPROVAL_REQUIRED';
  else if (!indexReady) profileEligibilityReason = 'INDEXING_NOT_READY';

  return {
    sourceId: source.id,
    tenantId: source.tenant_id,
    sourceType: source.source_type,
    processingReady,
    identityValid,
    imageCandidateEligible,
    indexEligible,
    indexReady,
    profileEligible: profileEligibilityReason === 'ELIGIBLE',
    profileEligibilityReason,
  };
}

export async function resolveKnowledgeSourceCanonicalState({ database, tenantId, sourceId }) {
  if (!database?.query) {
    const error = new Error('Knowledge source state is unavailable');
    error.code = 'KNOWLEDGE_DATABASE_UNAVAILABLE';
    throw error;
  }
  requiredUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requiredUuid(sourceId, 'KNOWLEDGE_SOURCE_INVALID');
  const result = await database.query(
    `SELECT source.id, source.tenant_id, source.source_type, source.mime_type,
            source.enabled, source.status, source.processing_status, source.indexing_status,
            source.content_hash, source.extraction_hash,
            (SELECT COUNT(*)::integer
               FROM knowledge_source_business_identities identity_link
               JOIN business_identities identity
                 ON identity.id = identity_link.business_identity_id
                AND identity.tenant_id = identity_link.tenant_id
              WHERE identity_link.tenant_id = source.tenant_id
                AND identity_link.source_id = source.id
                AND identity.status = 'ACTIVE') AS direct_identity_count
       FROM knowledge_base_documents source
      WHERE source.tenant_id = $1 AND source.id = $2`,
    [tenantId, sourceId],
  );
  return deriveKnowledgeSourceCanonicalState(result.rows[0] ?? null);
}
