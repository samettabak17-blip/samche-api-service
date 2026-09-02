import crypto from 'node:crypto';
import { advanceKnowledgeGenerationRun, beginKnowledgeGenerationRun, completeKnowledgeGenerationRun, failKnowledgeGenerationRun, recordKnowledgeGenerationProviderTelemetry } from './knowledge-generation-persistence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class KnowledgeAssistantLifecycleError extends Error { constructor(code, message) { super(message); this.code = code; } }
function uuid(value, code) { if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeAssistantLifecycleError(code, 'Assistant lifecycle identifier is invalid'); return String(value); }
function requireProvider(database, provider, method) { if (!database?.query || typeof provider?.[method] !== 'function') throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_ASSISTANT_GENERATION_UNAVAILABLE', 'Assistant generation is unavailable'); }

const SCHEMA_VERSION = 2;
const RECOMMENDATION_IDENTITY_CONTRACT = 'V2_TENANT_OWNED_IDENTITY_ONLY';
const CONFIGURATION_RUNTIME_CONTRACT = 'V2_ASSISTANT_IDENTITY_PROVENANCE_REQUIRED';

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function tenantOwnedIdentity(candidate, assistantName) {
  const value = nonEmptyText(candidate);
  const metadata = nonEmptyText(assistantName);
  return value && (!metadata || value !== metadata) ? value : null;
}

function withRuntimeAssistantIdentity(output, { recommendationData, profileData, assistantName }) {
  const assistantIdentity = tenantOwnedIdentity(output?.assistant_identity, assistantName)
    ?? tenantOwnedIdentity(recommendationData?.assistant_identity, assistantName)
    ?? nonEmptyText(profileData?.company_display_name)
    ?? nonEmptyText(profileData?.company_identity);
  if (!assistantIdentity) {
    throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_CONFIGURATION_RUNTIME_IDENTITY_UNAVAILABLE', 'Active Business Profile or approved Recommendation must provide an Assistant Identity');
  }
  return { ...output, assistant_identity: assistantIdentity };
}

function requestFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function advisoryKey(fingerprint) {
  return BigInt.asIntN(64, BigInt(`0x${fingerprint.slice(0, 16)}`)).toString();
}

async function withGenerationLock(database, fingerprint, operation) {
  if (typeof database?.connect !== 'function') return operation(database);
  const client = await database.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [advisoryKey(fingerprint)]);
    return await operation(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [advisoryKey(fingerprint)]).catch(() => {});
    client.release();
  }
}

async function existingSuccessfulArtifact({ database, tenantId, targetType, fingerprint }) {
  const relation = targetType === 'RECOMMENDATION'
    ? 'assistant_knowledge_recommendations'
    : 'assistant_configuration_versions';
  const result = await database.query(
    `SELECT artifact.*, run.id AS run_id
       FROM knowledge_generation_runs run
       JOIN ${relation} artifact ON artifact.id = run.target_id AND artifact.tenant_id = run.tenant_id
      WHERE run.tenant_id = $1 AND run.target_type = $2 AND run.request_fingerprint = $3
        AND run.status = 'SUCCEEDED' LIMIT 1`,
    [tenantId, targetType, fingerprint],
  );
  return result.rows[0] ?? null;
}

async function generate({ database, provider, tenantId, requestedBy, targetType, prompt, provenance, fingerprint, generationStage, sourceCount, persist }) {
  return withGenerationLock(database, fingerprint, async (generationDatabase) => {
    const successful = await existingSuccessfulArtifact({ database: generationDatabase, tenantId, targetType, fingerprint });
    if (successful) {
      const { run_id: runId, ...artifact } = successful;
      return { artifact, reused: true, run_id: runId };
    }
    const active = await generationDatabase.query(
      `SELECT id FROM knowledge_generation_runs
        WHERE tenant_id = $1 AND target_type = $2 AND request_fingerprint = $3 AND status = 'RUNNING' LIMIT 1`,
      [tenantId, targetType, fingerprint],
    );
    if (active.rows[0]) throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_ASSISTANT_GENERATION_IN_PROGRESS', 'An identical Assistant generation attempt is already running');

    const startedAt = Date.now();
    let runStage = 'PROFILE_CONTEXT';
    const run = await beginKnowledgeGenerationRun({
      database: generationDatabase, tenantId, requestedBy, targetType,
      provider: provider.provider, model: provider.model, prompt: `generation-attempt:${fingerprint}`,
      provenance, businessIdentityId: provenance.business_identity_id, requestFingerprint: fingerprint,
      stage: runStage, promptCharacterCount: 0, sourceCount,
    });
    try {
      runStage = generationStage;
      await advanceKnowledgeGenerationRun({ database: generationDatabase, tenantId, runId: run.id, stage: runStage, promptCharacterCount: prompt.length, sourceCount, elapsedMs: Date.now() - startedAt });
      const output = targetType === 'RECOMMENDATION'
        ? await provider.generateAssistantRecommendation({ prompt, runId: run.id, requestFingerprint: fingerprint, telemetry: (event) => recordKnowledgeGenerationProviderTelemetry({ database: generationDatabase, tenantId, runId: run.id, event: event.event, timestamp: event.timestamp, httpStatus: event.http_status, elapsedMs: event.elapsed_ms, abortBeforeHttpResponse: event.http_response_received === false, networkErrorClass: event.classification }) })
        : await provider.generateAssistantConfiguration({ prompt, runId: run.id, requestFingerprint: fingerprint, telemetry: (event) => recordKnowledgeGenerationProviderTelemetry({ database: generationDatabase, tenantId, runId: run.id, event: event.event, timestamp: event.timestamp, httpStatus: event.http_status, elapsedMs: event.elapsed_ms, abortBeforeHttpResponse: event.http_response_received === false, networkErrorClass: event.classification }) });
      runStage = 'PERSISTENCE';
      await advanceKnowledgeGenerationRun({ database: generationDatabase, tenantId, runId: run.id, stage: runStage, promptCharacterCount: prompt.length, sourceCount, elapsedMs: Date.now() - startedAt });
      await generationDatabase.query('BEGIN');
      try {
        const artifact = await persist(generationDatabase, output, run.id);
        await completeKnowledgeGenerationRun({ database: generationDatabase, tenantId, runId: run.id, targetId: artifact.id, output, elapsedMs: Date.now() - startedAt });
        await generationDatabase.query('COMMIT');
        return { artifact, reused: false, run_id: run.id };
      } catch (error) {
        await generationDatabase.query('ROLLBACK').catch(() => {});
        throw error;
      }
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]{2,63}$/.test(String(error?.code ?? '')) ? error.code : 'KNOWLEDGE_ASSISTANT_GENERATION_FAILED';
      await failKnowledgeGenerationRun({ database: generationDatabase, tenantId, runId: run.id, errorCode: code, stage: runStage, elapsedMs: Date.now() - startedAt }).catch(() => {});
      throw error;
    }
  });
}

export async function prepareAssistantRecommendationGeneration({ database, provider, tenantId, assistantId, businessProfileVersionId, requestedBy, allowInactiveProfileSnapshot = false }) {
  requireProvider(database, provider, 'generateAssistantRecommendation'); uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'); uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID'); uuid(businessProfileVersionId, 'KNOWLEDGE_PROFILE_VERSION_INVALID'); uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID');
  const context = await database.query(
    `SELECT assistant.name AS assistant_name, profile_version.id AS profile_version_id, profile.business_identity_id,
            profile_version.source_scope, profile_version.evidence, profile_version.profile_data
       FROM ai_assistants assistant
       JOIN business_profiles profile ON profile.tenant_id = assistant.tenant_id ${allowInactiveProfileSnapshot ? '' : 'AND profile.active_version_id = $3'}
       JOIN business_profile_versions profile_version ON profile_version.id = $3 AND profile_version.tenant_id = profile.tenant_id AND profile_version.status = 'APPROVED'
      WHERE assistant.id = $1 AND assistant.tenant_id = $2 AND profile_version.id = $3 AND assistant.status = 'active'`, [assistantId, tenantId, businessProfileVersionId]);
  if (!context.rows[0] || (!allowInactiveProfileSnapshot && context.rows[0].profile_version_id !== businessProfileVersionId)) throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_RECOMMENDATION_CONTEXT_NOT_FOUND', 'An active approved Business Profile is required');
  const provenance = { profile_version_id: context.rows[0].profile_version_id, business_identity_id: context.rows[0].business_identity_id, source_scope: context.rows[0].source_scope, assistant_id: assistantId };
  const sourceHashes = context.rows[0].evidence?.source_hashes ?? context.rows[0].evidence?.sources ?? [];
  provenance.source_hashes = sourceHashes;
  const prompt = [
      'Create a concise AI recommendation with schema_version 2 for the current tenant Assistant using only the ACTIVE factual Business Profile below. Return only 1 to 4 directly supported recommendation fields; omit every unsupported field.',
    'Never use SamChe or another tenant as a default. Do not import another tenant identity, service, price, geography, or behavior.',
    'Recommendations are proposals, not source-derived facts. Mark unsupported behavior in evidence_gaps instead of inventing policy. Never treat platform or operator Assistant metadata as tenant identity; derive identity only from tenant-owned profile/source evidence.',
    `ACTIVE factual Business Profile: ${JSON.stringify(context.rows[0].profile_data)}`,
  ].join('\n');
  const fingerprint = requestFingerprint({ tenant_id: tenantId, assistant_id: assistantId, active_profile_version_id: businessProfileVersionId, business_identity_id: provenance.business_identity_id, source_scope: provenance.source_scope, source_hashes: sourceHashes, schema_version: SCHEMA_VERSION, identity_contract: RECOMMENDATION_IDENTITY_CONTRACT, provider: provider.provider, model: provider.model, generation_policy: provider.assistantGenerationPolicy ?? null });
  return { prompt, provenance, fingerprint, sourceCount: provenance.source_scope?.source_ids?.length ?? 0 };
}

export async function generateAssistantRecommendation({ database, provider, tenantId, assistantId, businessProfileVersionId, requestedBy, allowInactiveProfileSnapshot = false, expectedFingerprint = null }) {
  const prepared = await prepareAssistantRecommendationGeneration({ database, provider, tenantId, assistantId, businessProfileVersionId, requestedBy, allowInactiveProfileSnapshot });
  if (expectedFingerprint && expectedFingerprint !== prepared.fingerprint) {
    throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_RECOMMENDATION_POLICY_CHANGED', 'Assistant Recommendation generation policy changed before the job was processed');
  }
  const generated = await generate({ database, provider, tenantId, requestedBy, targetType: 'RECOMMENDATION', prompt: prepared.prompt, provenance: prepared.provenance, fingerprint: prepared.fingerprint, generationStage: 'RECOMMENDATION_GENERATION', sourceCount: prepared.sourceCount, persist: async (generationDatabase, output, runId) => {
    const result = await generationDatabase.query(`INSERT INTO assistant_knowledge_recommendations
      (tenant_id, assistant_id, recommendation_data, evidence, generation_run_id, schema_version, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'NEEDS_REVIEW') RETURNING id, status, created_at`, [tenantId, assistantId, output, prepared.provenance, runId, 2]);
    return result.rows[0];
  } });
  return { recommendation: generated.artifact, reused: generated.reused, run_id: generated.run_id };
}

export async function generateAssistantConfigurationVersion({ database, provider, tenantId, assistantId, recommendationId, requestedBy }) {
  requireProvider(database, provider, 'generateAssistantConfiguration'); uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'); uuid(assistantId, 'KNOWLEDGE_ASSISTANT_INVALID'); uuid(recommendationId, 'KNOWLEDGE_RECOMMENDATION_INVALID'); uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID');
  const context = await database.query(
    `SELECT recommendation.recommendation_data, assistant.name AS assistant_name, profile_version.id AS profile_version_id, profile.business_identity_id,
            profile_version.source_scope, profile_version.evidence AS profile_evidence, profile_version.profile_data
       FROM assistant_knowledge_recommendations recommendation
       JOIN ai_assistants assistant ON assistant.id = recommendation.assistant_id AND assistant.tenant_id = recommendation.tenant_id
       JOIN business_profiles profile ON profile.tenant_id = assistant.tenant_id AND profile.active_version_id IS NOT NULL
       JOIN business_profile_versions profile_version ON profile_version.id = profile.active_version_id AND profile_version.tenant_id = profile.tenant_id AND profile_version.status = 'APPROVED'
      WHERE recommendation.id = $1 AND recommendation.tenant_id = $2 AND recommendation.assistant_id = $3 AND recommendation.status = 'APPROVED'`, [recommendationId, tenantId, assistantId]);
  if (!context.rows[0]) throw new KnowledgeAssistantLifecycleError('KNOWLEDGE_CONFIGURATION_CONTEXT_NOT_FOUND', 'An approved recommendation and active Business Profile are required');
  const provenance = { profile_version_id: context.rows[0].profile_version_id, business_identity_id: context.rows[0].business_identity_id, source_scope: context.rows[0].source_scope, recommendation_id: recommendationId, assistant_id: assistantId };
  const sourceHashes = context.rows[0].profile_evidence?.source_hashes ?? context.rows[0].profile_evidence?.sources ?? [];
  provenance.source_hashes = sourceHashes;
  const prompt = [
    'Create Assistant Configuration schema_version 2 for the current tenant from the ACTIVE factual profile and APPROVED AI recommendation only.',
    'Never use SamChe or another tenant as a default. Do not import another tenant identity, service, price, geography, or behavior.',
    'The factual profile is authoritative business evidence; the approved AI recommendation is reviewed proposed behavior. Do not merge unknown recommendations into business facts.',
    `ACTIVE factual profile: ${JSON.stringify(context.rows[0].profile_data)}`,
    `APPROVED AI recommendation: ${JSON.stringify(context.rows[0].recommendation_data)}`,
  ].join('\n');
  const fingerprint = requestFingerprint({ tenant_id: tenantId, assistant_id: assistantId, active_profile_version_id: context.rows[0].profile_version_id, business_identity_id: provenance.business_identity_id, source_scope: provenance.source_scope, source_hashes: sourceHashes, recommendation_id: recommendationId, schema_version: SCHEMA_VERSION, configuration_runtime_contract: CONFIGURATION_RUNTIME_CONTRACT, provider: provider.provider, model: provider.model, generation_policy: provider.assistantGenerationPolicy ?? null });
  const generated = await generate({ database, provider, tenantId, requestedBy, targetType: 'ASSISTANT_CONFIGURATION', prompt, provenance, fingerprint, generationStage: 'CONFIGURATION_GENERATION', sourceCount: provenance.source_scope?.source_ids?.length ?? 0, persist: async (generationDatabase, output, runId) => {
    const configurationData = withRuntimeAssistantIdentity(output, {
      recommendationData: context.rows[0].recommendation_data,
      profileData: context.rows[0].profile_data,
      assistantName: context.rows[0].assistant_name,
    });
    const result = await generationDatabase.query(`INSERT INTO assistant_configuration_versions
      (tenant_id, assistant_id, configuration_data, source_profile_version_id, source_recommendation_id, generation_run_id, schema_version, generated_by, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'AI', 'NEEDS_REVIEW')
      RETURNING id, schema_version, configuration_data, source_profile_version_id, source_recommendation_id, status, created_at`, [tenantId, assistantId, configurationData, context.rows[0].profile_version_id, recommendationId, runId, 2]);
    return result.rows[0];
  } });
  return { configuration: generated.artifact, reused: generated.reused, run_id: generated.run_id };
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
