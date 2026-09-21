import {
  claimNextVisualAiGenerationJob,
  failVisualAiGenerationJob,
  processVisualAiGenerationJob,
  recoverStaleVisualAiGenerationJobs,
} from './visual-ai-job-service.js';
import { VisualAIProviderError } from './visual-ai-provider-adapter.js';
import {
  formatVisualAiReadyMessage,
  normalizeVisualAiLanguage,
} from './visual-intelligence-intent-service.js';

const OUTPUT_KEY_PREFIX = 'visual-ai-output:';

async function readStorage(storage, key) {
  const value = await storage.get({ key });
  if (Buffer.isBuffer(value)) return value;
  const chunks = [];
  for await (const chunk of value) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function processOneVisualAiGenerationJob({ database, storage, visualProvider, deliverWhatsAppMedia }) {
  await recoverStaleVisualAiGenerationJobs(database);
  const job = await claimNextVisualAiGenerationJob(database);
  if (!job) return { processed: false };
  try {
    const ownership = await database.query(
      `SELECT status, handling_mode FROM conversations WHERE id = $1 AND tenant_id = $2`,
      [job.conversation_id, job.tenant_id]
    );
    if (ownership.rowCount !== 1 || ownership.rows[0].status !== 'open' || ownership.rows[0].handling_mode !== 'AI') {
      await database.query(
        `UPDATE visual_ai_generation_jobs
            SET status = 'CANCELLED', delivery_status = 'NOT_REQUIRED', last_error_code = 'VISUAL_AI_HUMAN_OWNERSHIP_SUPPRESSED',
                locked_at = NULL, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2 AND status = 'PROCESSING'`,
        [job.id, job.tenant_id]
      );
      return { processed: true, status: 'CANCELLED', jobId: job.id };
    }
    const capabilities = visualProvider?.getCapabilities?.() || {};
    if (!capabilities.imageConditionedGeneration) {
      await database.query(
        `UPDATE visual_ai_generation_jobs SET status = 'FAILED', last_error_code = 'VISUAL_AI_CAPABILITY_UNSUPPORTED', locked_at = NULL, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 AND status = 'PROCESSING'`,
        [job.id, job.tenant_id]
      );
      return { processed: true, status: 'FAILED', jobId: job.id };
    }
    const output = job.generated_resource_id
      ? { job, resource: (await database.query(`SELECT * FROM conversation_resources WHERE id = $1 AND tenant_id = $2 AND conversation_id = $3`, [job.generated_resource_id, job.tenant_id, job.conversation_id])).rows[0] }
      : await processVisualAiGenerationJob({ database, storage, job, visualProvider });
    const resource = output.resource;
    if (!resource) throw new VisualAIProviderError('VISUAL_AI_OUTPUT_RESOURCE_MISSING', 'Generated output resource is unavailable.');

    const route = await database.query(
      `SELECT c.customer_external_id, tc.external_channel_id, ci.config, c.communication_language
         FROM conversations c JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
         LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.enabled = TRUE
        WHERE c.id = $1 AND c.tenant_id = $2 AND tc.channel_type = 'WHATSAPP'`, [job.conversation_id, job.tenant_id]);
    const delivery = route.rows[0];
    if (!delivery) throw new VisualAIProviderError('WHATSAPP_DELIVERY_UNAVAILABLE', 'WhatsApp delivery is unavailable.', { retryable: true });

    const language = normalizeVisualAiLanguage(job.grounding_context?.language || delivery?.communication_language || 'en');
    const readyContent = formatVisualAiReadyMessage(language);

    const messageResult = await database.query(
      `INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content, idempotency_key)
       VALUES ($1, $2, 'ASSISTANT', $3, $4)
       ON CONFLICT (conversation_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET content = conversation_messages.content
       RETURNING *`,
      [job.tenant_id, job.conversation_id, readyContent, `${OUTPUT_KEY_PREFIX}${job.id}`]
    );
    const message = messageResult.rows[0];
    await database.query(`UPDATE conversation_resources SET message_id = $1 WHERE id = $2 AND tenant_id = $3 AND conversation_id = $4 AND message_id IS NULL`, [message.id, resource.id, job.tenant_id, job.conversation_id]);
    await database.query(`UPDATE visual_ai_generation_jobs SET output_message_id = COALESCE(output_message_id, $1) WHERE id = $2 AND tenant_id = $3 AND status = 'PROCESSING'`, [message.id, job.id, job.tenant_id]);
    const current = await database.query(`SELECT provider_message_id FROM visual_ai_generation_jobs WHERE id = $1 AND tenant_id = $2`, [job.id, job.tenant_id]);
    if (!current.rows[0]?.provider_message_id) {
      const bytes = await readStorage(storage, resource.storage_key);
      const sent = await deliverWhatsAppMedia({ phoneNumberId: delivery.external_channel_id, recipient: delivery.customer_external_id, integrationConfig: delivery.config, mediaCategory: 'IMAGE', caption: message.content, idempotencyKey: `visual-ai-output:${job.id}`, file: { buffer: bytes, mimetype: resource.mime_type, originalname: resource.original_filename } });
      if (!sent?.providerMessageId) throw new VisualAIProviderError('WHATSAPP_MEDIA_SEND_UNCORRELATED', 'WhatsApp delivery did not return a durable provider correlation.', { retryable: true });
      await database.query(`UPDATE visual_ai_generation_jobs SET provider_message_id = $1, delivery_status = 'SENT' WHERE id = $2 AND tenant_id = $3 AND provider_message_id IS NULL AND status = 'PROCESSING'`, [sent.providerMessageId, job.id, job.tenant_id]);
    }
    await database.query(`UPDATE visual_ai_generation_jobs SET status = 'COMPLETED', delivery_status = 'SENT', locked_at = NULL, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 AND status = 'PROCESSING'`, [job.id, job.tenant_id]);
    return { processed: true, status: 'COMPLETED', jobId: job.id, resourceId: resource.id, messageId: message.id };
  } catch (error) {
    // Infrastructure failures (including an interrupted database write) are
    // retried. Explicit provider, validation, safety, and delivery boundary
    // classifications retain their declared retryability.
    await failVisualAiGenerationJob({
      database,
      tenantId: job.tenant_id,
      jobId: job.id,
      error,
      retryable: typeof error?.retryable === 'boolean' ? error.retryable : true,
      maxAttempts: job.max_attempts || 2,
    });
    throw error;
  }
}
