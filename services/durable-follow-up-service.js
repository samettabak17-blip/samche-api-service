async function defaultDatabase() { return (await import('../config/db.js')).default; }

export async function scheduleContextualFollowUp({
  database = null, tenantId, conversationId, assistantId, channelId, stage, dueAt, idempotencyKey,
} = {}) {
  const result = await (database ?? await defaultDatabase()).query(
    `INSERT INTO conversation_scheduled_jobs
       (tenant_id, conversation_id, assistant_id, channel_id, job_type, stage, due_at, status, idempotency_key)
     VALUES ($1, $2, $3, $4, 'CONTEXTUAL_FOLLOW_UP', $5, $6, 'PENDING', $7)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [tenantId, conversationId, assistantId, channelId, stage, dueAt, idempotencyKey],
  );
  return { scheduled: result.rowCount === 1, id: result.rows[0]?.id ?? null };
}

export async function claimDueContextualFollowUps({ database = null, now = new Date() } = {}) {
  const client = await (database ?? await defaultDatabase()).connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT j.*, m.content AS generated_content, m.external_message_id AS generated_external_message_id
         FROM conversation_scheduled_jobs j
         JOIN conversations c ON c.id = j.conversation_id AND c.tenant_id = j.tenant_id
         LEFT JOIN conversation_messages m ON m.id = j.generated_message_id
           AND m.tenant_id = j.tenant_id AND m.conversation_id = j.conversation_id
        WHERE j.job_type = 'CONTEXTUAL_FOLLOW_UP'
          AND (j.status IN ('PENDING', 'RETRY')
            OR (j.status = 'PROCESSING' AND j.processing_started_at <= CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
          AND j.due_at <= $1
          AND c.status = 'open'
          AND c.handling_mode = 'AI'
          AND c.human_attention_state NOT IN ('REQUESTED', 'ACKNOWLEDGED')
        ORDER BY j.due_at ASC
        FOR UPDATE OF j SKIP LOCKED`,
      [now],
    );
    for (const job of due.rows) {
      await client.query(
        `UPDATE conversation_scheduled_jobs
            SET status = 'PROCESSING', processing_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2`,
        [job.id, job.tenant_id],
      );
    }
    await client.query('COMMIT');
    return due.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Executes the durable portion of a contextual follow-up. Context, provider
 * and channel adapters remain injected so the worker keeps the tenant/channel
 * boundary explicit and testable. A persisted canonical message is reused on
 * delivery retry; the provider is never asked to generate another follow-up.
 */
export async function processDueContextualFollowUps({
  database = null,
  now = new Date(),
  resolveContext,
  generate,
  persistCanonical,
  deliver,
} = {}) {
  if (typeof resolveContext !== 'function' || typeof generate !== 'function'
    || typeof persistCanonical !== 'function' || typeof deliver !== 'function') {
    throw new TypeError('FOLLOW_UP_WORKER_DEPENDENCY_MISSING');
  }
  const db = database ?? await defaultDatabase();
  const jobs = await claimDueContextualFollowUps({ database: db, now });
  const result = { completed: 0, retried: 0, cancelled: 0 };

  for (const job of jobs) {
    try {
      const context = await resolveContext(job);
      if (!context) {
        await db.query(
          `UPDATE conversation_scheduled_jobs
              SET status = 'CANCELLED', processing_started_at = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND tenant_id = $2 AND status = 'PROCESSING'`,
          [job.id, job.tenant_id],
        );
        result.cancelled += 1;
        continue;
      }

      let message = job.generated_message_id && job.generated_content
        ? { id: job.generated_message_id, content: job.generated_content }
        : null;
      const idempotencyKey = `contextual-follow-up:${job.id}`;
      if (!message) {
        const content = String(await generate({ job, context, prompt: context.prompt }) ?? '').trim();
        if (!content) throw new Error('FOLLOW_UP_GENERATION_EMPTY');
        message = await persistCanonical({ job, context, content, idempotencyKey });
        if (!message?.id) throw new Error('FOLLOW_UP_PERSISTENCE_FAILED');
        await db.query(
          `UPDATE conversation_scheduled_jobs
              SET generated_message_id = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND tenant_id = $3 AND status = 'PROCESSING'`,
          [message.id, job.id, job.tenant_id],
        );
      }

      const outcome = await deliver({ job, context, message, content: message.content, idempotencyKey });
      if (!outcome?.delivered) throw new Error('FOLLOW_UP_DELIVERY_FAILED');
      await db.query(
        `UPDATE conversation_scheduled_jobs
            SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP, processing_started_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2 AND status = 'PROCESSING'`,
        [job.id, job.tenant_id],
      );
      result.completed += 1;
    } catch {
      await db.query(
        `UPDATE conversation_scheduled_jobs
            SET status = 'RETRY', processing_started_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2 AND status = 'PROCESSING'`,
        [job.id, job.tenant_id],
      );
      result.retried += 1;
    }
  }
  return result;
}
