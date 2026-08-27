import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_TYPES = new Set(['BUSINESS_PROFILE', 'RECOMMENDATION', 'ASSISTANT_CONFIGURATION']);
const PROVIDERS = new Set(['GEMINI', 'OPENAI']);
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

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

export async function beginKnowledgeGenerationRun({ database, tenantId, requestedBy, targetType, provider, model, prompt, provenance }) {
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
       (tenant_id, requested_by, target_type, provider, model, prompt_hash, input_provenance, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'RUNNING')
     RETURNING id, status`,
    [uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), uuid(requestedBy, 'KNOWLEDGE_REQUESTER_INVALID'), normalizedTarget, normalizedProvider, normalizedModel, hash(normalizedPrompt), provenance],
  );
  return result.rows[0];
}

export async function completeKnowledgeGenerationRun({ database, tenantId, runId, targetId, output }) {
  const result = await databaseQuery(database)(
    `UPDATE knowledge_generation_runs
        SET status = 'SUCCEEDED', target_id = $3, output_hash = $4, completed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND status = 'RUNNING'
      RETURNING id, status, target_id`,
    [uuid(runId, 'KNOWLEDGE_GENERATION_RUN_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), uuid(targetId, 'KNOWLEDGE_GENERATION_TARGET_INVALID'), hash(JSON.stringify(output))],
  );
  if (!result.rows[0]) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_RUN_NOT_RUNNING', 'Knowledge generation run is not running');
  return result.rows[0];
}

export async function failKnowledgeGenerationRun({ database, tenantId, runId, errorCode }) {
  const safeCode = String(errorCode ?? '').toUpperCase();
  if (!SAFE_ERROR_CODE.test(safeCode)) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_ERROR_CODE_INVALID', 'Knowledge generation error code is invalid');
  const result = await databaseQuery(database)(
    `UPDATE knowledge_generation_runs
        SET status = 'FAILED', error_code = $3, completed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2 AND status = 'RUNNING'
      RETURNING id, status`,
    [uuid(runId, 'KNOWLEDGE_GENERATION_RUN_INVALID'), uuid(tenantId, 'KNOWLEDGE_TENANT_INVALID'), safeCode],
  );
  if (!result.rows[0]) throw new KnowledgeGenerationPersistenceError('KNOWLEDGE_GENERATION_RUN_NOT_RUNNING', 'Knowledge generation run is not running');
  return result.rows[0];
}
