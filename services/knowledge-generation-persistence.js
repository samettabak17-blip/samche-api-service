import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_TYPES = new Set(['BUSINESS_PROFILE', 'RECOMMENDATION', 'ASSISTANT_CONFIGURATION']);
const PROVIDERS = new Set(['GEMINI', 'OPENAI']);
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const STAGES = new Set(['IDENTITY_ANALYSIS', 'PROFILE_GENERATION', 'PERSISTENCE']);

export class KnowledgeGenerationPersistenceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function uuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) throw new KnowledgeGenerationPersistenceError(code, 'Knowledge generation identifier is invalid');
  return String(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function databaseQuery(database) {
  if (!database?.query) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  return database.query.bind(database);
}

function optionalUuid(value, code) {
  return value == null ? null : uuid(value, code);
}

function boundedInteger(value, code) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new KnowledgeGenerationPersistenceError(code, 'Knowledge generation metric is invalid');
  return value;
}

function stage(value) {
  if (value == null) return null;
  const normalized = String(value).toUpperCase();
  if (!STAGES.has(normalized)) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_STAGE_INVALID', 'Knowledge generation stage is invalid');
  return normalized;
}

function fingerprint(value) {
  if (value == null) return null;
  const normalized = String(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_FINGERPRINT_INVALID', 'Knowledge generation fingerprint is invalid');
  return normalized;
}

export async function beginKnowledgeGenerationRun({ database, tenantId, requestedBy, targetType, provider, model, prompt, provenance, businessIdentityId = null, requestFingerprint = null, stage: runStage = null, promptCharacterCount = null, sourceCount = null }) {
  const query = databaseQuery(database);
  const normalizedTarget = String(targetType ?? '').toUpperCase();
  const normalizedProvider = String(provider ?? '').toUpperCase();
  const normalizedModel = String(model ?? '').trim();
  const normalizedPrompt = String(prompt ?? '').trim();
  if (!TARGET_TYPES.has(normalizedTarget) || !PROVIDERS.has(normalizedProvider) || !normalizedModel || !normalizedPrompt) {
    throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_RUN_INVALID', 'Knowledge generation run is invalid');
  }
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_PROVENANCE_INVALID', 'Knowledge generation provenance is invalid');
  }
  const result = await query(
    `INSERT INTO knowledge_generation_runs
       (tenant_id, requested_by, target_type, provider, model, prompt_hash, input_provenance, status,
        business_identity_id, request_fingerprint, stage, prompt_character_count, source_count, elapsed_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'RUNNING', $8, $9, $10, $11, $12, 0)
     RETURNING id, status, stage`,
    [uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID'), normalizedTarget, normalizedProvider, normalizedModel, hash(normalizedPrompt), provenance,
      optionalUuid(businessIdentityId, 'KNOWLEDGE_BUSINESS_IDENTITY_INVALID'), fingerprint(requestFingerprint), stage(runStage),
      boundedInteger(promptCharacterCount, 'KNOWLEDGE_GENERATION_PROMPT_SIZE_INVALID'), boundedInteger(sourceCount, 'KNOWLEDGE_GENERATION_SOURCE_COUNT_INVALID')],
  );
  return result.rows[0];
}

export async function advanceKnowledgeGenerationRun({ database, tenantId, runId, stage: runStage, promptCharacterCount, sourceCount, elapsedMs }) {
  const result = await databaseQuery(database)(
    `UPDATE knowledge_generation_runs
        SET stage = $3, prompt_character_count = $4, source_count = $5, elapsed_ms = $6
      WHERE id = $1 AND tenant_id = $2 AND status = 'RUNNING'
      RETURNING id, status, stage`,
    [uuid(runId, 'KNOWLEDGE_GENERATION_RUN_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), stage(runStage),
      boundedInteger(promptCharacterCount, 'KNOWLEDGE_GENERATION_PROMPT_SIZE_INVALID'), boundedInteger(sourceCount, 'KNOWLEDGE_GENERATION_SOURCE_COUNT_INVALID'), boundedInteger(elapsedMs, 'KNOWLEDGE_GENERATION_ELAPSED_INVALID')],
  );
  if (!result.rows[0]) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_RUN_NOT_RUNNING', 'Knowledge generation run is not running');
  return result.rows[0];
}

export async function completeKnowledgeGenerationRun({ database, tenantId, runId, targetId, output, elapsedMs = null }) {
  const result = await databaseQuery(database)(
    `UPDATE knowledge_generation_runs
        SET status = 'SUCCEEDED', target_id = $3, output_hash = $4, elapsed_ms = COALESCE($5, elapsed_ms), completed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND status = 'RUNNING'
      RETURNING id, status, target_id`,
    [uuid(runId, 'KNOWLEDGE_GENERATION_RUN_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), uuid(targetId, 'KNOWLEDGE_GENERATION_TARGET_INVALID'), hash(JSON.stringify(output)), boundedInteger(elapsedMs, 'KNOWLEDGE_GENERATION_ELAPSED_INVALID')],
  );
  if (!result.rows[0]) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_RUN_NOT_RUNNING', 'Knowledge generation run is not running');
  return result.rows[0];
}

export async function failKnowledgeGenerationRun({ database, tenantId, runId, errorCode, stage: runStage = null, elapsedMs = null }) {
  const safeCode = String(errorCode ?? '').toUpperCase();
  if (!SAFE_ERROR_CODE.test(safeCode)) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_ERROR_CODE_INVALID', 'Knowledge generation error code is invalid');
  const result = await databaseQuery(database)(
    `UPDATE knowledge_generation_runs
        SET status = 'FAILED', error_code = $3, stage = COALESCE($4, stage), elapsed_ms = COALESCE($5, elapsed_ms), completed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND status = 'RUNNING'
      RETURNING id, status`,
    [uuid(runId, 'KNOWLEDGE_GENERATION_RUN_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), safeCode, stage(runStage), boundedInteger(elapsedMs, 'KNOWLEDGE_GENERATION_ELAPSED_INVALID')],
  );
  if (!result.rows[0]) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_RUN_NOT_RUNNING', 'Knowledge generation run is not running');
  return result.rows[0];
}
