import { createImageKnowledgeCandidates } from './knowledge-candidate-service.js';

const HASH = /^[a-f0-9]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_DIAGNOSTIC_TEXT = /^[A-Za-z0-9_.-]+$/;

export class KnowledgeSemanticGenerationJobError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function safeDiagnosticText(value, maxLength) {
  const normalized = String(value ?? '').trim().slice(0, maxLength);
  return SAFE_DIAGNOSTIC_TEXT.test(normalized) ? normalized : null;
}

function safeDatabaseCode(error) {
  const code = safeDiagnosticText(error?.code, 16);
  return /^[0-9A-Z]{2,16}$/i.test(code ?? '') ? code : null;
}

function safeInternalErrorCode(error) {
  return safeDiagnosticText(error?.internalCode, 80)
    ?? (String(error?.code ?? '').startsWith('KNOWLEDGE_') ? safeDiagnosticText(error.code, 80) : null);
}

export async function recordAssistantRecommendationEnqueueFailureDiagnostic({
  database,
  requestId,
  tenantId,
  assistantId,
  businessProfileVersionId,
  phase,
  error,
}) {
  if (!database?.query
    || !UUID.test(String(requestId))
    || !UUID.test(String(tenantId))
    || !UUID.test(String(assistantId))
    || !UUID.test(String(businessProfileVersionId))) return null;

  const payload = {
    request_id: String(requestId),
    tenant_id: String(tenantId),
    assistant_id: String(assistantId),
    business_profile_version_id: String(businessProfileVersionId),
    phase: safeDiagnosticText(phase, 48) ?? 'UNKNOWN',
    database_code: safeDatabaseCode(error),
    constraint_name: safeDiagnosticText(error?.constraint, 128),
    entity_name: safeDiagnosticText(error?.table, 128),
    internal_error_code: safeInternalErrorCode(error),
  };
  const result = await database.query(
    `INSERT INTO knowledge_assistant_recommendation_enqueue_failure_diagnostics
       (request_id, tenant_id, assistant_id, business_profile_version_id, phase,
        database_code, constraint_name, entity_name, internal_error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      payload.request_id,
      payload.tenant_id,
      payload.assistant_id,
      payload.business_profile_version_id,
      payload.phase,
      payload.database_code,
      payload.constraint_name,
      payload.entity_name,
      payload.internal_error_code,
    ],
  );
  console.error('KNOWLEDGE_ASSISTANT_RECOMMENDATION_ENQUEUE_FAILURE', JSON.stringify(payload));
  return result.rows?.[0] ?? null;
}

function safeAssistantRecommendationJob(job) {
  if (!job) return job;
  const metadata = job.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  return {
    ...job,
    metadata: {
      ...(metadata.recommendation_id ? { recommendation_id: metadata.recommendation_id } : {}),
      ...(metadata.recommendation_status ? { recommendation_status: metadata.recommendation_status } : {}),
      ...(metadata.business_profile_version_id ? { business_profile_version_id: metadata.business_profile_version_id } : {}),
    },
  };
}

function validate({ database, tenantId, sourceId, extractionHash }) {
  if (!database?.query) throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  if (!tenantId || !sourceId || !HASH.test(String(extractionHash ?? ''))) {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_IMAGE_GENERATION_INVALID', 'Image generation request is invalid');
  }
}

export async function enqueueImageSemanticGenerationJob({ database, tenantId, sourceId, extractionHash }) {
  validate({ database, tenantId, sourceId, extractionHash });
  const result = await database.query(
    `INSERT INTO knowledge_processing_jobs (
       tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version, status, metadata
     ) VALUES ($1, $2, 'GENERATE_IMAGE_CANDIDATES', $3, 'IMAGE_SEMANTIC', '2', 'PENDING', '{"generation":"IMAGE_SEMANTIC"}'::jsonb)
     ON CONFLICT (tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version)
     DO UPDATE SET
       status = CASE WHEN knowledge_processing_jobs.status = 'PROCESSING' THEN 'PROCESSING'
                     WHEN knowledge_processing_jobs.status = 'READY' THEN 'PENDING'
                     ELSE 'PENDING' END,
       available_at = CASE WHEN knowledge_processing_jobs.status = 'PROCESSING' THEN knowledge_processing_jobs.available_at ELSE CURRENT_TIMESTAMP END,
       last_error_code = CASE WHEN knowledge_processing_jobs.status = 'PROCESSING' THEN knowledge_processing_jobs.last_error_code ELSE NULL END,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, tenant_id, source_id, job_type, status, attempts, available_at, last_error_code, metadata, created_at, updated_at`,
    [tenantId, sourceId, String(extractionHash).toLowerCase()],
  );
  return result.rows[0];
}

export async function getImageSemanticGenerationJob({ database, tenantId, sourceId }) {
  if (!database?.query) throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  const result = await database.query(
    `SELECT id, tenant_id, source_id, job_type, status, attempts, available_at, last_error_code, metadata, created_at, updated_at
       FROM knowledge_processing_jobs
      WHERE tenant_id = $1 AND source_id = $2 AND job_type = 'GENERATE_IMAGE_CANDIDATES'
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, sourceId],
  );
  return result.rows[0] ?? null;
}

export async function enqueueAssistantRecommendationGenerationJob({ database, tenantId, assistantId, businessProfileVersionId, requestedBy, fingerprint, providerPolicy }) {
  if (!database?.query || !UUID.test(String(tenantId)) || !UUID.test(String(assistantId)) || !UUID.test(String(businessProfileVersionId)) || !UUID.test(String(requestedBy)) || !HASH.test(String(fingerprint))) {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_ASSISTANT_RECOMMENDATION_JOB_INVALID', 'Assistant Recommendation generation request is invalid');
  }
  const metadata = {
    assistant_id: String(assistantId),
    business_profile_version_id: String(businessProfileVersionId),
    requested_by: String(requestedBy),
    request_fingerprint: String(fingerprint).toLowerCase(),
    provider_policy: typeof providerPolicy === 'string' ? providerPolicy.slice(0, 160) : null,
  };
  const result = await database.query(
    `INSERT INTO knowledge_processing_jobs (
       tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version, status, metadata
     ) VALUES ($1, NULL, 'GENERATE_ASSISTANT_RECOMMENDATION', $2, 'ASSISTANT_RECOMMENDATION', '1', 'PENDING', $3::jsonb)
     ON CONFLICT (tenant_id, job_type, content_hash, embedding_model, embedding_version)
       WHERE job_type = 'GENERATE_ASSISTANT_RECOMMENDATION'
     DO UPDATE SET
       status = CASE WHEN knowledge_processing_jobs.status IN ('PENDING', 'PROCESSING', 'READY') THEN knowledge_processing_jobs.status ELSE 'PENDING' END,
       available_at = CASE WHEN knowledge_processing_jobs.status IN ('PENDING', 'PROCESSING', 'READY') THEN knowledge_processing_jobs.available_at ELSE CURRENT_TIMESTAMP END,
       last_error_code = CASE WHEN knowledge_processing_jobs.status IN ('PENDING', 'PROCESSING', 'READY') THEN knowledge_processing_jobs.last_error_code ELSE NULL END,
       metadata = knowledge_processing_jobs.metadata || EXCLUDED.metadata,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, tenant_id, job_type, status, attempts, available_at, last_error_code, metadata, created_at, updated_at`,
    [tenantId, String(fingerprint).toLowerCase(), JSON.stringify(metadata)],
  );
  return safeAssistantRecommendationJob(result.rows[0]);
}

export async function getAssistantRecommendationGenerationJob({ database, tenantId, assistantId, jobId }) {
  if (!database?.query || !UUID.test(String(tenantId)) || !UUID.test(String(assistantId)) || !UUID.test(String(jobId))) {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_ASSISTANT_RECOMMENDATION_JOB_INVALID', 'Assistant Recommendation generation job is invalid');
  }
  const result = await database.query(
    `SELECT id, tenant_id, job_type, status, attempts, available_at, last_error_code, metadata, created_at, updated_at
       FROM knowledge_processing_jobs
      WHERE id = $1 AND tenant_id = $2 AND job_type = 'GENERATE_ASSISTANT_RECOMMENDATION'
        AND metadata->>'assistant_id' = $3`,
    [jobId, tenantId, assistantId],
  );
  return result.rows[0] ? safeAssistantRecommendationJob(result.rows[0]) : null;
}

function safeAssistantConfigurationJob(job) {
  if (!job) return job;
  const metadata = job.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  return {
    ...job,
    metadata: {
      ...(metadata.configuration_id ? { configuration_id: metadata.configuration_id } : {}),
      ...(metadata.configuration_status ? { configuration_status: metadata.configuration_status } : {}),
      ...(metadata.recommendation_id ? { recommendation_id: metadata.recommendation_id } : {}),
      ...(metadata.business_profile_version_id ? { business_profile_version_id: metadata.business_profile_version_id } : {}),
    },
  };
}

export async function enqueueAssistantConfigurationGenerationJob({ database, tenantId, assistantId, recommendationId, businessProfileVersionId, requestedBy, fingerprint, providerPolicy }) {
  if (!database?.query || !UUID.test(String(tenantId)) || !UUID.test(String(assistantId))
    || !UUID.test(String(recommendationId)) || !UUID.test(String(businessProfileVersionId))
    || !UUID.test(String(requestedBy)) || !HASH.test(String(fingerprint))) {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_ASSISTANT_CONFIGURATION_JOB_INVALID', 'Assistant Configuration generation request is invalid');
  }
  const metadata = {
    assistant_id: String(assistantId),
    recommendation_id: String(recommendationId),
    business_profile_version_id: String(businessProfileVersionId),
    requested_by: String(requestedBy),
    request_fingerprint: String(fingerprint).toLowerCase(),
    provider_policy: typeof providerPolicy === 'string' ? providerPolicy.slice(0, 160) : null,
  };
  const result = await database.query(
    `INSERT INTO knowledge_processing_jobs (
       tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version, status, metadata
     ) VALUES ($1, NULL, 'GENERATE_ASSISTANT_CONFIGURATION', $2, 'ASSISTANT_CONFIGURATION', '1', 'PENDING', $3::jsonb)
     ON CONFLICT (tenant_id, job_type, content_hash, embedding_model, embedding_version)
       WHERE job_type = 'GENERATE_ASSISTANT_CONFIGURATION'
     DO UPDATE SET
       status = CASE WHEN knowledge_processing_jobs.status IN ('PENDING', 'PROCESSING', 'READY') THEN knowledge_processing_jobs.status ELSE 'PENDING' END,
       available_at = CASE WHEN knowledge_processing_jobs.status IN ('PENDING', 'PROCESSING', 'READY') THEN knowledge_processing_jobs.available_at ELSE CURRENT_TIMESTAMP END,
       last_error_code = CASE WHEN knowledge_processing_jobs.status IN ('PENDING', 'PROCESSING', 'READY') THEN knowledge_processing_jobs.last_error_code ELSE NULL END,
       metadata = knowledge_processing_jobs.metadata || EXCLUDED.metadata,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, tenant_id, job_type, status, attempts, available_at, last_error_code, metadata, created_at, updated_at`,
    [tenantId, String(fingerprint).toLowerCase(), JSON.stringify(metadata)],
  );
  return safeAssistantConfigurationJob(result.rows[0]);
}

export async function getAssistantConfigurationGenerationJob({ database, tenantId, assistantId, jobId }) {
  if (!database?.query || !UUID.test(String(tenantId)) || !UUID.test(String(assistantId)) || !UUID.test(String(jobId))) {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_ASSISTANT_CONFIGURATION_JOB_INVALID', 'Assistant Configuration generation job is invalid');
  }
  const result = await database.query(
    `SELECT id, tenant_id, job_type, status, attempts, available_at, last_error_code, metadata, created_at, updated_at
       FROM knowledge_processing_jobs
      WHERE id = $1 AND tenant_id = $2 AND job_type = 'GENERATE_ASSISTANT_CONFIGURATION'
        AND metadata->>'assistant_id' = $3`,
    [jobId, tenantId, assistantId],
  );
  return result.rows[0] ? safeAssistantConfigurationJob(result.rows[0]) : null;
}

export async function recoverStaleImageSemanticGenerationJobs(database) {
  const processing = await database.query(
    `UPDATE knowledge_processing_jobs
        SET status = CASE
              WHEN COALESCE((metadata->>'stale_recovery_count')::integer, 0) >= 2 THEN 'FAILED'
              ELSE 'PENDING'
            END,
            locked_at = NULL,
            locked_until = NULL,
            available_at = CASE
              WHEN COALESCE((metadata->>'stale_recovery_count')::integer, 0) >= 2 THEN available_at
              ELSE CURRENT_TIMESTAMP
            END,
            last_error_code = 'KNOWLEDGE_SEMANTIC_LEASE_EXPIRED',
            metadata = jsonb_set(
              metadata,
              '{stale_recovery_count}',
              to_jsonb(COALESCE((metadata->>'stale_recovery_count')::integer, 0) + 1),
              TRUE
            ),
            updated_at = CURRENT_TIMESTAMP
      WHERE job_type = 'GENERATE_IMAGE_CANDIDATES'
        AND status = 'PROCESSING'
        AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
      RETURNING id, status`,
  );
  // Compatibility recovery for jobs terminally failed by the former lease
  // policy before it recorded bounded stale-recovery metadata. This is generic
  // and one-time: modern jobs carry stale_recovery_count and remain terminal
  // after the bounded lease-recovery limit.
  const legacy = await database.query(
    `UPDATE knowledge_processing_jobs
        SET status = 'PENDING',
            available_at = CURRENT_TIMESTAMP,
            last_error_code = NULL,
            metadata = metadata || '{"legacy_lease_recovery":true}'::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE job_type = 'GENERATE_IMAGE_CANDIDATES'
        AND status = 'FAILED'
        AND last_error_code = 'KNOWLEDGE_SEMANTIC_LEASE_EXPIRED'
        AND COALESCE((metadata->>'stale_recovery_count')::integer, 0) = 0
        AND COALESCE((metadata->>'legacy_lease_recovery')::boolean, FALSE) = FALSE
      RETURNING id, status`,
  );
  // Older deployments used the generic 20-second provider budget for a
  // structured image classification. Give each such historical terminal job
  // one retry under the bounded semantic-specific provider policy.
  const semanticTimeout = await database.query(
    `UPDATE knowledge_processing_jobs
        SET status = 'PENDING',
            available_at = CURRENT_TIMESTAMP,
            last_error_code = NULL,
            metadata = metadata || '{"semantic_timeout_recovery":true}'::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE job_type = 'GENERATE_IMAGE_CANDIDATES'
        AND embedding_model = 'IMAGE_SEMANTIC'
        AND status = 'FAILED'
        AND last_error_code = 'KNOWLEDGE_GENERATION_TIMEOUT'
        AND COALESCE((metadata->>'semantic_timeout_recovery')::boolean, FALSE) = FALSE
      RETURNING id, status`,
  );
  // The first bounded-timeout retry still used Gemini's default reasoning
  // mode. Requeue those legacy rows exactly once under the lower-latency
  // structured semantic contract; normal failures remain terminal/retryable
  // according to the worker's bounded attempt policy.
  const semanticThinkingLow = await database.query(
    `UPDATE knowledge_processing_jobs
        SET status = 'PENDING',
            available_at = CURRENT_TIMESTAMP,
            last_error_code = NULL,
            metadata = metadata || '{"semantic_thinking_low_recovery":true}'::jsonb,
            updated_at = CURRENT_TIMESTAMP
      WHERE job_type = 'GENERATE_IMAGE_CANDIDATES'
        AND embedding_model = 'IMAGE_SEMANTIC'
        AND status = 'FAILED'
        AND last_error_code = 'KNOWLEDGE_GENERATION_TIMEOUT'
        AND COALESCE((metadata->>'semantic_timeout_recovery')::boolean, FALSE) = TRUE
        AND COALESCE((metadata->>'semantic_thinking_low_recovery')::boolean, FALSE) = FALSE
      RETURNING id, status`,
  );
  const result = { rows: [...(processing.rows ?? []), ...(legacy.rows ?? []), ...(semanticTimeout.rows ?? []), ...(semanticThinkingLow.rows ?? [])] };
  return {
    recovered: result.rows.filter((job) => job.status === 'PENDING').length,
    failed: result.rows.filter((job) => job.status === 'FAILED').length,
  };
}

export async function claimNextImageSemanticGenerationJob(database) {
  const result = await database.query(
    `WITH candidate AS (
       SELECT id FROM knowledge_processing_jobs
        WHERE job_type = 'GENERATE_IMAGE_CANDIDATES' AND status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE knowledge_processing_jobs job
          SET status = 'PROCESSING', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP,
              locked_until = CURRENT_TIMESTAMP + INTERVAL '5 minutes', updated_at = CURRENT_TIMESTAMP
         FROM candidate WHERE job.id = candidate.id RETURNING job.*`,
  );
  return result.rows[0] ?? null;
}

export async function recoverStaleAssistantRecommendationGenerationJobs(database) {
  const result = await database.query(
    `UPDATE knowledge_processing_jobs
        SET status = CASE WHEN COALESCE((metadata->>'stale_recovery_count')::integer, 0) >= 2 THEN 'FAILED' ELSE 'PENDING' END,
            locked_at = NULL,
            locked_until = NULL,
            available_at = CASE WHEN COALESCE((metadata->>'stale_recovery_count')::integer, 0) >= 2 THEN available_at ELSE CURRENT_TIMESTAMP END,
            last_error_code = 'KNOWLEDGE_ASSISTANT_RECOMMENDATION_LEASE_EXPIRED',
            metadata = jsonb_set(metadata, '{stale_recovery_count}', to_jsonb(COALESCE((metadata->>'stale_recovery_count')::integer, 0) + 1), TRUE),
            updated_at = CURRENT_TIMESTAMP
      WHERE job_type = 'GENERATE_ASSISTANT_RECOMMENDATION'
        AND status = 'PROCESSING'
        AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
      RETURNING id, status`,
  );
  return {
    recovered: (result.rows ?? []).filter((job) => job.status === 'PENDING').length,
    failed: (result.rows ?? []).filter((job) => job.status === 'FAILED').length,
  };
}

export async function claimNextAssistantRecommendationGenerationJob(database) {
  const result = await database.query(
    `WITH candidate AS (
       SELECT id FROM knowledge_processing_jobs
        WHERE job_type = 'GENERATE_ASSISTANT_RECOMMENDATION' AND status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE knowledge_processing_jobs job
          SET status = 'PROCESSING', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP,
              locked_until = CURRENT_TIMESTAMP + INTERVAL '5 minutes', updated_at = CURRENT_TIMESTAMP
         FROM candidate WHERE job.id = candidate.id RETURNING job.*`,
  );
  return result.rows[0] ?? null;
}

export async function recoverStaleAssistantConfigurationGenerationJobs(database) {
  const result = await database.query(
    `UPDATE knowledge_processing_jobs
        SET status = CASE WHEN COALESCE((metadata->>'stale_recovery_count')::integer, 0) >= 2 THEN 'FAILED' ELSE 'PENDING' END,
            locked_at = NULL,
            locked_until = NULL,
            available_at = CASE WHEN COALESCE((metadata->>'stale_recovery_count')::integer, 0) >= 2 THEN available_at ELSE CURRENT_TIMESTAMP END,
            last_error_code = 'KNOWLEDGE_ASSISTANT_CONFIGURATION_LEASE_EXPIRED',
            metadata = jsonb_set(metadata, '{stale_recovery_count}', to_jsonb(COALESCE((metadata->>'stale_recovery_count')::integer, 0) + 1), TRUE),
            updated_at = CURRENT_TIMESTAMP
      WHERE job_type = 'GENERATE_ASSISTANT_CONFIGURATION'
        AND status = 'PROCESSING'
        AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
      RETURNING id, status`,
  );
  return {
    recovered: (result.rows ?? []).filter((job) => job.status === 'PENDING').length,
    failed: (result.rows ?? []).filter((job) => job.status === 'FAILED').length,
  };
}

export async function claimNextAssistantConfigurationGenerationJob(database) {
  const result = await database.query(
    `WITH candidate AS (
       SELECT id FROM knowledge_processing_jobs
        WHERE job_type = 'GENERATE_ASSISTANT_CONFIGURATION' AND status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE knowledge_processing_jobs job
          SET status = 'PROCESSING', attempts = attempts + 1, locked_at = CURRENT_TIMESTAMP,
              locked_until = CURRENT_TIMESTAMP + INTERVAL '5 minutes', updated_at = CURRENT_TIMESTAMP
         FROM candidate WHERE job.id = candidate.id RETURNING job.*`,
  );
  return result.rows[0] ?? null;
}

function recommendationJobMetadata(job) {
  const metadata = job?.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  const values = ['assistant_id', 'business_profile_version_id', 'requested_by'];
  if (!values.every((key) => UUID.test(String(metadata[key] ?? ''))) || !HASH.test(String(metadata.request_fingerprint ?? ''))) {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_ASSISTANT_RECOMMENDATION_JOB_INVALID', 'Assistant Recommendation job metadata is invalid');
  }
  return metadata;
}

export async function processAssistantRecommendationGenerationJob({ database, job, generateRecommendation }) {
  const metadata = recommendationJobMetadata(job);
  if (typeof generateRecommendation !== 'function') {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_ASSISTANT_RECOMMENDATION_WORKER_CONFIG_INVALID', 'Assistant Recommendation worker is not configured');
  }
  try {
    const result = await generateRecommendation({
      database,
      tenantId: job.tenant_id,
      assistantId: metadata.assistant_id,
      businessProfileVersionId: metadata.business_profile_version_id,
      requestedBy: metadata.requested_by,
      allowInactiveProfileSnapshot: true,
      expectedFingerprint: metadata.request_fingerprint,
    });
    await database.query(
      `UPDATE knowledge_processing_jobs
          SET status = 'READY', locked_at = NULL, locked_until = NULL, last_error_code = NULL,
              metadata = metadata || $3::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [job.id, job.tenant_id, JSON.stringify({ recommendation_id: result.recommendation.id, recommendation_status: result.recommendation.status, reused: result.reused === true })],
    );
    return { status: 'READY', recommendation: result.recommendation, reused: result.reused === true };
  } catch (error) {
    const code = String(error?.code ?? 'KNOWLEDGE_ASSISTANT_RECOMMENDATION_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 80) || 'KNOWLEDGE_ASSISTANT_RECOMMENDATION_FAILED';
    const retry = Number(job.attempts ?? 1) < 3;
    await database.query(
      retry
        ? `UPDATE knowledge_processing_jobs SET status = 'PENDING', locked_at = NULL, locked_until = NULL,
             available_at = CURRENT_TIMESTAMP + INTERVAL '30 seconds', last_error_code = $3::varchar(80), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`
        : `UPDATE knowledge_processing_jobs SET status = 'FAILED', locked_at = NULL, locked_until = NULL,
             last_error_code = $3::varchar(80), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
      [job.id, job.tenant_id, code],
    );
    throw error;
  }
}

function configurationJobMetadata(job) {
  const metadata = job?.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  const values = ['assistant_id', 'recommendation_id', 'business_profile_version_id', 'requested_by'];
  if (!values.every((key) => UUID.test(String(metadata[key] ?? ''))) || !HASH.test(String(metadata.request_fingerprint ?? ''))) {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_ASSISTANT_CONFIGURATION_JOB_INVALID', 'Assistant Configuration job metadata is invalid');
  }
  return metadata;
}

export async function processAssistantConfigurationGenerationJob({ database, job, generateConfiguration }) {
  const metadata = configurationJobMetadata(job);
  if (typeof generateConfiguration !== 'function') {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_ASSISTANT_CONFIGURATION_WORKER_CONFIG_INVALID', 'Assistant Configuration worker is not configured');
  }
  try {
    const result = await generateConfiguration({
      database,
      tenantId: job.tenant_id,
      assistantId: metadata.assistant_id,
      recommendationId: metadata.recommendation_id,
      businessProfileVersionId: metadata.business_profile_version_id,
      requestedBy: metadata.requested_by,
      allowInactiveProfileSnapshot: true,
      expectedFingerprint: metadata.request_fingerprint,
    });
    await database.query(
      `UPDATE knowledge_processing_jobs
          SET status = 'READY', locked_at = NULL, locked_until = NULL, last_error_code = NULL,
              metadata = metadata || $3::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [job.id, job.tenant_id, JSON.stringify({ configuration_id: result.configuration.id, configuration_status: result.configuration.status, reused: result.reused === true })],
    );
    return { status: 'READY', configuration: result.configuration, reused: result.reused === true };
  } catch (error) {
    const code = String(error?.code ?? 'KNOWLEDGE_ASSISTANT_CONFIGURATION_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 80) || 'KNOWLEDGE_ASSISTANT_CONFIGURATION_FAILED';
    const retry = Number(job.attempts ?? 1) < 3;
    await database.query(
      retry
        ? `UPDATE knowledge_processing_jobs SET status = 'PENDING', locked_at = NULL, locked_until = NULL,
             available_at = CURRENT_TIMESTAMP + INTERVAL '30 seconds', last_error_code = $3::varchar(80), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`
        : `UPDATE knowledge_processing_jobs SET status = 'FAILED', locked_at = NULL, locked_until = NULL,
             last_error_code = $3::varchar(80), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
      [job.id, job.tenant_id, code],
    );
    throw error;
  }
}

export async function processImageSemanticGenerationJob({ database, job, semanticClassifier, createCandidates = createImageKnowledgeCandidates }) {
  try {
    const candidates = await createCandidates({
      database, tenantId: job.tenant_id, sourceId: job.source_id, extractionHash: job.content_hash,
      semanticClassifier,
    });
    const behavior = candidates.behavior_recommendations ?? [];
    const warnings = candidates.warnings ?? [];
    await database.query(
      `UPDATE knowledge_processing_jobs SET status = 'READY', locked_at = NULL, locked_until = NULL,
          last_error_code = NULL, metadata = metadata || $3::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [job.id, job.tenant_id, JSON.stringify({ candidate_count: candidates.length, behavior_recommendation_count: behavior.length, warnings })],
    );
    return { status: 'READY', candidateCount: candidates.length, behaviorRecommendationCount: behavior.length, warnings };
  } catch (error) {
    const code = String(error?.code ?? 'KNOWLEDGE_IMAGE_GENERATION_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 80);
    const retry = Number(job.attempts ?? 1) < 3;
    await database.query(
      retry
        ? `UPDATE knowledge_processing_jobs SET status = 'PENDING', locked_at = NULL, locked_until = NULL,
             available_at = CURRENT_TIMESTAMP + INTERVAL '30 seconds',
             last_error_code = $3::varchar(80), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`
        : `UPDATE knowledge_processing_jobs SET status = 'FAILED', locked_at = NULL, locked_until = NULL,
             last_error_code = $3::varchar(80), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
      [job.id, job.tenant_id, code || 'KNOWLEDGE_IMAGE_GENERATION_FAILED'],
    );
    throw error;
  }
}

export function startImageSemanticGenerationWorker({ database, semanticClassifier, generateRecommendation = null, generateConfiguration = null, intervalMs = 2_000, logger = console }) {
  if (!database?.query || typeof semanticClassifier?.classify !== 'function') {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_SEMANTIC_WORKER_CONFIG_INVALID', 'Semantic generation worker is not configured');
  }
  let stopped = false;
  let running = false;
  let lastTickAt = null;
  let lastClaimedAt = null;
  let lastCompletedAt = null;
  let lastFailureAt = null;
  let lastFailureCode = null;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    lastTickAt = new Date().toISOString();
    try {
      await recoverStaleImageSemanticGenerationJobs(database);
      await recoverStaleAssistantRecommendationGenerationJobs(database);
      await recoverStaleAssistantConfigurationGenerationJobs(database);
      const job = await claimNextImageSemanticGenerationJob(database);
      if (job) {
        lastClaimedAt = new Date().toISOString();
        await processImageSemanticGenerationJob({ database, job, semanticClassifier });
        lastCompletedAt = new Date().toISOString();
        lastFailureCode = null;
      } else {
        let handled = false;
        if (typeof generateRecommendation === 'function') {
        const recommendationJob = await claimNextAssistantRecommendationGenerationJob(database);
        if (recommendationJob) {
          lastClaimedAt = new Date().toISOString();
          await processAssistantRecommendationGenerationJob({ database, job: recommendationJob, generateRecommendation });
          lastCompletedAt = new Date().toISOString();
          lastFailureCode = null;
          handled = true;
        }
        }
        if (!handled && typeof generateConfiguration === 'function') {
        const configurationJob = await claimNextAssistantConfigurationGenerationJob(database);
        if (configurationJob) {
          lastClaimedAt = new Date().toISOString();
          await processAssistantConfigurationGenerationJob({ database, job: configurationJob, generateConfiguration });
          lastCompletedAt = new Date().toISOString();
          lastFailureCode = null;
        }
        }
      }
    } catch (error) {
      lastFailureAt = new Date().toISOString();
      lastFailureCode = String(error?.code ?? 'KNOWLEDGE_SEMANTIC_GENERATION_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 80);
      logger.error('KNOWLEDGE_SEMANTIC_GENERATION_WORKER_FAILED', String(error?.code ?? 'UNKNOWN'));
    } finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  const stop = () => { stopped = true; clearInterval(timer); };
  stop.status = () => ({
    state: stopped ? 'STOPPED' : running ? 'PROCESSING' : 'RUNNING',
    last_tick_at: lastTickAt,
    last_claimed_at: lastClaimedAt,
    last_completed_at: lastCompletedAt,
    last_failure_at: lastFailureAt,
    last_failure_code: lastFailureCode,
  });
  return stop;
}
