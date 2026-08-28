import {
  beginKnowledgeGenerationRun,
  completeKnowledgeGenerationRun,
  failKnowledgeGenerationRun,
  KnowledgeGenerationPersistenceError,
} from './knowledge-generation-persistence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class KnowledgeProfileLifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function uuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeProfileLifecycleError(code, 'Business Profile identifier is invalid');
  return String(value);
}

export async function generateBusinessProfileVersion({ database, provider, tenantId, requestedBy }) {
  uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID');
  if (!database?.query || typeof provider?.generateBusinessProfile !== 'function') {
    throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_GENERATION_UNAVAILABLE', 'Business Profile generation is unavailable');
  }
  const sources = await database.query(
    `SELECT id, title, content, content_hash
       FROM knowledge_base_documents
      WHERE tenant_id = $1 AND enabled = TRUE AND status = 'active'
        AND processing_status = 'READY' AND indexing_status = 'READY'
      ORDER BY updated_at DESC
      LIMIT 100`,
    [tenantId],
  );
  if (!sources.rows.length) throw new KnowledgeProfileLifecycleError('KNOWLEDGE_PROFILE_SOURCES_EMPTY', 'No ready knowledge sources are available');
  const provenance = { sources: sources.rows.map(({ id, content_hash }) => ({ id, content_hash })) };
  const prompt = [
    'Create Business Profile schema_version 2 from the current tenant approved knowledge only.',
    'Never use SamChe or any other company, persona, service, price, geography, or behavior as a default.',
    'Extract factual business data only. If evidence is insufficient, use the literal value "unknown"; do not invent a company policy or behavior.',
    'Keep source-derived facts distinct from later AI recommendations. Return only the requested structured fields.',
    ...sources.rows.map((source) => `SOURCE ${source.id} — ${source.title}\n${String(source.content).slice(0, 12000)}`),
  ].join('\n\n');
  const run = await beginKnowledgeGenerationRun({ database, tenantId, requestedBy, targetType: 'BUSINESS_PROFILE', provider: provider.provider, model: provider.model, prompt, provenance });
  try {
    const profileData = await provider.generateBusinessProfile({ prompt });
    const profile = await database.query(
      `INSERT INTO business_profiles (tenant_id) VALUES ($1)
       ON CONFLICT (tenant_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [tenantId],
    );
    const version = await database.query(
      `INSERT INTO business_profile_versions
         (profile_id, tenant_id, profile_data, evidence, generation_run_id, schema_version, generated_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'AI', 'NEEDS_REVIEW')
       RETURNING id, profile_id, status, created_at`,
      [profile.rows[0].id, tenantId, profileData, provenance, run.id, 2],
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
