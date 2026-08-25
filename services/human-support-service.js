import pool from '../config/db.js';

export class HumanSupportError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function notify(client, tenantId, conversationId, type) {
  await client.query('SELECT pg_notify($1, $2)', [
    'samche_live_events',
    JSON.stringify({ tenant_id: tenantId, conversation_id: conversationId, type }),
  ]);
}

async function audit(client, { tenantId, conversationId, eventType, metadata = {} }) {
  await client.query(
    `INSERT INTO conversation_audit_events (tenant_id, conversation_id, event_type, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [tenantId, conversationId, eventType, JSON.stringify(metadata)]
  );
}

export async function requestCustomerHumanSupport({
  tenantId, conversationId, acknowledgement, topicSummary = null, database = pool,
}) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [conversationId, tenantId]
    );
    const conversation = locked.rows[0];
    if (!conversation) throw new HumanSupportError(404, 'CONVERSATION_NOT_FOUND');
    if (conversation.status !== 'open') throw new HumanSupportError(409, 'CONVERSATION_CLOSED');
    if (conversation.human_attention_state === 'REQUESTED' || conversation.human_attention_state === 'ACKNOWLEDGED') {
      await client.query('COMMIT');
      return { duplicate: true, conversation };
    }
    const updated = await client.query(
      `UPDATE conversations
          SET handling_mode = 'HUMAN',
              assigned_agent_user_id = NULL,
              handoff_requested = TRUE,
              handoff_reason = 'CUSTOMER_REQUESTED_HUMAN_SUPPORT',
              handling_version = handling_version + 1,
              human_attention_state = 'REQUESTED',
              human_attention_requested_at = CURRENT_TIMESTAMP,
              human_attention_acknowledged_at = NULL,
              human_support_started_at = CURRENT_TIMESTAMP,
              human_support_last_activity_at = CURRENT_TIMESTAMP,
              human_support_warning_sent_at = NULL,
              human_support_closed_at = NULL,
              human_support_topic_summary = $1,
              last_activity_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
      [topicSummary, conversationId, tenantId]
    );
    await client.query(
      `INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content)
       VALUES ($1, $2, 'ASSISTANT', $3)`,
      [tenantId, conversationId, acknowledgement]
    );
    await audit(client, { tenantId, conversationId, eventType: 'HANDOFF_REQUESTED' });
    await notify(client, tenantId, conversationId, 'HUMAN_SUPPORT_REQUESTED');
    await client.query('COMMIT');
    return { duplicate: false, conversation: updated.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listHumanAttentionSummary({ tenantId, database = pool }) {
  const result = await database.query(
    `SELECT COUNT(*)::integer AS unresolved_count
       FROM conversations
      WHERE tenant_id = $1
        AND status = 'open'
        AND human_attention_state = 'REQUESTED'`,
    [tenantId]
  );
  return { unresolvedCount: result.rows[0]?.unresolved_count ?? 0 };
}
