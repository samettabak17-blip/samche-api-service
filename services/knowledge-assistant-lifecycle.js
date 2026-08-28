import { beginKnowledgeGenerationRun, completeKnowledgeGenerationRun, failKnowledgeGenerationRun } from './knowledge-generation-persistence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class KnowledgeAssistantLifecycleError extends Error { constructor(code, message) { super(message); this.code = code; } }
function uuid(value, code) { if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeAssistantLifecycleError(code, 'Assistant lifecycle identifier is invalid'); return String(value); }
function requireProvider(database, provider, method) { if (!database?.query || typeof provider?.[method] !== 'function') throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_ASSISTANT_GENERATION_UNAVAILABLE', 'Assistant generation is unavailable'); }

async function generate({ database, provider, tenantId, requestedBy, targetType, prompt, provenance, persist }) {
  const run = await beginKnowledgeGenerationRun({ database, tenantId, requestedBy, targetType, provider: provider.provider, model: provider.model, prompt, provenance });
  try {
    const output = targetType === 'RECOMMENDATION'
      ? await provider.generateAssistantRecommendation({ prompt })
      : await provider.generateAssistantConfiguration({ prompt });
    const artifact = await persist(output, run.id);
    await completeKnowledgeGenerationRun({ database, tenantId, runId: run.id, targetId: artifact.id, output });
    return artifact;
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]{2,63}$/.test(String(error?.code ?? '')) ? error.code : 'KNOWLEDGE_ASSISTANT_GENERATION_FAILED';
    await failKnowledgeGenerationRun({ database, tenantId, runId: run.id, errorCode: code }).catch(() => {});
    throw error;
  }
}

export async function generateAssistantRecommendation({ database, provider, tenantId, assistantId, businessProfileVersionId, requestedBy }) {
  requireProvider(database, provider, 'generateAssistantRecommendation'); uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'); uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID'); uuid(businessProfileVersionId, 'KNOWLEDGE_PROFILE_VERSION_INVALID'); uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID');
  const context = await database.query(
    `SELECT assistant.name AS assistant_name, profile_version.id AS profile_version_id, profile.business_identity_id,
            profile_version.source_scope, profile_version.profile_data
       FROM ai_assistants assistant
       JOIN business_profiles profile ON profile.tenant_id = assistant.tenant_id AND profile.active_version_id IS NOT NULL
       JOIN business_profile_versions profile_version ON profile_version.id = profile.active_version_id AND profile_version.tenant_id = profile.tenant_id AND profile_version.status = 'APPROVED'
      WHERE assistant.id = $1 AND assistant.tenant_id = $2 AND profile_version.id = $3 AND assistant.status = 'active'`, [assistantId, tenantId, businessProfileVersionId]);
  if (!context.rows[0]) throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_RECOMMENDATION_CONTEXT_NOT_FOUND', 'An active approved Business Profile is required');
  const provenance = { profile_version_id: context.rows[0].profile_version_id, business_identity_id: context.rows[0].business_identity_id, source_scope: context.rows[0].source_scope, assistant_id: assistantId };
  const prompt = [
    'Create an AI recommendation with schema_version 2 for the current tenant Assistant using only the ACTIVE factual Business Profile below.',
    'Never use SamChe or another tenant as a default. Do not import another tenant identity, service, price, geography, or behavior.',
    'Recommendations are proposals, not source-derived facts. Mark unsupported behavior in evidence_gaps instead of inventing policy.',
    `Assistant display name: ${context.rows[0].assistant_name}`,
    `ACTIVE factual Business Profile: ${JSON.stringify(context.rows[0].profile_data)}`,
  ].join('\n');
  return generate({ database, provider, tenantId, requestedBy, targetType: 'RECOMMENDATION', prompt, provenance, persist: async (output, runId) => {
    const result = await database.query(`INSERT INTO assistant_knowledge_recommendations
      (tenant_id, assistant_id, recommendation_data, evidence, generation_run_id, schema_version, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'NEEDS_REVIEW') RETURNING id, status, created_at`, [tenantId, assistantId, output, provenance, runId, 2]);
    return result.rows[0];
  } });
}

export async function generateAssistantConfigurationVersion({ database, provider, tenantId, assistantId, recommendationId, requestedBy }) {
  requireProvider(database, provider, 'generateAssistantConfiguration'); uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'); uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID'); uuid(recommendationId, 'KNOWLEDGE_RECOMMENDATION_INVALID'); uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID');
  const context = await database.query(
    `SELECT recommendation.recommendation_data, profile_version.id AS profile_version_id, profile.business_identity_id,
            profile_version.source_scope, profile_version.profile_data
       FROM assistant_knowledge_recommendations recommendation
       JOIN business_profile_versions profile_version ON profile_version.id = (recommendation.evidence->>'profile_version_id')::uuid AND profile_version.tenant_id = recommendation.tenant_id AND profile_version.status = 'APPROVED'
       JOIN business_profiles profile ON profile.id = profile_version.profile_id AND profile.tenant_id = profile_version.tenant_id AND profile.active_version_id = profile_version.id
      WHERE recommendation.id = $1 AND recommendation.tenant_id = $2 AND recommendation.assistant_id = $3 AND recommendation.status = 'APPROVED'`, [recommendationId, tenantId, assistantId]);
  if (!context.rows[0]) throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_CONFIGURATION_CONTEXT_NOT_FOUND', 'An approved recommendation and active Business Profile are required');
  const provenance = { profile_version_id: context.rows[0].profile_version_id, business_identity_id: context.rows[0].business_identity_id, source_scope: context.rows[0].source_scope, recommendation_id: recommendationId, assistant_id: assistantId };
  const prompt = [
    'Create Assistant Configuration schema_version 2 for the current tenant from the ACTIVE factual profile and APPROVED AI recommendation only.',
    'Never use SamChe or another tenant as a default. Do not import another tenant identity, service, price, geography, or behavior.',
    'The factual profile is authoritative business evidence; the approved AI recommendation is reviewed proposed behavior. Do not merge unknown recommendations into business facts.',
    `ACTIVE factual profile: ${JSON.stringify(context.rows[0].profile_data)}`,
    `APPROVED AI recommendation: ${JSON.stringify(context.rows[0].recommendation_data)}`,
  ].join('\n');
  return generate({ database, provider, tenantId, requestedBy, targetType: 'ASSISTANT_CONFIGURATION', prompt, provenance, persist: async (output, runId) => {
    const result = await database.query(`INSERT INTO assistant_configuration_versions
      (tenant_id, assistant_id, configuration_data, source_profile_version_id, source_recommendation_id, generation_run_id, schema_version, generated_by, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'AI', 'NEEDS_REVIEW') RETURNING id, status, created_at`, [tenantId, assistantId, output, context.rows[0].profile_version_id, recommendationId, runId, 2]);
    return result.rows[0];
  } });
}

export async function reviewAssistantRecommendation({ database, tenantId, assistantId, recommendationId, reviewedBy, decision }) {
  const status = String(decision).toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(status)) throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_RECOMMENDATION_DECISION_INVALID', 'Recommendation decision is invalid');
  const result = await database.query(`UPDATE assistant_knowledge_recommendations SET status = $5, reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2 AND assistant_id = $3 AND status IN ('DRAFT', 'NEEDS_REVIEW') RETURNING id, status`,
  [uuid(recommendationId, 'KNOWLEDGE_RECOMMENDATION_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID'), uuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID'), status]);
  if (!result.rows[0]) throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_RECOMMENDATION_NOT_REVIEWABLE', 'Recommendation is not reviewable');
  return result.rows[0];
}

export async function rejectAssistantConfigurationVersion({ database, tenantId, assistantId, versionId, reviewedBy }) {
  const result = await database.query(`UPDATE assistant_configuration_versions SET status = 'REJECTED', approved_by = $4, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND tenant_id = $2 AND assistant_id = $3 AND status IN ('DRAFT', 'NEEDS_REVIEW') RETURNING id, status`,
  [uuid(versionId, 'KNOWLEDGE_CONFIGURATION_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID'), uuid(reviewedBy, 'KNOWLEDGE_REVIEWER_INVALID')]);
  if (!result.rows[0]) throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_CONFIGURATION_NOT_REVIEWABLE', 'Configuration is not reviewable');
  return result.rows[0];
}
