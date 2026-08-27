import { extractDocumentText } from './conversation-document-extraction-service.js';
import { indexKnowledgeSource } from './knowledge-intelligence-service.js';

export class KnowledgeSourceProcessingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function safeErrorCode(error) {
  const code = String(error?.code ?? 'KNOWLEDGE_PROCESSING_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 80);
  return code || 'KNOWLEDGE_PROCESSING_FAILED';
}

async function dbQuery(database, sql, params = []) {
  if (!database || typeof database.query !== 'function') {
    throw new KnowledgeSourceProcessingError('KNOWLEDGE_DATABASE_UNAVAILABLE', 'Knowledge database is unavailable');
  }
  return database.query(sql, params);
}

export async function streamToBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body?.transformToByteArray) return Buffer.from(await body.transformToByteArray());
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
    throw new KnowledgeSourceProcessingError('KNOWLEDGE_STORAGE_BODY_INVALID', 'Knowledge source storage response is invalid');
  }

  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function claimNextKnowledgeProcessingJob(database) {
  const result = await dbQuery(database,
    `WITH candidate AS (
       SELECT id
         FROM knowledge_processing_jobs
        WHERE status = 'PENDING'
          AND available_at <= CURRENT_TIMESTAMP
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     UPDATE knowledge_processing_jobs job
        SET status = 'PROCESSING',
            attempts = attempts + 1,
            locked_at = CURRENT_TIMESTAMP,
            locked_until = CURRENT_TIMESTAMP + INTERVAL '5 minutes',
            updated_at = CURRENT_TIMESTAMP
       FROM candidate
      WHERE job.id = candidate.id
     RETURNING job.*`);
  return result.rows[0] ?? null;
}

async function markJob(database, job, status, errorCode = null) {
  await dbQuery(database,
    `UPDATE knowledge_processing_jobs
        SET status = $3,
            locked_at = NULL,
            locked_until = NULL,
            last_error_code = $4,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2`,
    [job.id, job.tenant_id, status, errorCode]);
}

async function sourceForJob(database, job) {
  const result = await dbQuery(database,
    `SELECT id, tenant_id, source_type, content, mime_type, storage_key, content_hash,
            enabled, status, processing_status, indexing_status
       FROM knowledge_base_documents
      WHERE id = $1
        AND tenant_id = $2
      FOR UPDATE`,
    [job.source_id, job.tenant_id]);
  return result.rows[0] ?? null;
}

export async function processKnowledgeProcessingJob({
  database,
  storage,
  job,
  embed,
  extract = extractDocumentText,
  index = indexKnowledgeSource,
}) {
  if (!job?.id || !job?.tenant_id || !job?.source_id) {
    throw new KnowledgeSourceProcessingError('KNOWLEDGE_JOB_INVALID', 'Knowledge processing job is invalid');
  }

  const source = await sourceForJob(database, job);
  if (!source || !source.enabled || source.status !== 'active') {
    await markJob(database, job, 'CANCELLED');
    return { status: 'CANCELLED' };
  }

  try {
    await dbQuery(database,
      `UPDATE knowledge_base_documents
          SET processing_status = 'PROCESSING',
              indexing_status = 'INDEXING',
              processing_error_code = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [source.id, source.tenant_id]);

    let text = source.content;
    let extractionMethod = 'MANUAL';

    if (source.source_type === 'DOCUMENT') {
      if (!storage || typeof storage.get !== 'function' || !source.storage_key || !source.mime_type) {
        throw new KnowledgeSourceProcessingError('KNOWLEDGE_SOURCE_STORAGE_UNAVAILABLE', 'Knowledge source storage is unavailable');
      }
      const bytes = await streamToBuffer(await storage.get({ key: source.storage_key }));
      const extracted = await extract({
        mimeType: source.mime_type,
        bytes,
        contentHash: source.content_hash,
      });
      text = extracted.extractedText;
      extractionMethod = extracted.method;
    }

    if (!String(text ?? '').trim()) {
      throw new KnowledgeSourceProcessingError('KNOWLEDGE_SOURCE_EMPTY', 'Knowledge source does not contain readable text');
    }

    await dbQuery(database,
      `UPDATE knowledge_base_documents
          SET content = $3,
              extraction_hash = $4,
              extraction_method = $5,
              extracted_at = CURRENT_TIMESTAMP,
              processed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [source.id, source.tenant_id, text, source.content_hash, extractionMethod]);

    const indexed = await index({
      database,
      embed,
      tenantId: source.tenant_id,
      sourceId: source.id,
      text,
    });

    await markJob(database, job, 'READY');
    return { status: 'READY', chunkCount: indexed.chunkCount };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    await dbQuery(database,
      `UPDATE knowledge_base_documents
          SET processing_status = 'FAILED',
              indexing_status = 'FAILED',
              processing_error_code = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [job.source_id, job.tenant_id, errorCode]);
    await markJob(database, job, 'FAILED', errorCode);
    throw error;
  }
}

export async function runOneKnowledgeProcessingJob(dependencies) {
  const job = await claimNextKnowledgeProcessingJob(dependencies.database);
  if (!job) return { status: 'IDLE' };
  return processKnowledgeProcessingJob({ ...dependencies, job });
}
