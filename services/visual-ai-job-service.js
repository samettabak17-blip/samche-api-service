import crypto from 'node:crypto';
import { createConversationResource } from './conversation-resource-service.js';
import { buildConversationStorageKey } from './conversation-resource-validation.js';
import { classifyVisualAIError } from './visual-ai-provider-adapter.js';
import { buildGroundedVisualInstruction } from './visual-intelligence-intent-service.js';
import { resolveApprovedVisualReference } from './knowledge-entity-service.js';
import {
  UUID_REGEX,
  VisualAiJobError,
  computeVisualAiIdempotencyKey,
  getTenantVisualAiConfig,
  upsertTenantVisualAiConfig,
  assertTenantVisualAiEntitlement,
} from './visual-ai-config-service.js';

export {
  VisualAiJobError,
  computeVisualAiIdempotencyKey,
  getTenantVisualAiConfig,
  upsertTenantVisualAiConfig,
  assertTenantVisualAiEntitlement,
};

async function assertCatalogTargetRole({ database, tenantId, conversationId, targetResourceId, groundingContext }) {
  const roleCheck = await database.query(
    `SELECT source_type, media_category, processing_status FROM conversation_resources WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`,
    [targetResourceId, tenantId, conversationId]
  );
  const target = roleCheck.rows[0];
  if (target?.media_category !== 'IMAGE' || target?.processing_status !== 'READY') {
    throw new VisualAiJobError('CUSTOMER_TARGET_REQUIRED', 'A ready visual target is required.');
  }
  if (target.source_type !== 'VISUAL_AI_GENERATED') {
    if (groundingContext.resourceRoles?.target === 'GENERATED_OUTPUT') {
      throw new VisualAiJobError('CUSTOMER_TARGET_REQUIRED', 'Target resource role does not match its provenance.');
    }
    return;
  }
  const originalId = groundingContext.originalCustomerTargetResourceId;
  if (groundingContext.resourceRoles?.target !== 'GENERATED_OUTPUT' || !UUID_REGEX.test(String(originalId || ''))) {
    throw new VisualAiJobError('CUSTOMER_TARGET_REQUIRED', 'Generated output cannot replace the customer target image.');
  }
  const prior = await database.query(
    `SELECT target_resource_id, grounding_context FROM visual_ai_generation_jobs
      WHERE tenant_id = $1 AND conversation_id = $2 AND generated_resource_id = $3
        AND status = 'COMPLETED' LIMIT 1`,
    [tenantId, conversationId, targetResourceId]
  );
  const original = await database.query(
    `SELECT source_type, media_category, processing_status FROM conversation_resources
      WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`,
    [originalId, tenantId, conversationId]
  );
  const priorOriginalId = prior.rows[0]?.grounding_context?.originalCustomerTargetResourceId
    || prior.rows[0]?.target_resource_id;
  if (priorOriginalId !== originalId || !original.rows[0]
    || original.rows[0].source_type === 'VISUAL_AI_GENERATED'
    || original.rows[0].media_category !== 'IMAGE'
    || original.rows[0].processing_status !== 'READY') {
    throw new VisualAiJobError('CUSTOMER_TARGET_REQUIRED', 'Generated edit lacks a valid prior customer target.');
  }
}

export async function enqueueVisualAiGenerationJob({
  database,
  tenantId,
  conversationId,
  messageId = null,
  targetResourceId,
  referenceResourceId = null,
  referenceUrl = null,
  promptInstruction,
  groundingContext = {},
  idempotencyKey = null,
  provider = 'MOCK',
  model = 'mock-visual-v1',
  maxAttempts = 2,
}) {
  if (!database?.query) throw new VisualAiJobError('DATABASE_UNAVAILABLE', 'Database is unavailable.');
  if (!UUID_REGEX.test(String(tenantId || '')) || !UUID_REGEX.test(String(conversationId || '')) || !UUID_REGEX.test(String(targetResourceId || ''))) {
    throw new VisualAiJobError('INVALID_IDENTIFIER', 'Valid tenant, conversation, and target resource UUIDs are required.');
  }

  const instruction = String(promptInstruction || '').trim();
  if (!instruction) throw new VisualAiJobError('INSTRUCTION_REQUIRED', 'A natural language visual instruction is required.');

  await assertTenantVisualAiEntitlement({ database, tenantId });

  const targetCheck = await database.query(
    `SELECT id, mime_type, storage_key FROM conversation_resources WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`,
    [targetResourceId, tenantId, conversationId]
  );
  if (targetCheck.rowCount === 0) {
    throw new VisualAiJobError('TARGET_RESOURCE_NOT_FOUND', 'Target resource not found or unauthorized for this tenant conversation.');
  }
  if (groundingContext.catalogRequested) {
    const catalog = groundingContext.catalog;
    const reference = await resolveApprovedVisualReference({
      database, tenantId, assistantId: groundingContext.assistantId || null,
      entityId: catalog?.entityId, mediaIds: catalog?.mediaIds,
    });
    if (!reference || !groundingContext.assistantId) {
      throw new VisualAiJobError('APPROVED_CATALOG_REFERENCE_REQUIRED', 'An approved catalog entity and reference image are required.');
    }
    await assertCatalogTargetRole({ database, tenantId, conversationId, targetResourceId, groundingContext });
  }

  if (referenceResourceId) {
    const refCheck = await database.query(
      `SELECT id, mime_type, storage_key FROM conversation_resources WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`,
      [referenceResourceId, tenantId, conversationId]
    );
    if (refCheck.rowCount === 0) {
      throw new VisualAiJobError('REFERENCE_RESOURCE_NOT_FOUND', 'Reference resource not found or unauthorized for this tenant conversation.');
    }
  }

  const resolvedIdempotencyKey = idempotencyKey || computeVisualAiIdempotencyKey({
    tenantId, conversationId, targetResourceId, referenceResourceId, referenceUrl, promptInstruction: instruction,
  });

  const result = await database.query(
    `INSERT INTO visual_ai_generation_jobs (
       tenant_id, conversation_id, message_id, target_resource_id, reference_resource_id,
       reference_url, prompt_instruction, grounding_context, provider, model,
       max_attempts, idempotency_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
     ON CONFLICT (tenant_id, idempotency_key)
     DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, conversationId, messageId, targetResourceId, referenceResourceId, referenceUrl, instruction, JSON.stringify(groundingContext), provider, model, maxAttempts, resolvedIdempotencyKey]
  );
  return result.rows[0];
}

export async function claimNextVisualAiGenerationJob(database, { leaseDurationSeconds = 300 } = {}) {
  if (!database?.query) throw new VisualAiJobError('DATABASE_UNAVAILABLE', 'Database is unavailable.');
  const result = await database.query(
    `WITH candidate AS (
       SELECT id FROM visual_ai_generation_jobs
        WHERE status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP
        ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE visual_ai_generation_jobs job
          SET status = 'PROCESSING', attempts = job.attempts + 1, locked_at = CURRENT_TIMESTAMP,
              locked_until = CURRENT_TIMESTAMP + ($1 || ' seconds')::interval, updated_at = CURRENT_TIMESTAMP
         FROM candidate WHERE job.id = candidate.id RETURNING job.*`,
    [leaseDurationSeconds]
  );
  return result.rows[0] ?? null;
}

export async function completeVisualAiGenerationJob({ database, storage, tenantId, jobId, conversationId, result }) {
  if (!database?.query) throw new VisualAiJobError('DATABASE_UNAVAILABLE', 'Database is unavailable.');
  if (!UUID_REGEX.test(String(tenantId || '')) || !UUID_REGEX.test(String(jobId || '')) || !UUID_REGEX.test(String(conversationId || ''))) {
    throw new VisualAiJobError('INVALID_IDENTIFIER', 'Valid tenant, job, and conversation UUIDs are required.');
  }
  if (!result || !Buffer.isBuffer(result.imageBuffer)) {
    throw new VisualAiJobError('INVALID_RESULT_PAYLOAD', 'Valid image generation result buffer is required.');
  }

  // The job is the durable output authority. Reusing its UUID as the generated
  // resource identifier makes a retry after a process crash converge on the
  // same storage object and row instead of allocating a second customer-visible
  // image.
  const generatedResourceId = jobId;
  const storageKey = buildConversationStorageKey({ tenantId, conversationId, resourceId: generatedResourceId });

  if (storage && typeof storage.put === 'function') {
    await storage.put({ key: storageKey, body: result.imageBuffer, mimeType: result.mimeType || 'image/png' });
  }

  const contentHash = crypto.createHash('sha256').update(result.imageBuffer).digest('hex');
  const resourceResult = await database.query(
    `INSERT INTO conversation_resources (
       id, tenant_id, conversation_id, message_id, source_type, media_category,
       original_filename, mime_type, size_bytes, storage_key, content_hash,
       metadata, processing_status, processed_at
     ) VALUES ($1, $2, $3, NULL, 'VISUAL_AI_GENERATED', 'IMAGE', $4, $5, $6, $7, $8, $9::jsonb, 'READY', CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE
       SET updated_at = conversation_resources.updated_at
       WHERE conversation_resources.tenant_id = EXCLUDED.tenant_id
         AND conversation_resources.conversation_id = EXCLUDED.conversation_id
         AND conversation_resources.source_type = 'VISUAL_AI_GENERATED'
     RETURNING *`,
    [generatedResourceId, tenantId, conversationId, `visual-concept-${generatedResourceId.slice(0, 8)}.png`, result.mimeType || 'image/png', result.imageBuffer.length, storageKey, contentHash, JSON.stringify({ job_id: jobId, provider: result.provider, model: result.model, provider_request_id: result.providerRequestId || null, cost_metadata: result.costMetadata || {} })]
  );
  const resource = resourceResult.rows[0];
  if (!resource) {
    throw new VisualAiJobError('GENERATED_RESOURCE_ID_CONFLICT', 'Generated resource identity is not safe for this job.');
  }

  const updatedJob = await database.query(
    `UPDATE visual_ai_generation_jobs
        SET generated_resource_id = COALESCE(generated_resource_id, $1), cost_metadata = $2::jsonb,
            last_error_code = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND tenant_id = $4 AND status = 'PROCESSING' RETURNING *`,
    [resource.id, JSON.stringify(result.costMetadata || {}), jobId, tenantId]
  );
  if (!updatedJob.rows[0]) {
    throw new VisualAiJobError('JOB_LEASE_LOST', 'Visual generation job lease is no longer active.');
  }
  return { job: updatedJob.rows[0], resource };
}

export async function failVisualAiGenerationJob({ database, tenantId, jobId, error, retryable = null, maxAttempts = 2, backoffSeconds = 30 }) {
  if (!database?.query || !UUID_REGEX.test(String(tenantId || '')) || !UUID_REGEX.test(String(jobId || ''))) {
    throw new VisualAiJobError('INVALID_IDENTIFIER', 'Valid tenant and job UUIDs are required.');
  }
  const classification = classifyVisualAIError(error);
  const isRetry = typeof retryable === 'boolean'
    ? retryable
    : (typeof error?.retryable === 'boolean' ? error.retryable : classification.retryable);
  const errorCode = classification.code || error?.code || 'VISUAL_AI_ERROR';
  const failureDetails = { message: String(error?.message || error || '').slice(0, 500), code: errorCode, timestamp: new Date().toISOString() };

  const result = await database.query(
    `UPDATE visual_ai_generation_jobs
        SET status = CASE WHEN $1::boolean AND attempts < max_attempts THEN 'PENDING' ELSE 'FAILED' END,
            available_at = CASE WHEN $1::boolean AND attempts < max_attempts THEN CURRENT_TIMESTAMP + ($2 || ' seconds')::interval ELSE available_at END,
            locked_at = NULL, locked_until = NULL, last_error_code = $3, failure_details = $4::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 AND tenant_id = $6 RETURNING *`,
    [isRetry, backoffSeconds, errorCode, JSON.stringify(failureDetails), jobId, tenantId]
  );
  return result.rows[0];
}

export async function recoverStaleVisualAiGenerationJobs(database) {
  if (!database?.query) throw new VisualAiJobError('DATABASE_UNAVAILABLE', 'Database is unavailable.');
  const result = await database.query(
    `UPDATE visual_ai_generation_jobs
        SET status = CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'PENDING' END,
            available_at = CURRENT_TIMESTAMP, locked_at = NULL, locked_until = NULL,
            last_error_code = CASE WHEN attempts >= max_attempts THEN 'VISUAL_AI_LEASE_EXPIRED' ELSE last_error_code END,
            updated_at = CURRENT_TIMESTAMP
      WHERE status = 'PROCESSING' AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
      RETURNING id, status, last_error_code`
  );
  const rows = result.rows || [];
  return { recovered: rows.filter((j) => j.status === 'PENDING').length, failed: rows.filter((j) => j.status === 'FAILED').length };
}

export async function getVisualAiGenerationJob({ database, tenantId, jobId }) {
  if (!database?.query || !UUID_REGEX.test(String(tenantId || '')) || !UUID_REGEX.test(String(jobId || ''))) {
    throw new VisualAiJobError('INVALID_IDENTIFIER', 'Valid tenant and job UUIDs are required.');
  }
  const result = await database.query(`SELECT * FROM visual_ai_generation_jobs WHERE id = $1 AND tenant_id = $2`, [jobId, tenantId]);
  return result.rows[0] ?? null;
}

export async function processVisualAiGenerationJob({ database, storage, job, visualProvider }) {
  if (!job || !job.id || !job.tenant_id) throw new VisualAiJobError('INVALID_JOB', 'A valid claimed visual AI job is required.');
  try {
    const targetRow = await database.query(
      `SELECT id, storage_key, mime_type, original_filename FROM conversation_resources WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`,
      [job.target_resource_id, job.tenant_id, job.conversation_id]
    );
    if (targetRow.rowCount === 0) throw new VisualAiJobError('TARGET_RESOURCE_NOT_FOUND', 'Target resource is unavailable.');
    let catalogReference = null;
    if (job.grounding_context?.catalogRequested) {
      catalogReference = await resolveApprovedVisualReference({
        database, tenantId: job.tenant_id,
        assistantId: job.grounding_context.assistantId,
        entityId: job.grounding_context.catalog?.entityId,
        mediaIds: job.grounding_context.catalog?.mediaIds,
      });
      if (!catalogReference || !job.grounding_context.assistantId) {
        throw new VisualAiJobError('APPROVED_CATALOG_REFERENCE_REQUIRED', 'Approved catalog reference is unavailable.');
      }
      await assertCatalogTargetRole({ database, tenantId: job.tenant_id, conversationId: job.conversation_id,
        targetResourceId: job.target_resource_id, groundingContext: job.grounding_context });
      if (!storage || typeof storage.get !== 'function' || !targetRow.rows[0].storage_key) {
        throw new VisualAiJobError('CUSTOMER_TARGET_UNAVAILABLE', 'Customer target image storage is unavailable.');
      }
    }

    let targetBuffer;
    if (storage && typeof storage.get === 'function' && targetRow.rows[0].storage_key) {
      const stream = await storage.get({ key: targetRow.rows[0].storage_key });
      const chunks = [];
      if (Buffer.isBuffer(stream)) chunks.push(stream);
      else for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      targetBuffer = Buffer.concat(chunks);
    } else {
      targetBuffer = Buffer.from('mock-target-bytes');
    }

    let referenceImage = null;
    if (job.reference_resource_id) {
      const refRow = await database.query(
        `SELECT id, storage_key, mime_type, original_filename FROM conversation_resources WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`,
        [job.reference_resource_id, job.tenant_id, job.conversation_id]
      );
      if (refRow.rowCount > 0 && storage && typeof storage.get === 'function' && refRow.rows[0].storage_key) {
        const stream = await storage.get({ key: refRow.rows[0].storage_key });
        const chunks = [];
        if (Buffer.isBuffer(stream)) chunks.push(stream);
        else for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        referenceImage = { buffer: Buffer.concat(chunks), mimeType: refRow.rows[0].mime_type, originalFilename: refRow.rows[0].original_filename };
      }
    }

    const targetImage = {
      buffer: targetBuffer,
      mimeType: targetRow.rows[0].mime_type || 'image/jpeg',
      originalFilename: targetRow.rows[0].original_filename,
    };
    const referenceImages = referenceImage ? [referenceImage] : [];
    if (catalogReference) {
      if (!storage || typeof storage.get !== 'function') {
        throw new VisualAiJobError('CATALOG_MEDIA_UNAVAILABLE', 'Catalog reference storage is unavailable.');
      }
      for (const media of catalogReference.media) {
        const value = await storage.get({ key: media.storage_key });
        const chunks = [];
        if (Buffer.isBuffer(value)) chunks.push(value);
        else for await (const chunk of value) chunks.push(Buffer.from(chunk));
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) throw new VisualAiJobError('CATALOG_MEDIA_UNAVAILABLE', 'Catalog reference image is empty.');
        referenceImages.push({ buffer, mimeType: media.mime_type, originalFilename: media.original_filename, mediaId: media.id, entityId: catalogReference.entity.id });
      }
    }
    const sourceImages = [targetImage];

    const providerGroundingContext = catalogReference ? {
      ...job.grounding_context,
      entity: {
        id: catalogReference.entity.id,
        name: catalogReference.entity.name,
        type: catalogReference.entity.entity_type,
        description: catalogReference.entity.description,
        attributes: catalogReference.entity.attributes || {},
      },
    } : job.grounding_context;
    const groundedInstruction = buildGroundedVisualInstruction({
      instruction: job.prompt_instruction,
      groundingContext: providerGroundingContext,
    });

    const providerResult = await visualProvider.generateConcept({
      targetImage,
      referenceImage: referenceImages[0] || null,
      sourceImages,
      referenceImages,
      instruction: groundedInstruction,
      groundingContext: providerGroundingContext,
    });

    return await completeVisualAiGenerationJob({ database, storage, tenantId: job.tenant_id, jobId: job.id, conversationId: job.conversation_id, result: providerResult });
  } catch (error) {
    await failVisualAiGenerationJob({ database, tenantId: job.tenant_id, jobId: job.id, error, maxAttempts: job.max_attempts || 2 });
    throw error;
  }
}
