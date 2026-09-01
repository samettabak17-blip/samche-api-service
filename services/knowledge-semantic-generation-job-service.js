import { createImageKnowledgeCandidates } from './knowledge-candidate-service.js';

const HASH = /^[a-f0-9]{64}$/i;

export class KnowledgeSemanticGenerationJobError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
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
      `UPDATE knowledge_processing_jobs SET status = $3, locked_at = NULL, locked_until = NULL,
          available_at = CASE WHEN $3 = 'PENDING' THEN CURRENT_TIMESTAMP + INTERVAL '30 seconds' ELSE available_at END,
          last_error_code = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
      [job.id, job.tenant_id, retry ? 'PENDING' : 'FAILED', code || 'KNOWLEDGE_IMAGE_GENERATION_FAILED'],
    );
    throw error;
  }
}

export function startImageSemanticGenerationWorker({ database, semanticClassifier, intervalMs = 2_000, logger = console }) {
  if (!database?.query || typeof semanticClassifier?.classify !== 'function') {
    throw new KnowledgeSemanticGenerationJobError('KNOWLEDGE_SEMANTIC_WORKER_CONFIG_INVALID', 'Semantic generation worker is not configured');
  }
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const job = await claimNextImageSemanticGenerationJob(database);
      if (job) await processImageSemanticGenerationJob({ database, job, semanticClassifier });
    } catch (error) {
      logger.error('KNOWLEDGE_SEMANTIC_GENERATION_WORKER_FAILED', String(error?.code ?? 'UNKNOWN'));
    } finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
