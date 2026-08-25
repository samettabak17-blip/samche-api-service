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


export async function claimDueCustomerSupportLifecycle({ database = pool, now = new Date() }) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT c.*, tc.external_channel_id, a.whatsapp_response_templates
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
         JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id
         JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
        WHERE c.status = 'open'
          AND c.handling_mode = 'HUMAN'
          AND c.human_attention_state IN ('REQUESTED', 'ACKNOWLEDGED')
          AND c.human_support_started_at IS NOT NULL
          AND c.human_support_closed_at IS NULL
          AND ci.integration_type = 'WHATSAPP' AND ci.enabled = TRUE
        ORDER BY c.human_support_last_activity_at ASC
        FOR UPDATE OF c SKIP LOCKED`
    );
    const actions = [];
    for (const conversation of due.rows) {
      const last = new Date(conversation.human_support_last_activity_at ?? conversation.human_support_started_at);
      const elapsed = now.getTime() - last.getTime();
      const templates = conversation.whatsapp_response_templates?.human_support ?? {};
      if (elapsed >= 10 * 60 * 1000) {
        const content = templates.timeout_close?.[conversation.communication_language] ?? templates.timeout_close?.tr;
        if (typeof content !== 'string' || !content.trim()) continue;
        await client.query(
          `UPDATE conversations SET handling_mode = 'AI', assigned_agent_user_id = NULL,
              human_attention_state = 'RESOLVED', handoff_requested = FALSE, handoff_reason = NULL,
              human_support_closed_at = $1, handling_version = handling_version + 1,
              last_activity_at = $1, updated_at = $1
            WHERE id = $2 AND tenant_id = $3 AND human_support_closed_at IS NULL`,
          [now, conversation.id, conversation.tenant_id]
        );
        await client.query(`INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content)
          VALUES ($1, $2, 'ASSISTANT', $3)`, [conversation.tenant_id, conversation.id, content]);
        await audit(client, { tenantId: conversation.tenant_id, conversationId: conversation.id, eventType: 'RETURN_TO_AI', metadata: { source: 'LEGACY_TIMEOUT' } });
        await notify(client, conversation.tenant_id, conversation.id, 'HUMAN_SUPPORT_TIMEOUT');
        actions.push({ type: 'TIMEOUT_CLOSE', tenantId: conversation.tenant_id, conversationId: conversation.id, recipient: conversation.customer_external_id, content });
      } else if (elapsed >= 5 * 60 * 1000 && !conversation.human_support_warning_sent_at) {
        const content = templates.warning_5m?.[conversation.communication_language] ?? templates.warning_5m?.tr;
        if (typeof content !== 'string' || !content.trim()) continue;
        await client.query(
          `UPDATE conversations SET human_support_warning_sent_at = $1, updated_at = $1
            WHERE id = $2 AND tenant_id = $3 AND human_support_warning_sent_at IS NULL`,
          [now, conversation.id, conversation.tenant_id]
        );
        await client.query(`INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content)
          VALUES ($1, $2, 'ASSISTANT', $3)`, [conversation.tenant_id, conversation.id, content]);
        await notify(client, conversation.tenant_id, conversation.id, 'HUMAN_SUPPORT_WARNING');
        actions.push({ type: 'WARNING_5M', tenantId: conversation.tenant_id, conversationId: conversation.id, recipient: conversation.customer_external_id, content });
      }
    }
    await client.query('COMMIT');
    return actions;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
