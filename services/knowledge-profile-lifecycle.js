import {
  beginKnowledgeGenerationRun,
  completeKnowledgeGenerationRun,
  failKnowledgeGenerationRun,
  KnowledgeGenerationPersistenceError,
} from './knowledge-generation-persistence.js';
import { analyzeBusinessIdentityScope, normalizeBusinessIdentity } from './business-identity-service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class KnowledgeProfileLifecycleError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function uuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeProfileLifecycleError(code, 'Business Profile identifier is invalid');
  return String(value);
}

export async function generateBusinessProfileVersion({ database, provider, tenantId, requestedBy, businessIdentityId, sourceIds }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID');
  uuid(businessIdentityId, 'KNOWLEDGE_BUSINESS_IDENTITY_INVALID');
  if (!Array.isArray(sourceIds) || !sourceIds.length || new Set(sourceIds).size !== sourceIds.length) {
    throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_SOURCE_SCOPE_INVALID', 'Business Profile source scope is invalid');
  }
  sourceIds.forEach((id) => uuid(id, 'KNOWLEDGE_PROFILE_SOURCE_SCOPE_INVALID'));
  if (!database?.query || typeof provider?.generateBusinessProfile !== 'function' || typeof provider?.generateBusinessIdentityAnalysis !== 'function') {
    throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_GENERATION_UNAVAILABLE', 'Business Profile generation is unavailable');
  }
  const identity = await database.query(
    `SELECT id, display_name, normalized_identity FROM business_identities
      WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
    [businessIdentityId, tenantId],
  );
  if (!identity.rows[0]) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_BUSINESS_IDENTITY_NOT_FOUND', 'Business Identity was not found');
  const sources = await database.query(
    `SELECT id, title, content, content_hash
       FROM knowledge_base_documents
      WHERE tenant_id = $1 AND id = ANY($3::uuid[]) AND enabled = TRUE AND status = 'active'
        AND processing_status = 'READY' AND indexing_status = 'READY'
      ORDER BY id`,
    [tenantId, businessIdentityId, sourceIds],
  );
  if (sources.rows.length !== sourceIds.length) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_SOURCE_SCOPE_INVALID', 'One or more selected sources are unavailable or ineligible');
  const analysis = await analyzeBusinessIdentityScope({ provider, sources: sources.rows });
  for (const item of analysis.evidence) {
    await database.query(
      `INSERT INTO business_identity_source_evidence
         (tenant_id, business_identity_id, source_id, content_hash, detected_identity, normalized_detected_identity, confidence, safe_evidence, provider, model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, business_identity_id, source_id, content_hash)
       DO UPDATE SET detected_identity = EXCLUDED.detected_identity, normalized_detected_identity = EXCLUDED.normalized_detected_identity,
                     confidence = EXCLUDED.confidence, safe_evidence = EXCLUDED.safe_evidence, provider = EXCLUDED.provider, model = EXCLUDED.model, updated_at = CURRENT_TIMESTAMP`,
      [tenantId, businessIdentityId, item.source_id, item.content_hash, item.detected_identity, item.normalized_identity, item.confidence, item.safe_evidence, provider.provider, provider.model],
    );
  }
  const selectedIdentity = identity.rows[0].normalized_identity || normalizeBusinessIdentity(identity.rows[0].display_name);
  if (analysis.status !== 'RESOLVED' || analysis.identities[0]?.normalized_identity !== selectedIdentity) {
    throw new KnowledgeProfileLifecycleError('IDENTITY_RESOLUTION_REQUIRED', 'Selected sources contain unresolved or conflicting company identities', { identities: analysis.identities, evidence: analysis.evidence });
  }
  const provenance = { business_identity_id: businessIdentityId, source_ids: sourceIds, sources: analysis.evidence };
  const prompt = [
    'Create Business Profile schema_version 2 from the current tenant approved knowledge only.',
    `The resolved Business Identity is "${identity.rows[0].display_name}". Do not merge, rename, or import another company identity.`,
    'Never use SamChe or any other company, persona, service, price, geography, or behavior as a default.',
    'Extract factual business data only. If evidence is insufficient, use the literal value "unknown"; do not invent a company policy or behavior.',
    'Keep source-derived facts distinct from later AI recommendations. Return only the requested structured fields.',
    ...sources.rows.map((source) => `SOURCE ${source.id} — ${source.title}\n${String(source.content).slice(0, 12000)}`),
  ].join('\n\n');
  const run = await beginKnowledgeGenerationRun({ database, tenantId, requestedBy, targetType: 'BUSINESS_PROFILE', provider: provider.provider, model: provider.model, prompt, provenance });
  try {
    const profileData = await provider.generateBusinessProfile({ prompt });
    const profile = await database.query(
    `INSERT INTO business_profiles (tenant_id, business_identity_id) VALUES ($1, $2)
       ON CONFLICT (tenant_id, business_identity_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [tenantId, businessIdentityId],
    );
    for (const sourceId of sourceIds) {
      await database.query(`INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, sourceId, businessIdentityId]);
    }
    const version = await database.query(
      `INSERT INTO business_profile_versions
         (profile_id, tenant_id, profile_data, evidence, generation_run_id, schema_version, identity_resolution_status, source_scope, generated_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'AI', 'NEEDS_REVIEW')
       RETURNING id, profile_id, status, created_at`,
      [profile.rows[0].id, tenantId, profileData, provenance, run.id, 2, 'RESOLVED', { business_identity_id: businessIdentityId, source_ids: sourceIds }],
    );
    await completeKnowledgeGenerationRun({ database, tenantId, runId: run.id, targetId: version.rows[0].id, output: profileData });
    return version.rows[0];
  } catch (error) {
    const errorCode = /^[A-Z][A-Z0-9_]{2,63}$/.test(String(error?.code ?? '')) ? error.code : 'KNOWLEDGE_PROFILE_GENERATION_FAILED';
    await failKnowledgeGenerationRun({ database, tenantId, runId: run.id, errorCode }).catch(() => {});
    throw error;
  }
}

export async function rejectBusinessProfileVersion({ database, tenantId, versionId, reviewedBy }) {
  const result = await database.query(
    `UPDATE business_profile_versions
        SET status = 'REJECTED', reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND status IN ('DRAFT', 'NEEDS_REVIEW')
      RETURNING id, status`,
    [uuid(versionId, 'KNOWLEDGE_PROFILE_VERSION_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), uuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID')],
  );
  if (!result.rows[0]) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_NOT_REVIEWABLE', 'Business Profile is not available for rejection');
  return result.rows[0];
}

export async function updateBusinessProfileReview({ database, tenantId, versionId, profileData }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(versionId, 'KNOWLEDGE_PROFILE_VERSION_INVALID');
  if (!profileData || typeof profileData !== 'object' || Array.isArray(profileData) || !Object.keys(profileData).length) {
    throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_DATA_INVALID', 'Business Profile review data is invalid');
  }
  const result = await database.query(
    `UPDATE business_profile_versions
        SET profile_data = $3
      WHERE id = $1 AND tenant_id = $2 AND status = 'NEEDS_REVIEW'
      RETURNING id, status, profile_data`,
    [versionId, tenantId, profileData],
  );
  if (!result.rows[0]) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_NOT_REVIEWABLE', 'Business Profile is not available for editing');
  return result.rows[0];
}

export { KnowledgeGenerationPersistenceError };
