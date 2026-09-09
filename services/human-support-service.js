import { loadPlatformLifecycleMessages, renderPlatformLifecycleMessage } from './platform-lifecycle-message-service.js';
import { canOperateConversation } from './conversation-permissions.js';

async function defaultDatabase() {
  return (await import('../config/db.js')).default;
}

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

export async function resolveCanonicalHumanSupportOperator({ client, tenantId, conversationId = null }) {
  if (conversationId) {
    const existing = await client.query(
      `SELECT c.assigned_agent_user_id, u.system_role, tu.tenant_role
         FROM conversations c
         JOIN users u ON u.id = c.assigned_agent_user_id
         JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = c.tenant_id
        WHERE c.id = $1 AND c.tenant_id = $2
          AND (u.status = 'active' OR u.status = 'ACTIVE')`,
      [conversationId, tenantId]
    );
    if (existing.rowCount === 1) {
      const row = existing.rows[0];
      if (canOperateConversation({
        systemRole: row.system_role,
        tenantRole: row.tenant_role,
        action: 'send_message',
        assignedAgentUserId: row.assigned_agent_user_id,
        actorUserId: row.assigned_agent_user_id,
      })) {
        return row.assigned_agent_user_id;
      }
    }
  }

  const policyResult = await client.query(
    `SELECT l.recipient_rule, l.recipient_target
       FROM human_support_escalation_policies p
       JOIN human_support_escalation_levels l ON l.tenant_id = p.tenant_id AND l.policy_id = p.id
      WHERE p.tenant_id = $1 AND p.event_type = 'HUMAN_SUPPORT_REQUESTED' AND p.enabled = TRUE
      ORDER BY l.level_order ASC`,
    [tenantId]
  );
  for (const level of policyResult.rows) {
    if (level.recipient_rule === 'USER' && level.recipient_target?.userId) {
      const userResult = await client.query(
        `SELECT u.id FROM users u
           JOIN tenant_users tu ON tu.user_id = u.id
          WHERE tu.tenant_id = $1 AND u.id = $2 AND (u.status = 'active' OR u.status = 'ACTIVE')`,
        [tenantId, level.recipient_target.userId]
      );
      if (userResult.rowCount === 1) return userResult.rows[0].id;
    }
    if (level.recipient_rule === 'ROLE') {
      const targetRole = level.recipient_target?.role ?? 'ADMIN';
      const roleUsers = await client.query(
        `SELECT u.id FROM users u
           JOIN tenant_users tu ON tu.user_id = u.id
          WHERE tu.tenant_id = $1 AND tu.tenant_role = $2
            AND (u.status = 'active' OR u.status = 'ACTIVE')
          ORDER BY tu.created_at ASC, u.id ASC
          LIMIT 1`,
        [tenantId, targetRole]
      );
      if (roleUsers.rowCount === 1) return roleUsers.rows[0].id;
    }
  }

  const candidateUsers = await client.query(
    `SELECT u.id, u.system_role, tu.tenant_role
       FROM users u
       JOIN tenant_users tu ON tu.user_id = u.id
      WHERE tu.tenant_id = $1 AND (u.status = 'active' OR u.status = 'ACTIVE')
      ORDER BY CASE
                 WHEN tu.tenant_role = 'ADMIN' THEN 1
                 WHEN tu.tenant_role = 'OWNER' THEN 2
                 WHEN tu.tenant_role = 'AGENT' THEN 3
                 ELSE 4
               END ASC,
               tu.created_at ASC,
               u.id ASC
      LIMIT 1`,
    [tenantId]
  );
  if (candidateUsers.rowCount === 1) {
    return candidateUsers.rows[0].id;
  }

  const platformOwner = await client.query(
    `SELECT u.id FROM users u
      WHERE u.system_role = 'OWNER' AND (u.status = 'active' OR u.status = 'ACTIVE')
      ORDER BY u.created_at ASC, u.id ASC
      LIMIT 1`
  );
  if (platformOwner.rowCount === 1) {
    const ownerId = platformOwner.rows[0].id;
    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id, tenant_role)
       VALUES ($1, $2, 'ADMIN')
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [tenantId, ownerId]
    );
    return ownerId;
  }

  return null;
}

export async function requestCustomerHumanSupport({
  tenantId, conversationId, acknowledgement, topicSummary = null, database = null,
}) {
  const client = await (database ?? await defaultDatabase()).connect();
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
    const assignedAgentUserId = await resolveCanonicalHumanSupportOperator({
      client,
      tenantId,
      conversationId,
    });
    const updated = await client.query(
      `UPDATE conversations
          SET handling_mode = 'HUMAN',
              assigned_agent_user_id = $1,
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
              human_support_topic_summary = $2,
              last_activity_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND tenant_id = $4
        RETURNING *`,
      [assignedAgentUserId, topicSummary, conversationId, tenantId]
    );
    await client.query(
      `INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content)
       VALUES ($1, $2, 'ASSISTANT', $3)`,
      [tenantId, conversationId, acknowledgement]
    );
    await audit(client, { tenantId, conversationId, eventType: 'HANDOFF_REQUESTED' });
    // Durable domain event for the notification/escalation worker. Transport
    // adapters consume this event asynchronously; they never gate the handoff.
    await audit(client, { tenantId, conversationId, eventType: 'HUMAN_SUPPORT_REQUESTED' });
    await client.query(
      `INSERT INTO human_support_escalations
         (tenant_id, conversation_id, policy_id, status, current_level, next_due_at, idempotency_key)
       VALUES ($1, $2,
         (SELECT id FROM human_support_escalation_policies
           WHERE tenant_id = $1 AND event_type = 'HUMAN_SUPPORT_REQUESTED' AND enabled = TRUE LIMIT 1),
         'PENDING', 0, CURRENT_TIMESTAMP, $3)
       ON CONFLICT (tenant_id, conversation_id, idempotency_key) DO NOTHING`,
      [tenantId, conversationId, `human-support-requested:${conversationId}`],
    );
    await notify(client, tenantId, conversationId, 'HUMAN_SUPPORT_REQUESTED');
    await client.query('COMMIT');
    console.info('HUMAN_SUPPORT_REQUEST persisted=1 attention=REQUESTED tenant=' + String(tenantId).slice(0, 8));
    console.info('DASHBOARD_SSE_PUBLISH event_type=HUMAN_SUPPORT_REQUESTED tenant=' + String(tenantId).slice(0, 8));
    console.info('SUPPORT_REQUEST_CREATED = tenant=' + String(tenantId).slice(0, 8) + ' conversation=' + String(conversationId).slice(0, 8));
    console.info('AUTO_OPERATOR_ASSIGNED = tenant=' + String(tenantId).slice(0, 8) + ' conversation=' + String(conversationId).slice(0, 8) + ' operator=' + String(assignedAgentUserId).slice(0, 8));
    console.info('AI_SUPPRESSION_SET = tenant=' + String(tenantId).slice(0, 8) + ' conversation=' + String(conversationId).slice(0, 8) + ' handling_mode=HUMAN');
    console.info('ESCALATION_SCHEDULED = tenant=' + String(tenantId).slice(0, 8) + ' level=1 timeout_sec=300');
    return { duplicate: false, conversation: updated.rows[0], assignedOperatorId: assignedAgentUserId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listHumanAttentionSummary({ tenantId, database = null }) {
  const result = await (database ?? await defaultDatabase()).query(
    `SELECT COUNT(*)::integer AS unresolved_count
       FROM conversations
      WHERE tenant_id = $1
        AND status = 'open'
        AND human_attention_state = 'REQUESTED'`,
    [tenantId]
  );
  const unresolvedCount = Number(result.rows[0]?.unresolved_count ?? 0);
  // Safe staging/runtime evidence: no customer, message, document, or credential data.
  console.info('HUMAN_ATTENTION_SUMMARY tenant=' + String(tenantId).slice(0, 8) + ' requested_count=' + unresolvedCount);
  return { unresolvedCount };
}


export async function claimDueCustomerSupportLifecycle({ database = null, now = new Date() } = {}) {
  const client = await (database ?? await defaultDatabase()).connect();
  try {
    await client.query('BEGIN');
    const lifecycleTemplates = await loadPlatformLifecycleMessages({ database: client });
    const due = await client.query(
      `SELECT c.*, tc.external_channel_id
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
         JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id
         JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
        WHERE c.status = 'open'
          AND c.handling_mode = 'HUMAN'
          AND c.human_attention_state IN ('REQUESTED', 'ACKNOWLEDGED')
          AND c.human_attention_requested_at IS NOT NULL
          AND c.human_support_closed_at IS NULL
          AND ci.integration_type = 'WHATSAPP' AND ci.enabled = TRUE
        ORDER BY c.human_attention_requested_at ASC
        FOR UPDATE OF c SKIP LOCKED`
    );
    const actions = [];
    let warnings = 0;
    let timeouts = 0;
    console.info('HUMAN_SUPPORT_LIFECYCLE_SCAN requested=' + due.rows.filter((row) => row.human_attention_state === 'REQUESTED').length + ' acknowledged=' + due.rows.filter((row) => row.human_attention_state === 'ACKNOWLEDGED').length);
    for (const conversation of due.rows) {
      const requestedAt = new Date(conversation.human_attention_requested_at);
      const elapsed = now.getTime() - requestedAt.getTime();
      if (elapsed >= 10 * 60 * 1000) {
        const content = renderPlatformLifecycleMessage({ templates: lifecycleTemplates, key: 'return_to_ai', locale: conversation.communication_language });
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
        timeouts += 1;
        console.info('HUMAN_SUPPORT_TIMEOUT status=CLAIMED tenant=' + String(conversation.tenant_id).slice(0, 8));
        console.info('LIFECYCLE_MESSAGE_SENT = tenant=' + String(conversation.tenant_id).slice(0, 8) + ' conversation=' + String(conversation.id).slice(0, 8) + ' event_type=return_to_ai');
        actions.push({ type: 'TIMEOUT_CLOSE', tenantId: conversation.tenant_id, conversationId: conversation.id, recipient: conversation.customer_external_id, phoneNumberId: conversation.external_channel_id, content });
      } else if (elapsed >= 5 * 60 * 1000 && !conversation.human_support_warning_sent_at) {
        const content = renderPlatformLifecycleMessage({ templates: lifecycleTemplates, key: 'human_session_warning', locale: conversation.communication_language });
        await client.query(
          `UPDATE conversations SET human_support_warning_sent_at = $1, updated_at = $1
            WHERE id = $2 AND tenant_id = $3 AND human_support_warning_sent_at IS NULL`,
          [now, conversation.id, conversation.tenant_id]
        );
        await client.query(`INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content)
          VALUES ($1, $2, 'ASSISTANT', $3)`, [conversation.tenant_id, conversation.id, content]);
        await notify(client, conversation.tenant_id, conversation.id, 'HUMAN_SUPPORT_WARNING');
        warnings += 1;
        console.info('HUMAN_SUPPORT_WARNING status=CLAIMED tenant=' + String(conversation.tenant_id).slice(0, 8));
        console.info('LIFECYCLE_MESSAGE_SENT = tenant=' + String(conversation.tenant_id).slice(0, 8) + ' conversation=' + String(conversation.id).slice(0, 8) + ' event_type=human_session_warning');
        actions.push({ type: 'WARNING_5M', tenantId: conversation.tenant_id, conversationId: conversation.id, recipient: conversation.customer_external_id, phoneNumberId: conversation.external_channel_id, content });
      }
    }
    await client.query('COMMIT');
    console.info('HUMAN_SUPPORT_LIFECYCLE_CRON status=OK claimed=' + actions.length + ' warnings=' + warnings + ' timeouts=' + timeouts);
    return actions;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function claimDueHumanSupportEscalations({ database = null, now = new Date() } = {}) {
  const client = await (database ?? await defaultDatabase()).connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT e.id AS escalation_id, e.tenant_id, e.conversation_id, e.current_level,
              l.level_order, l.recipient_rule, l.acknowledgement_timeout_seconds
         FROM human_support_escalations e
         JOIN human_support_escalation_levels l
           ON l.tenant_id = e.tenant_id AND l.policy_id = e.policy_id
          AND l.level_order = e.current_level + 1
        WHERE e.status IN ('PENDING', 'ACTIVE') AND e.next_due_at <= $1
        ORDER BY e.next_due_at ASC FOR UPDATE OF e SKIP LOCKED`, [now]
    );
    const actions = [];
    for (const row of due.rows) {
      const key = `human-support-escalation:${row.escalation_id}:${row.level_order}`;
      const inserted = await client.query(
        `INSERT INTO human_support_notification_outbox
          (tenant_id, escalation_id, conversation_id, level_order, idempotency_key, status)
         VALUES ($1, $2, $3, $4, $5, 'PENDING')
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
        [row.tenant_id, row.escalation_id, row.conversation_id, row.level_order, key]
      );
      if (!inserted.rowCount) continue;
      await client.query(
        `UPDATE human_support_escalations SET status = 'ACTIVE', current_level = $1,
          next_due_at = $2::timestamptz + make_interval(secs => $3::double precision), updated_at = $2::timestamptz WHERE id = $4 AND tenant_id = $5`,
        [row.level_order, now, row.acknowledgement_timeout_seconds, row.escalation_id, row.tenant_id]
      );
            console.info('ESCALATION_SCHEDULED = tenant=' + String(row.tenant_id).slice(0, 8) + ' level=' + row.level_order + ' timeout_sec=' + row.acknowledgement_timeout_seconds);
      actions.push({ tenantId: row.tenant_id, conversationId: row.conversation_id, escalationId: row.escalation_id, level: row.level_order, recipientRule: row.recipient_rule });
    }
    await client.query('COMMIT');
    return actions;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function triggerImmediateHumanSupportNotificationPipeline({
  database = null,
  tenantId,
  conversationId,
  deliverWebPush = null,
} = {}) {
  const db = database ?? await defaultDatabase();
  try {
    await claimDueHumanSupportEscalations({ database: db });
    const { resolveHumanSupportRecipients } = await import('./human-support-recipient-service.js');
    const { processHumanSupportNotificationOutbox } = await import('./human-support-notification-outbox-service.js');
    const { enqueueHumanHandoffPushNotification, processPushNotificationOutbox } = await import('./push-notification-service.js');
    await processHumanSupportNotificationOutbox({
      database: db,
      tenantId,
      resolveRecipients: (input) => resolveHumanSupportRecipients({ database: db, ...input }),
      deliver: async ({ recipients, tenantId: tId, conversationId: cId, outboxId }) => {
        await enqueueHumanHandoffPushNotification({
          database: db,
          tenantId: tId,
          conversationId: cId,
          handoffOutboxId: outboxId,
          recipients,
        });
        return { status: 'DELIVERED' };
      },
    });
    if (typeof deliverWebPush === 'function') {
      await processPushNotificationOutbox({
        database: db,
        tenantId,
        deliver: deliverWebPush,
      });
    }
  } catch (error) {
    console.error('IMMEDIATE_HUMAN_SUPPORT_PUSH_PIPELINE error=' + (error?.code ?? error?.message ?? 'UNKNOWN'));
  }
}
