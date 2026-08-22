import crypto from 'crypto';
import pool, { query } from '../config/db.js';
import { canOperateConversation } from './conversation-permissions.js';
import { ensureConversationCrmIdentity } from './crm-lead-service.js';

export class ConversationOperationError extends Error {
  constructor(status, message, code = 'CONVERSATION_OPERATION_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const integrationKey = 'SAMCHEGUIDE:staging';

function publicConversationKey(externalSessionId) {
  return `samcheguide:${crypto.createHash('sha256').update(String(externalSessionId)).digest('hex')}`;
}

function customerReference(externalSessionId) {
  return `samcheguide:${crypto.createHash('sha256').update(String(externalSessionId)).digest('hex').slice(0, 16)}`;
}

async function notify(client, tenantId, conversationId, type) {
  await client.query('SELECT pg_notify($1, $2)', [
    'samche_live_events',
    JSON.stringify({ tenant_id: tenantId, conversation_id: conversationId, type }),
  ]);
}

async function writeAuditEvent(client, { tenantId, conversationId, actorUserId = null, eventType, metadata = {} }) {
  await client.query(
    `INSERT INTO conversation_audit_events
      (tenant_id, conversation_id, actor_user_id, event_type, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tenantId, conversationId, actorUserId, eventType, JSON.stringify(metadata)]
  );
}

async function loadSamcheguideIntegration(client) {
  const result = await client.query(
    `SELECT ci.tenant_id, ci.channel_id, ci.assistant_id, tc.channel_type, tc.status AS channel_status
       FROM channel_integrations ci
       JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
      WHERE ci.integration_key = $1
        AND ci.integration_type = 'SAMCHEGUIDE'
        AND ci.enabled = TRUE
      LIMIT 1`,
    [integrationKey]
  );
  return result.rows[0] ?? null;
}

async function insertMessage(client, { tenantId, conversationId, senderType, content, actorUserId = null, idempotencyKey = null }) {
  const result = await client.query(
    `INSERT INTO conversation_messages
      (tenant_id, conversation_id, sender_type, content, actor_user_id, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (conversation_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [tenantId, conversationId, senderType, content, actorUserId, idempotencyKey]
  );
  return result.rows[0] ?? null;
}


export async function getSamcheguidePublicFeed({ externalSessionId }) {
  const client = await pool.connect();
  try {
    const integration = await loadSamcheguideIntegration(client);
    if (!integration || integration.channel_status !== 'active') return null;
    const result = await client.query(
      `SELECT c.id AS conversation_id, m.id, m.sender_type, m.content, m.created_at
         FROM conversations c
         JOIN conversation_messages m ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.channel_id = $2 AND c.external_conversation_id = $3
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT 100`,
      [integration.tenant_id, integration.channel_id, publicConversationKey(externalSessionId)]
    );
    return {
      tenantId: integration.tenant_id,
      conversationId: result.rows[0]?.conversation_id ?? null,
      messages: result.rows.map(({ id, sender_type, content, created_at }) => ({ id, sender_type, content, created_at })),
    };
  } finally {
    client.release();
  }
}

export async function getSamcheguidePublicHistory({ externalSessionId }) {
  const feed = await getSamcheguidePublicFeed({ externalSessionId });
  if (!feed) return null;
  return feed.messages.map((message) => ({
    role: message.sender_type === 'CUSTOMER' ? 'user' : 'model',
    parts: [{ text: message.content }],
  }));
}

export async function persistSamcheguideInbound({ externalSessionId, content, idempotencyKey = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const integration = await loadSamcheguideIntegration(client);
    if (!integration || integration.channel_status !== 'active') {
      await client.query('COMMIT');
      return null;
    }

    const externalConversationId = publicConversationKey(externalSessionId);
    const conversationResult = await client.query(
      `INSERT INTO conversations
        (tenant_id, channel_id, external_conversation_id, customer_external_id, last_activity_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (channel_id, external_conversation_id)
       DO UPDATE SET last_activity_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [integration.tenant_id, integration.channel_id, externalConversationId, customerReference(externalSessionId)]
    );

    const conversationId = conversationResult.rows[0].id;
    const locked = await client.query(
      'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [conversationId, integration.tenant_id]
    );
    const conversation = locked.rows[0];

    await ensureConversationCrmIdentity(client, {
      tenantId: integration.tenant_id,
      conversationId,
      source: 'SAMCHEGUIDE',
      externalCustomerId: conversation.customer_external_id,
    });

    const customerMessage = await insertMessage(client, {
      tenantId: integration.tenant_id,
      conversationId,
      senderType: 'CUSTOMER',
      content,
      idempotencyKey,
    });

    if (!customerMessage && idempotencyKey) {
      await client.query('COMMIT');
      return {
        integration,
        conversation,
        duplicate: true,
        shouldInvokeAi: false,
      };
    }

    await client.query(
      'UPDATE conversations SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2',
      [conversationId, integration.tenant_id]
    );
    await notify(client, integration.tenant_id, conversationId, 'CUSTOMER_MESSAGE');
    await client.query('COMMIT');

    return {
      integration,
      conversation,
      customerMessage,
      duplicate: false,
      shouldInvokeAi: conversation.status === 'open' && conversation.handling_mode === 'AI',
      handlingVersion: conversation.handling_version,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function persistAssistantResponseIfCurrent({ tenantId, conversationId, content, handlingVersion }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [conversationId, tenantId]
    );
    const conversation = locked.rows[0];
    if (!conversation || conversation.status !== 'open' || conversation.handling_mode !== 'AI' || conversation.handling_version !== handlingVersion) {
      await client.query('COMMIT');
      return { delivered: false };
    }

    const message = await insertMessage(client, {
      tenantId,
      conversationId,
      senderType: 'ASSISTANT',
      content,
    });
    await client.query(
      'UPDATE conversations SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2',
      [conversationId, tenantId]
    );
    await notify(client, tenantId, conversationId, 'ASSISTANT_MESSAGE');
    await client.query('COMMIT');
    return { delivered: true, message };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function operateConversation({ tenantId, conversationId, actor, action }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [conversationId, tenantId]
    );
    const conversation = result.rows[0];
    if (!conversation) throw new ConversationOperationError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    if (conversation.status !== 'open' && action !== 'close') {
      throw new ConversationOperationError(409, 'Conversation is closed', 'CONVERSATION_CLOSED');
    }

    const actorUserId = actor.userId;
    const permission = canOperateConversation({
      systemRole: actor.systemRole,
      tenantRole: actor.tenantRole,
      action,
      assignedAgentUserId: conversation.assigned_agent_user_id,
      actorUserId,
    });
    if (!permission) throw new ConversationOperationError(403, 'Conversation operation is not permitted', 'CONVERSATION_OPERATION_DENIED');

    if (action === 'takeover') {
      if (conversation.assigned_agent_user_id && conversation.assigned_agent_user_id !== actorUserId) {
        throw new ConversationOperationError(409, 'Conversation is already handled by another agent', 'CONVERSATION_ALREADY_ASSIGNED');
      }
      if (conversation.handling_mode === 'HUMAN' && conversation.assigned_agent_user_id === actorUserId) {
        await client.query('COMMIT');
        return conversation;
      }
      const updated = await client.query(
        `UPDATE conversations
            SET handling_mode = 'HUMAN',
                assigned_agent_user_id = $1,
                handoff_requested = FALSE,
                handoff_reason = NULL,
                handling_version = handling_version + 1,
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND tenant_id = $3
          RETURNING *`,
        [actorUserId, conversationId, tenantId]
      );
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId, eventType: 'TAKEOVER' });
      await notify(client, tenantId, conversationId, 'TAKEOVER');
      await client.query('COMMIT');
      return updated.rows[0];
    }

    if (action === 'return_to_ai') {
      const updated = await client.query(
        `UPDATE conversations
            SET handling_mode = 'AI',
                assigned_agent_user_id = NULL,
                handoff_requested = FALSE,
                handoff_reason = NULL,
                handling_version = handling_version + 1,
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [conversationId, tenantId]
      );
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId, eventType: 'RETURN_TO_AI' });
      await notify(client, tenantId, conversationId, 'RETURN_TO_AI');
      await client.query('COMMIT');
      return updated.rows[0];
    }

    if (action === 'pause') {
      if (conversation.handling_mode !== 'AI') throw new ConversationOperationError(409, 'Only AI-handled conversations can be paused', 'CONVERSATION_NOT_AI');
      const updated = await client.query(
        `UPDATE conversations
            SET handling_mode = 'PAUSED',
                handling_version = handling_version + 1,
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [conversationId, tenantId]
      );
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId, eventType: 'PAUSE' });
      await notify(client, tenantId, conversationId, 'PAUSE');
      await client.query('COMMIT');
      return updated.rows[0];
    }

    if (action === 'resume') {
      if (conversation.handling_mode !== 'PAUSED') throw new ConversationOperationError(409, 'Only paused conversations can be resumed', 'CONVERSATION_NOT_PAUSED');
      const updated = await client.query(
        `UPDATE conversations
            SET handling_mode = 'AI',
                assigned_agent_user_id = NULL,
                handling_version = handling_version + 1,
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [conversationId, tenantId]
      );
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId, eventType: 'RESUME' });
      await notify(client, tenantId, conversationId, 'RESUME');
      await client.query('COMMIT');
      return updated.rows[0];
    }

    if (action === 'close') {
      const updated = await client.query(
        `UPDATE conversations
            SET status = 'closed',
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [conversationId, tenantId]
      );
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId, eventType: 'CLOSE' });
      await notify(client, tenantId, conversationId, 'CLOSE');
      await client.query('COMMIT');
      return updated.rows[0];
    }

    throw new ConversationOperationError(400, 'Unsupported conversation operation', 'CONVERSATION_OPERATION_INVALID');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function appendAgentMessage({ tenantId, conversationId, actor, content, idempotencyKey = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const details = await client.query(
      `SELECT c.*, tc.channel_type
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
        WHERE c.id = $1 AND c.tenant_id = $2
        FOR UPDATE`,
      [conversationId, tenantId]
    );
    const conversation = details.rows[0];
    if (!conversation) throw new ConversationOperationError(404, 'Conversation not found', 'CONVERSATION_NOT_FOUND');
    if (conversation.status !== 'open') throw new ConversationOperationError(409, 'Conversation is closed', 'CONVERSATION_CLOSED');
    if (conversation.handling_mode !== 'HUMAN') throw new ConversationOperationError(409, 'Human messages require human handling mode', 'CONVERSATION_NOT_HUMAN');
    if (conversation.channel_type !== 'SAMCHEGUIDE') {
      throw new ConversationOperationError(409, 'Human delivery is not configured for this channel', 'CHANNEL_DELIVERY_UNSUPPORTED');
    }

    const allowed = canOperateConversation({
      systemRole: actor.systemRole,
      tenantRole: actor.tenantRole,
      action: 'send_message',
      assignedAgentUserId: conversation.assigned_agent_user_id,
      actorUserId: actor.userId,
    });
    if (!allowed) throw new ConversationOperationError(403, 'Conversation operation is not permitted', 'CONVERSATION_OPERATION_DENIED');

    const message = await insertMessage(client, {
      tenantId,
      conversationId,
      senderType: 'AGENT',
      content,
      actorUserId: actor.userId,
      idempotencyKey,
    });
    if (!message && idempotencyKey) {
      await client.query('COMMIT');
      return { duplicate: true };
    }

    await client.query(
      'UPDATE conversations SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2',
      [conversationId, tenantId]
    );
    await writeAuditEvent(client, { tenantId, conversationId, actorUserId: actor.userId, eventType: 'HUMAN_MESSAGE' });
    await notify(client, tenantId, conversationId, 'AGENT_MESSAGE');
    await client.query('COMMIT');
    return { duplicate: false, message, delivery: 'AVAILABLE_TO_SAMCHEGUIDE' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listConversationEvents({ tenantId, conversationId }) {
  const result = await query(
    `SELECT e.id, e.event_type, e.metadata, e.created_at, u.email AS actor_email
       FROM conversation_audit_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.tenant_id = $1 AND e.conversation_id = $2
      ORDER BY e.created_at ASC`,
    [tenantId, conversationId]
  );
  return result.rows;
}
