import crypto from 'node:crypto';
import { KNOWLEDGE_EMBEDDING_CONFIG } from './knowledge-intelligence-service.js';
import {
  KnowledgeSourceIngestionError,
  buildKnowledgeStorageKey,
  hashKnowledgeSource,
  normalizeManualKnowledge,
  validateKnowledgeUpload,
} from './knowledge-source-ingestion-service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class KnowledgeSourceServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function requireUuid(value, code) {
  if (!UUID_PATTERN.test(String(value ?? ''))) {
    throw new KnowledgeSourceServiceError(code, 'Knowledge source identifier is invalid');
  }
  return String(value);
}

function cleanTitle(value, fallback) {
  const title = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 255);
  return title || fallback;
}

function cleanOriginalFilename(value, fallback) {
  const basename = String(value ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  const clean = basename.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 255);
  return clean || fallback;
}

async function query(database, sql, params) {
  if (!database || typeof database.query !== 'function') {
    throw new KnowledgeSourceServiceError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  }
  return database.query(sql, params);
}

function normalizedAssistantIds(assistantIds = []) {
  if (!Array.isArray(assistantIds)) {
    throw new KnowledgeSourceServiceError('KNOWLEDGE_ASSISTANT_ASSIGNMENT_INVALID', 'Assistant assignments are invalid');
  }
  return [...new Set(assistantIds.map((assistantId) => requireUuid(assistantId, 'KNOWLEDGE_ASSISTANT_ASSIGNMENT_INVALID')))];
}

async function verifyAssistants(database, tenantId, assistantIds) {
  if (!assistantIds.length) return;
  const result = await query(database,
    `SELECT id
       FROM ai_assistants
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])`,
    [tenantId, assistantIds]);
  if (result.rows.length !== assistantIds.length) {
    throw new KnowledgeSourceServiceError('KNOWLEDGE_ASSISTANT_NOT_FOUND', 'An assigned Assistant was not found');
  }
}

export async function enqueueKnowledgeIndexJob({
  database,
  tenantId,
  sourceId,
  contentHash,
  metadata = {},
  force = false,
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  requireUuid(sourceId, 'KNOWLEDGE_SOURCE_INVALID');
  if (!/^[a-f0-9]{64}$/i.test(String(contentHash ?? ''))) {
    throw new KnowledgeSourceServiceError('KNOWLEDGE_CONTENT_HASH_INVALID', 'Knowledge content hash is invalid');
  }

  const result = await query(database,
    `INSERT INTO knowledge_processing_jobs (
       tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version, status, metadata
     ) VALUES ($1, $2, 'INDEX_SOURCE', $3, $4, $5, 'PENDING', $6::jsonb)
     ON CONFLICT (tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version)
     DO UPDATE SET
       status = CASE
         WHEN knowledge_processing_jobs.status = 'PROCESSING' THEN knowledge_processing_jobs.status
         WHEN $7 THEN 'PENDING'
         WHEN knowledge_processing_jobs.status = 'READY' THEN knowledge_processing_jobs.status
         ELSE 'PENDING'
       END,
       available_at = CASE
         WHEN knowledge_processing_jobs.status = 'PROCESSING' THEN knowledge_processing_jobs.available_at
         WHEN $7 THEN CURRENT_TIMESTAMP
         WHEN knowledge_processing_jobs.status = 'READY' THEN knowledge_processing_jobs.available_at
         ELSE CURRENT_TIMESTAMP
       END,
       updated_at = CURRENT_TIMESTAMP,
       last_error_code = CASE
         WHEN knowledge_processing_jobs.status = 'PROCESSING' THEN knowledge_processing_jobs.last_error_code
         WHEN $7 THEN NULL
         WHEN knowledge_processing_jobs.status = 'READY' THEN knowledge_processing_jobs.last_error_code
         ELSE NULL
       END
     RETURNING id, status`,
    [
      tenantId,
      sourceId,
      String(contentHash).toLowerCase(),
      KNOWLEDGE_EMBEDDING_CONFIG.model,
      KNOWLEDGE_EMBEDDING_CONFIG.version,
      JSON.stringify(metadata),
      force === true,
    ]);

  return result.rows[0];
}

async function insertAssignments(database, tenantId, sourceId, assistantIds) {
  if (!assistantIds.length) return;
  await query(database,
    `INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
     SELECT $1, $2, unnest($3::uuid[])
     ON CONFLICT (tenant_id, source_id, assistant_id) DO NOTHING`,
    [tenantId, sourceId, assistantIds]);
}

export async function createUploadedKnowledgeSource({
  database,
  storage,
  tenantId,
  uploadedBy,
  title,
  file,
  assistantIds = [],
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  if (uploadedBy) requireUuid(uploadedBy, 'KNOWLEDGE_UPLOADER_INVALID');
  if (!storage || typeof storage.put !== 'function') {
    throw new KnowledgeSourceServiceError('KNOWLEDGE_STORAGE_UNAVAILABLE', 'Knowledge source storage is unavailable');
  }

  const upload = validateKnowledgeUpload(file);
  const assignments = normalizedAssistantIds(assistantIds);
  await verifyAssistants(database, tenantId, assignments);

  const sourceId = crypto.randomUUID();
  const contentHash = hashKnowledgeSource(upload.buffer);
  const storageKey = buildKnowledgeStorageKey({ tenantId, sourceId, contentHash, extension: upload.extension });
  const sourceTitle = cleanTitle(title, cleanOriginalFilename(file?.originalname, 'Knowledge document'));
  const originalFilename = cleanOriginalFilename(file?.originalname, `knowledge-source.${upload.extension}`);

  await storage.put({ key: storageKey, body: upload.buffer, mimeType: upload.mimeType });
  try {
    const result = await query(database,
      `INSERT INTO knowledge_base_documents (
         id, tenant_id, assistant_id, title, content, status, source_type,
         original_filename, mime_type, size_bytes, storage_key, content_hash,
         processing_status, indexing_status, enabled, uploaded_by
       ) VALUES (
         $1, $2, NULL, $3, '', 'active', 'DOCUMENT',
         $4, $5, $6, $7, $8,
         'UPLOADED', 'PENDING', TRUE, $9
       )
       RETURNING id, tenant_id, processing_status, indexing_status`,
      [sourceId, tenantId, sourceTitle, originalFilename, upload.mimeType, upload.sizeBytes, storageKey, contentHash, uploadedBy ?? null]);

    await insertAssignments(database, tenantId, sourceId, assignments);
    await enqueueKnowledgeIndexJob({
      database,
      tenantId,
      sourceId,
      contentHash,
      metadata: { sourceType: 'DOCUMENT' },
    });

    return {
      id: result.rows[0].id,
      tenantId: result.rows[0].tenant_id,
      processingStatus: result.rows[0].processing_status,
      indexingStatus: result.rows[0].indexing_status,
    };
  } catch (error) {
    try {
      await storage.remove?.({ key: storageKey });
    } catch {
      // The source record was not created; storage cleanup is best effort only.
    }
    throw error;
  }
}

export async function createManualKnowledgeSource({
  database,
  tenantId,
  uploadedBy,
  title,
  content,
  assistantIds = [],
  sourceType = 'MANUAL',
}) {
  requireUuid(tenantId, 'KNOWLEDGE_TENANT_INVALID');
  if (uploadedBy) requireUuid(uploadedBy, 'KNOWLEDGE_UPLOADER_INVALID');
  if (!['MANUAL', 'CONVERSATION_CANDIDATE'].includes(sourceType)) {
    throw new KnowledgeSourceServiceError('KNOWLEDGE_SOURCE_TYPE_INVALID', 'Knowledge source type is invalid');
  }

  const normalizedContent = normalizeManualKnowledge(content);
  const assignments = normalizedAssistantIds(assistantIds);
  await verifyAssistants(database, tenantId, assignments);

  const sourceId = crypto.randomUUID();
  const contentHash = hashKnowledgeSource(Buffer.from(normalizedContent, 'utf8'));
  const result = await query(database,
    `INSERT INTO knowledge_base_documents (
       id, tenant_id, assistant_id, title, content, status, source_type,
       content_hash, processing_status, indexing_status, enabled, uploaded_by
     ) VALUES (
       $1, $2, NULL, $3, $4, 'active', $5,
       $6, 'UPLOADED', 'PENDING', TRUE, $7
     )
     RETURNING id, tenant_id, processing_status, indexing_status`,
    [sourceId, tenantId, cleanTitle(title, 'Knowledge entry'), normalizedContent, sourceType, contentHash, uploadedBy ?? null]);

  await insertAssignments(database, tenantId, sourceId, assignments);
  await enqueueKnowledgeIndexJob({
    database,
    tenantId,
    sourceId,
    contentHash,
    metadata: { sourceType },
  });

  return {
    id: result.rows[0].id,
    tenantId: result.rows[0].tenant_id,
    processingStatus: result.rows[0].processing_status,
    indexingStatus: result.rows[0].indexing_status,
  };
}

export { KnowledgeSourceIngestionError };
