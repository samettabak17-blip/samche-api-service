import { extractDocumentText } from './conversation-document-extraction-service.js';
import { indexKnowledgeSource } from './knowledge-intelligence-service.js';
import { validateImageKnowledgeExtraction } from './image-knowledge-extraction.js';

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

async function markJob(database, job, status, errorCode = null, metadataPatch = null) {
  await dbQuery(database,
    `UPDATE knowledge_processing_jobs
        SET status = $3,
            locked_at = NULL,
            locked_until = NULL,
            last_error_code = $4,
            metadata = CASE WHEN $5::jsonb IS NULL THEN metadata ELSE metadata || $5::jsonb END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND tenant_id = $2`,
    [job.id, job.tenant_id, status, errorCode, metadataPatch ? JSON.stringify(metadataPatch) : null]);
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

async function withTransaction(database, work) {
  if (!database || typeof database.connect !== 'function') {
    throw new KnowledgeSourceProcessingError('KNOWLEDGE_DATABASE_TRANSACTION_UNAVAILABLE', 'Knowledge transaction is unavailable');
  }
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

export async function persistImageExtractionSegments({ database, source, job, extraction }) {
  return withTransaction(database, async (client) => {
    await client.query(
      `UPDATE knowledge_base_documents
          SET content = $3,
              extraction_hash = $4,
              extraction_method = $5,
              extracted_at = CURRENT_TIMESTAMP,
              processed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [source.id, source.tenant_id, extraction.text, extraction.sourceHash, `IMAGE:${extraction.extractionMethod}`.slice(0, 32)]);

    await client.query(
      `DELETE FROM knowledge_source_extraction_segments
        WHERE tenant_id = $1 AND source_id = $2 AND extraction_hash = $3`,
      [source.tenant_id, source.id, extraction.sourceHash]);
    await client.query(
      `UPDATE knowledge_source_extraction_segments
          SET is_current = FALSE
        WHERE tenant_id = $1 AND source_id = $2 AND is_current = TRUE`,
      [source.tenant_id, source.id]);

    for (const segment of extraction.segments) {
      await client.query(
        `INSERT INTO knowledge_source_extraction_segments (
           tenant_id, source_id, extraction_version, extraction_hash, segment_order,
           role, role_confidence, normalized_text, extraction_method, source_locator, is_current
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, TRUE)`,
        [source.tenant_id, source.id, extraction.extractionVersion, extraction.sourceHash, segment.order,
          segment.role, segment.confidence, segment.text, extraction.extractionMethod,
          segment.sourceLocator === undefined ? null : JSON.stringify(segment.sourceLocator)]);
    }

    await client.query(
      `UPDATE knowledge_processing_jobs
          SET status = 'READY',
              locked_at = NULL,
              locked_until = NULL,
              last_error_code = NULL,
              metadata = metadata || $3::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [job.id, job.tenant_id, JSON.stringify({
        extractionVersion: extraction.extractionVersion,
        extractionMethod: extraction.extractionMethod,
        extractionConfidence: extraction.extractionConfidence,
        segmentCount: extraction.segments.length,
        segmentRoles: [...new Set(extraction.segments.map(({ role }) => role))],
      })]);
    return { segmentCount: extraction.segments.length };
  });
}

export async function processKnowledgeProcessingJob({
  database,
  storage,
  createStorage = null,
  job,
  embed,
  extract = extractDocumentText,
  imageExtractor = null,
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
              indexing_status = CASE WHEN mime_type IN ('image/jpeg', 'image/png') THEN 'DISABLED' ELSE 'INDEXING' END,
              processing_error_code = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [source.id, source.tenant_id]);

    let text = source.content;
    let extractionMethod = 'MANUAL';
    let extractionMetadata = null;

    if (source.source_type === 'DOCUMENT') {
      const sourceStorage = storage ?? createStorage?.();
      if (!sourceStorage || typeof sourceStorage.get !== 'function' || !source.storage_key || !source.mime_type) {
        throw new KnowledgeSourceProcessingError('KNOWLEDGE_SOURCE_STORAGE_UNAVAILABLE', 'Knowledge source storage is unavailable');
      }
      const bytes = await streamToBuffer(await sourceStorage.get({ key: source.storage_key }));
      if (source.mime_type === 'image/jpeg' || source.mime_type === 'image/png') {
        if (!imageExtractor || typeof imageExtractor.extract !== 'function') {
          throw new KnowledgeSourceProcessingError('KNOWLEDGE_IMAGE_EXTRACTOR_UNAVAILABLE', 'Image extraction is unavailable');
        }
        const extracted = validateImageKnowledgeExtraction(await imageExtractor.extract({
          mimeType: source.mime_type,
          bytes,
          contentHash: source.content_hash,
        }));
        if (extracted.sourceHash !== String(source.content_hash ?? '').toLowerCase() || extracted.mimeType !== source.mime_type) {
          throw new KnowledgeSourceProcessingError('KNOWLEDGE_IMAGE_EXTRACTION_PROVENANCE_MISMATCH', 'Image extraction provenance is invalid');
        }
        text = extracted.text;
        extractionMethod = `IMAGE:${extracted.extractionMethod}`.slice(0, 32);
        extractionMetadata = {
          extractionVersion: extracted.extractionVersion,
          extractionMethod: extracted.extractionMethod,
        extractionConfidence: extracted.extractionConfidence,
        segmentCount: extracted.segments.length,
        segmentRoles: [...new Set(extracted.segments.map(({ role }) => role))],
          segments: extracted.segments,
        };
      } else {
        const extracted = await extract({
          mimeType: source.mime_type,
          bytes,
          contentHash: source.content_hash,
        });
        text = extracted.extractedText;
        extractionMethod = extracted.method;
      }
    }

    if (!String(text ?? '').trim()) {
      throw new KnowledgeSourceProcessingError('KNOWLEDGE_SOURCE_EMPTY', 'Knowledge source does not contain readable text');
    }

    if (source.mime_type === 'image/jpeg' || source.mime_type === 'image/png') {
      const persisted = await persistImageExtractionSegments({ database, source, job, extraction: {
        ...extractionMetadata,
        text,
        sourceHash: String(source.content_hash ?? '').toLowerCase(),
      } });
      return { status: 'READY', chunkCount: 0, indexed: false, segmentCount: persisted.segmentCount };
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

export function startKnowledgeProcessingWorker({
  database,
  embed,
  imageExtractor = null,
  createStorage,
  intervalMs = 2_000,
  logger = console,
}) {
  if (!database?.query || typeof createStorage !== 'function' || (typeof embed !== 'function' && typeof imageExtractor?.extract !== 'function')) {
    throw new KnowledgeSourceProcessingError('KNOWLEDGE_WORKER_CONFIG_INVALID', 'Knowledge processing worker is not configured');
  }

  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const job = await claimNextKnowledgeProcessingJob(database);
      if (job) {
        await processKnowledgeProcessingJob({
          database,
          embed,
          imageExtractor,
          job,
          createStorage,
        });
      }
    } catch (error) {
      logger.error('KNOWLEDGE_PROCESSING_WORKER_FAILED', safeErrorCode(error));
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
