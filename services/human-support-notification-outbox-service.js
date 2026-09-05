async function defaultDatabase() { return (await import('../config/db.js')).default; }

export async function processHumanSupportNotificationOutbox({ database = null, deliver, resolveRecipients = null, now = new Date() } = {}) {
  const client = await (database ?? await defaultDatabase()).connect();
  const result = { delivered: 0, retried: 0, failed: 0 };
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      `SELECT o.id, o.tenant_id, o.conversation_id, o.level_order, l.recipient_rule, l.recipient_target
         FROM human_support_notification_outbox o
         JOIN human_support_escalations e ON e.id = o.escalation_id AND e.tenant_id = o.tenant_id
         LEFT JOIN human_support_escalation_levels l ON l.tenant_id = o.tenant_id AND l.policy_id = e.policy_id AND l.level_order = o.level_order
        WHERE (o.status IN ('PENDING', 'RETRY') OR (o.status = 'PROCESSING' AND o.processing_started_at <= CURRENT_TIMESTAMP - INTERVAL '5 minutes'))
          AND e.status IN ('PENDING', 'ACTIVE')
        ORDER BY o.created_at ASC LIMIT 1 FOR UPDATE OF o SKIP LOCKED`
    );
    const row = claimed.rows[0];
    if (!row) { await client.query('COMMIT'); return result; }
    await client.query(`UPDATE human_support_notification_outbox SET status = 'PROCESSING', processing_started_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`, [row.id, row.tenant_id]);
    const current = await client.query(
      `SELECT o.status, e.status AS escalation_status FROM human_support_notification_outbox o
        JOIN human_support_escalations e ON e.id = o.escalation_id AND e.tenant_id = o.tenant_id
       WHERE o.id = $1 AND o.tenant_id = $2 FOR UPDATE`, [row.id, row.tenant_id]
    );
    if (current.rows[0]?.status !== 'PROCESSING' || !['PENDING', 'ACTIVE'].includes(current.rows[0]?.escalation_status)) {
      await client.query('COMMIT');
      return result;
    }
    try {
      let recipients = null;
      if (typeof resolveRecipients === 'function') {
        recipients = await resolveRecipients({
          tenantId: row.tenant_id,
          conversationId: row.conversation_id,
          rule: row.recipient_rule,
          target: row.recipient_target ?? null,
        });
        if (!Array.isArray(recipients) || recipients.length === 0) {
          await client.query(`UPDATE human_support_notification_outbox SET status = 'FAILED', processing_started_at = NULL WHERE id = $1 AND tenant_id = $2`, [row.id, row.tenant_id]);
          result.noRecipients = (result.noRecipients ?? 0) + 1;
          await client.query('COMMIT');
          return result;
        }
      }
      const outcome = await deliver({ tenantId: row.tenant_id, conversationId: row.conversation_id, recipientRule: row.recipient_rule, recipients, category: 'HUMAN_SUPPORT_REQUESTED', outboxId: row.id });
      if (outcome?.status === 'DELIVERED') {
        await client.query(`UPDATE human_support_notification_outbox SET status = 'DELIVERED', processing_started_at = NULL WHERE id = $1 AND tenant_id = $2`, [row.id, row.tenant_id]); result.delivered++;
      } else if (outcome?.retryable) {
        await client.query(`UPDATE human_support_notification_outbox SET status = 'RETRY' WHERE id = $1 AND tenant_id = $2`, [row.id, row.tenant_id]); result.retried++;
      } else { await client.query(`UPDATE human_support_notification_outbox SET status = 'FAILED' WHERE id = $1 AND tenant_id = $2`, [row.id, row.tenant_id]); result.failed++; }
    } catch { await client.query(`UPDATE human_support_notification_outbox SET status = 'RETRY' WHERE id = $1 AND tenant_id = $2`, [row.id, row.tenant_id]); result.retried++; }
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
