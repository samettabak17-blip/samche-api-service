import crypto from 'crypto';
import { randomUUID } from 'node:crypto';
import pool, { query } from '../config/db.js';
import { canOperateConversation } from './conversation-permissions.js';
import { deliverWhatsAppText, deliverWhatsAppMedia, WhatsAppDeliveryError } from './whatsapp-delivery-service.js';
import { whatsappIntegrationKey } from './whatsapp-multimodal-service.js';
import { ensureConversationCrmIdentity } from './crm-lead-service.js';
import { queueLeadQualification } from './lead-qualification-runner.js';
import { notifyLegacyTelegramSupportClosed } from './telegram-live-support-status.js';
import { createConversationResource } from './conversation-resource-service.js';
import { createConversationResourceStorage } from './conversation-resource-storage.js';
import { buildConversationStorageKey, ConversationResourceValidationError, validateConversationUpload } from './conversation-resource-validation.js';

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

export const INSERT_CONVERSATION_MESSAGE_SQL = `INSERT INTO conversation_messages
  (tenant_id, conversation_id, sender_type, content, actor_user_id, idempotency_key, external_message_id, delivery_status, delivery_status_updated_at)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar(20), CASE WHEN $8::varchar(20) IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)
 ON CONFLICT (conversation_id, idempotency_key)
   WHERE idempotency_key IS NOT NULL
   DO NOTHING
 RETURNING *`;

async function insertMessage(client, { tenantId, conversationId, senderType, content, actorUserId = null, idempotencyKey = null, externalMessageId = null, deliveryStatus = null }) {
  const result = await client.query(
    INSERT_CONVERSATION_MESSAGE_SQL,
    [tenantId, conversationId, senderType, content, actorUserId, idempotencyKey, externalMessageId, deliveryStatus]
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
      `UPDATE conversations
          SET last_activity_at = CURRENT_TIMESTAMP,
              human_support_last_activity_at = CASE
                WHEN handling_mode = 'HUMAN' AND human_attention_state = 'ACKNOWLEDGED'
                  THEN CURRENT_TIMESTAMP
                ELSE human_support_last_activity_at
              END,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [conversationId, integration.tenant_id]
    );
    await notify(client, integration.tenant_id, conversationId, 'CUSTOMER_MESSAGE');
    await client.query('COMMIT');
    queueLeadQualification({ tenantId: integration.tenant_id, conversationId });

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

export async function persistAssistantResponseIfCurrent({ tenantId, conversationId, content, handlingVersion, database = pool }) {
  const client = await database.connect();
  let operatorSendStage = 'BEGIN_TRANSACTION';
  const traceStage = (stage) => {
    operatorSendStage = stage;
    console.info('OPERATOR_SEND_STAGE stage=' + stage);
  };
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

    traceStage('ASSISTANT_PERSIST_STARTED');
    const message = await insertMessage(client, {
      tenantId,
      conversationId,
      senderType: 'ASSISTANT',
      content,
    });
    traceStage('ASSISTANT_PERSIST_SUCCEEDED');
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
      `SELECT c.*, tc.channel_type, tc.external_channel_id\n         FROM conversations c\n         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id\n        WHERE c.id = $1 AND c.tenant_id = $2\n        FOR UPDATE`,
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
      console.info('TAKEOVER_STAGE stage=STARTED tenant=' + String(tenantId).slice(0, 8));
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
                human_attention_state = CASE
                  WHEN human_attention_state = 'REQUESTED' THEN 'ACKNOWLEDGED'
                  ELSE human_attention_state
                END,
                human_attention_acknowledged_at = CASE
                  WHEN human_attention_state = 'REQUESTED' THEN CURRENT_TIMESTAMP
                  ELSE human_attention_acknowledged_at
                END,
                handling_version = handling_version + 1,
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND tenant_id = $3
          RETURNING *`,
        [actorUserId, conversationId, tenantId]
      );
      const takenOver = { ...updated.rows[0], channel_type: conversation.channel_type, external_channel_id: conversation.external_channel_id };
      console.info('TAKEOVER_STAGE stage=ASSIGNED tenant=' + String(tenantId).slice(0, 8));
      // The customer-request transfer has already been delivered. Only a voluntary
      // manual takeover receives the separate deterministic manual-takeover notice.
      if (takenOver.channel_type === 'WHATSAPP' && conversation.human_attention_state !== 'REQUESTED') {
        const content = await loadWhatsAppHumanSupportNotice(client, takenOver, 'manual_takeover');
        const integration = await loadWhatsAppAgentDelivery(client, takenOver);
        if (!content || !integration) {
          throw new ConversationOperationError(409, 'WhatsApp human delivery is not configured for this conversation', 'WHATSAPP_DELIVERY_NOT_CONFIGURED');
        }
        try {
          await deliverWhatsAppText({
            phoneNumberId: integration.external_channel_id,
            recipient: takenOver.customer_external_id,
            content,
          });
        } catch (error) {
          const code = error instanceof WhatsAppDeliveryError ? error.code : 'WHATSAPP_DELIVERY_FAILED';
          throw new ConversationOperationError(code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH' ? 409 : 502, 'WhatsApp delivery could not be completed', code);
        }
        await insertMessage(client, { tenantId, conversationId, senderType: 'ASSISTANT', content });
      }
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId, eventType: 'TAKEOVER' });
      console.info('TAKEOVER_STAGE stage=ACKNOWLEDGED tenant=' + String(tenantId).slice(0, 8));
      await notify(client, tenantId, conversationId, 'TAKEOVER');
      console.info('TAKEOVER_STAGE stage=SSE_PUBLISHED tenant=' + String(tenantId).slice(0, 8));
      await client.query('COMMIT');
      console.info('TAKEOVER_STAGE stage=SUCCESS tenant=' + String(tenantId).slice(0, 8));
      return takenOver;
    }

    if (action === 'return_to_ai') {
      const updated = await client.query(
        `UPDATE conversations
            SET handling_mode = 'AI',
                assigned_agent_user_id = NULL,
                handoff_requested = FALSE,
                handoff_reason = NULL,
                human_attention_state = CASE
                  WHEN human_attention_state IN ('REQUESTED', 'ACKNOWLEDGED') THEN 'RESOLVED'
                  ELSE human_attention_state
                END,
                human_support_closed_at = CASE
                  WHEN human_attention_state IN ('REQUESTED', 'ACKNOWLEDGED') THEN CURRENT_TIMESTAMP
                  ELSE human_support_closed_at
                END,
                handling_version = handling_version + 1,
                last_activity_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2
          RETURNING *`,
        [conversationId, tenantId]
      );
      const returned = { ...updated.rows[0], channel_type: conversation.channel_type, external_channel_id: conversation.external_channel_id };
      if (returned.channel_type === 'WHATSAPP') {
        const content = await loadWhatsAppHumanSupportNotice(client, returned, 'return_to_ai');
        const integration = await loadWhatsAppAgentDelivery(client, returned);
        if (!content || !integration) {
          throw new ConversationOperationError(409, 'WhatsApp human delivery is not configured for this conversation', 'WHATSAPP_DELIVERY_NOT_CONFIGURED');
        }
        try {
          await deliverWhatsAppText({
            phoneNumberId: integration.external_channel_id,
            recipient: returned.customer_external_id,
            content,
          });
        } catch (error) {
          const code = error instanceof WhatsAppDeliveryError ? error.code : 'WHATSAPP_DELIVERY_FAILED';
          throw new ConversationOperationError(code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH' ? 409 : 502, 'WhatsApp delivery could not be completed', code);
        }
        await insertMessage(client, { tenantId, conversationId, senderType: 'ASSISTANT', content });
      }
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId, eventType: 'RETURN_TO_AI' });
      await notify(client, tenantId, conversationId, 'RETURN_TO_AI');
      await client.query('COMMIT');
      if (conversation.handling_mode === 'HUMAN' && returned.channel_type === 'WHATSAPP') {
        void notifyLegacyTelegramSupportClosed({ customerExternalId: returned.customer_external_id });
      }
      return returned;
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

export function resolveHumanSupportTemplate(templates, key, language) {
  const candidate = templates?.human_support?.[key]?.[language]
    ?? templates?.human_support?.[key]?.en
    ?? null;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

async function loadWhatsAppHumanSupportNotice(client, conversation, templateKey) {
  const result = await client.query(
    `SELECT a.whatsapp_response_templates
       FROM channel_integrations ci
       JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
      WHERE ci.channel_id = $1
        AND ci.tenant_id = $2
        AND ci.integration_type = 'WHATSAPP'
        AND ci.enabled = TRUE
        AND a.status = 'active'
      LIMIT 2`,
    [conversation.channel_id, conversation.tenant_id]
  );
  if (result.rowCount !== 1) return null;
  return resolveHumanSupportTemplate(
    result.rows[0].whatsapp_response_templates,
    templateKey,
    conversation.communication_language
  );
}

async function loadWhatsAppAgentDelivery(client, conversation) {
  const phoneNumberId = String(conversation.external_channel_id ?? '').trim();
  if (!phoneNumberId) return null;
  const result = await client.query(
    `SELECT tc.external_channel_id, ci.integration_key
       FROM tenant_channels tc
       JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id
       JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
      WHERE tc.id = $1
        AND tc.tenant_id = $2
        AND tc.channel_type = 'WHATSAPP'
        AND tc.status = 'active'
        AND ci.integration_type = 'WHATSAPP'
        AND ci.enabled = TRUE
        AND ci.integration_key = $3
        AND a.status = 'active'
      LIMIT 2`,
    [conversation.channel_id, conversation.tenant_id, whatsappIntegrationKey(phoneNumberId)]
  );
  return result.rowCount === 1 ? result.rows[0] : null;
}

export async function getHumanDeliveryCapability({ tenantId, conversationId, database = pool }) {
  const client = await database.connect();
  try {
    const result = await client.query(
      `SELECT c.*, tc.channel_type, tc.external_channel_id
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
        WHERE c.id = $1 AND c.tenant_id = $2`,
      [conversationId, tenantId]
    );
    const conversation = result.rows[0];
    if (!conversation) return null;
    if (conversation.channel_type === 'SAMCHEGUIDE' || conversation.channel_type === 'WEB_CHAT') {
      return { channelType: conversation.channel_type, configured: true };
    }
    if (conversation.channel_type !== 'WHATSAPP') {
      return { channelType: conversation.channel_type, configured: false };
    }
    return {
      channelType: 'WHATSAPP',
      configured: Boolean(await loadWhatsAppAgentDelivery(client, conversation)),
    };
  } finally {
    client.release();
  }
}

export async function appendAgentMessage({
  tenantId,
  conversationId,
  actor,
  content,
  idempotencyKey = null,
  database = pool,
  deliverWhatsApp = deliverWhatsAppText,
}) {
  const client = await database.connect();
  let operatorSendStage = 'BEGIN_TRANSACTION';
  const traceStage = (stage) => {
    operatorSendStage = stage;
    console.info('OPERATOR_SEND_STAGE stage=' + stage);
  };
  try {
    await client.query('BEGIN');
    traceStage('CONVERSATION_LOOKUP');
    const details = await client.query(
      `SELECT c.*, tc.channel_type, tc.external_channel_id
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

    const allowed = canOperateConversation({
      systemRole: actor.systemRole,
      tenantRole: actor.tenantRole,
      action: 'send_message',
      assignedAgentUserId: conversation.assigned_agent_user_id,
      actorUserId: actor.userId,
    });
    if (!allowed) throw new ConversationOperationError(403, 'Conversation operation is not permitted', 'CONVERSATION_OPERATION_DENIED');

    if (idempotencyKey && conversation.channel_type === 'WHATSAPP') {
      const existing = await client.query(
        `SELECT * FROM conversation_messages
          WHERE tenant_id = $1 AND conversation_id = $2 AND idempotency_key = $3
          LIMIT 1`,
        [tenantId, conversationId, idempotencyKey]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { duplicate: true, message: existing.rows[0], delivery: conversation.channel_type === 'WHATSAPP' ? 'SENT_TO_WHATSAPP' : 'AVAILABLE_TO_SAMCHEGUIDE' };
      }
    }

    let delivery = 'AVAILABLE_TO_SAMCHEGUIDE';
    if (conversation.channel_type === 'WHATSAPP') {
      const integration = await loadWhatsAppAgentDelivery(client, conversation);
      if (!integration) {
        throw new ConversationOperationError(409, 'WhatsApp delivery is not configured for this conversation', 'WHATSAPP_DELIVERY_NOT_CONFIGURED');
      }
      traceStage('DELIVERY_STARTED');
      try {
        await deliverWhatsApp({
          phoneNumberId: integration.external_channel_id,
          recipient: conversation.customer_external_id,
          content,
        });
      } catch (error) {
        if (error instanceof WhatsAppDeliveryError) {
          const status = error.code === 'WHATSAPP_DELIVERY_NOT_CONFIGURED' || error.code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH' ? 409 : 502;
          throw new ConversationOperationError(status, 'WhatsApp delivery could not be completed', error.code);
        }
        throw new ConversationOperationError(502, 'WhatsApp delivery could not be completed', 'WHATSAPP_DELIVERY_FAILED');
      }
      traceStage('DELIVERY_SUCCEEDED');
      delivery = 'SENT_TO_WHATSAPP';
    } else if (!['SAMCHEGUIDE', 'WEB_CHAT'].includes(conversation.channel_type)) {
      throw new ConversationOperationError(409, 'Human delivery is not configured for this channel', 'CHANNEL_DELIVERY_UNSUPPORTED');
    }

    traceStage('AGENT_PERSIST_STARTED');
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
      return { duplicate: true, delivery };
    }

    traceStage('AGENT_PERSIST_SUCCEEDED');
    await client.query(
      'UPDATE conversations SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2',
      [conversationId, tenantId]
    );
    await writeAuditEvent(client, { tenantId, conversationId, actorUserId: actor.userId, eventType: 'HUMAN_MESSAGE' });
    // Provider delivery and AGENT persistence succeeded. This is a second, durable acknowledgement
    // boundary for a waiting customer request; manual HUMAN handling remains attention NONE.
    traceStage('ATTENTION_ACK_STARTED');
    const acknowledgement = await client.query(
      `UPDATE conversations
          SET human_attention_state = 'ACKNOWLEDGED',
              human_attention_acknowledged_at = COALESCE(human_attention_acknowledged_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND tenant_id = $2
          AND human_attention_state = 'REQUESTED'
        RETURNING id`,
      [conversationId, tenantId]
    );
    traceStage('ATTENTION_ACK_SUCCEEDED');
    if (acknowledgement.rowCount === 1) {
      traceStage('ATTENTION_ACK_AUDIT_STARTED');
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId: actor.userId, eventType: 'HUMAN_SUPPORT_ACKNOWLEDGED', metadata: { source: 'AGENT_MESSAGE' } });
      traceStage('ATTENTION_ACK_AUDIT_SUCCEEDED');
      await notify(client, tenantId, conversationId, 'HUMAN_SUPPORT_ACKNOWLEDGED');
    }
    await notify(client, tenantId, conversationId, 'AGENT_MESSAGE');
    traceStage('SSE_PUBLISHED');
    await client.query('COMMIT');
    traceStage('HTTP_SUCCESS');
    return { duplicate: false, message, delivery, attentionAcknowledged: acknowledgement.rowCount === 1 };
  } catch (error) {
    console.error('OPERATOR_SEND_FAILED stage=' + operatorSendStage + ' reason=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}


export async function appendAgentMediaMessage({
  tenantId,
  conversationId,
  actor,
  file,
  caption = '',
  idempotencyKey = null,
  database = pool,
  storage = null,
  deliverWhatsAppMedia: deliverMedia = deliverWhatsAppMedia,
}) {
  let validated;
  try {
    validated = validateConversationUpload(file);
  } catch (error) {
    if (error instanceof ConversationResourceValidationError) {
      console.info('OPERATOR_MEDIA_SEND_FAILED stage=MEDIA_VALIDATION code=' + error.code);
      throw new ConversationOperationError(400, 'Voice message could not be prepared. Please record it again.', error.code);
    }
    throw error;
  }
  const client = await database.connect();
  let uploadedStorageKey = null;
  let activeStorage = storage;
  let providerDelivered = false;
  let mediaSendStage = 'TRANSACTION_BEGIN';
  const traceMediaStage = (stage) => {
    mediaSendStage = stage;
    console.info('OPERATOR_MEDIA_SEND_STAGE stage=' + stage + ' media_category=' + validated.mediaCategory);
  };
  try {
    traceMediaStage('TRANSACTION_BEGIN');
    await client.query('BEGIN');
    traceMediaStage('CONVERSATION_LOOKUP');
    const details = await client.query(
      `SELECT c.*, tc.channel_type, tc.external_channel_id
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
    if (!['WHATSAPP', 'SAMCHEGUIDE', 'WEB_CHAT'].includes(conversation.channel_type)) throw new ConversationOperationError(409, 'Media delivery is not configured for this channel', 'CHANNEL_DELIVERY_UNSUPPORTED');

    const allowed = canOperateConversation({
      systemRole: actor.systemRole,
      tenantRole: actor.tenantRole,
      action: 'send_message',
      assignedAgentUserId: conversation.assigned_agent_user_id,
      actorUserId: actor.userId,
    });
    if (!allowed) throw new ConversationOperationError(403, 'Conversation operation is not permitted', 'CONVERSATION_OPERATION_DENIED');

    if (idempotencyKey) {
      const existing = await client.query(
        `SELECT * FROM conversation_messages
          WHERE tenant_id = $1 AND conversation_id = $2 AND idempotency_key = $3
          LIMIT 1`,
        [tenantId, conversationId, idempotencyKey]
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { duplicate: true, message: existing.rows[0], delivery: 'SENT_TO_WHATSAPP' };
      }
    }

    let deliveryResult = { delivery: 'AVAILABLE_TO_SAMCHEGUIDE', mediaId: null, providerMessageId: null };
    if (conversation.channel_type === 'WHATSAPP') {
      const integration = await loadWhatsAppAgentDelivery(client, conversation);
      if (!integration) throw new ConversationOperationError(409, 'WhatsApp delivery is not configured for this conversation', 'WHATSAPP_DELIVERY_NOT_CONFIGURED');
      try {
        traceMediaStage('WHATSAPP_MEDIA_UPLOAD_AND_SEND');
        deliveryResult = await deliverMedia({
          phoneNumberId: integration.external_channel_id,
          recipient: conversation.customer_external_id,
          file,
          mediaCategory: validated.mediaCategory,
          caption,
        });
        if (!String(deliveryResult?.providerMessageId ?? '').trim()) {
          throw new WhatsAppDeliveryError('WHATSAPP_MEDIA_SEND_UNCORRELATED');
        }
        providerDelivered = true;
        traceMediaStage('WHATSAPP_PROVIDER_ACCEPTED');
      } catch (error) {
        if (error instanceof WhatsAppDeliveryError) {
          const status = error.code === 'WHATSAPP_DELIVERY_NOT_CONFIGURED' || error.code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH' ? 409 : 502;
          throw new ConversationOperationError(status, 'WhatsApp media delivery could not be completed', error.code);
        }
        throw new ConversationOperationError(502, 'WhatsApp media delivery could not be completed', 'WHATSAPP_MEDIA_SEND_FAILED');
      }
    }

    traceMediaStage('MESSAGE_PERSISTENCE');
    const message = await insertMessage(client, {
      tenantId,
      conversationId,
      senderType: 'AGENT',
      content: String(caption).trim() || (validated.mediaCategory === 'AUDIO' ? '' : `[${validated.mediaCategory}: ${validated.originalFilename}]`),
      actorUserId: actor.userId,
      idempotencyKey,
      externalMessageId: deliveryResult.providerMessageId,
      deliveryStatus: conversation.channel_type === 'WHATSAPP' ? 'SENT' : null,
    });
    if (!message && idempotencyKey) {
      await client.query('COMMIT');
      return { duplicate: true, delivery: 'SENT_TO_WHATSAPP' };
    }

    traceMediaStage('RESOURCE_STORAGE');
    const resourceId = randomUUID();
    const storageKey = buildConversationStorageKey({ tenantId, conversationId, resourceId });
    activeStorage ??= createConversationResourceStorage();
    await activeStorage.put({ key: storageKey, body: file.buffer, mimeType: validated.mimeType, checksum: validated.contentHash });
    uploadedStorageKey = storageKey;
    const resource = await createConversationResource(client, {
      tenantId,
      conversationId,
      messageId: message.id,
      sourceType: 'AGENT_UPLOAD',
      mediaCategory: validated.mediaCategory,
      originalFilename: validated.originalFilename,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      storageKey,
      sourceReference: `agent:${message.id}:${resourceId}`,
      contentHash: validated.contentHash,
      metadata: { provider_media_id: deliveryResult?.mediaId ?? null },
      processingStatus: 'READY',
    });
    await client.query(
      'UPDATE conversations SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2',
      [conversationId, tenantId]
    );
    await writeAuditEvent(client, {
      tenantId,
      conversationId,
      actorUserId: actor.userId,
      eventType: 'HUMAN_MESSAGE',
      metadata: { media_category: validated.mediaCategory },
    });
    const acknowledgement = await client.query(
      `UPDATE conversations
          SET human_attention_state = 'ACKNOWLEDGED',
              human_attention_acknowledged_at = COALESCE(human_attention_acknowledged_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND human_attention_state = 'REQUESTED'
        RETURNING id`,
      [conversationId, tenantId]
    );
    if (acknowledgement.rowCount === 1) {
      await writeAuditEvent(client, { tenantId, conversationId, actorUserId: actor.userId, eventType: 'HUMAN_SUPPORT_ACKNOWLEDGED', metadata: { source: 'AGENT_MEDIA' } });
      await notify(client, tenantId, conversationId, 'HUMAN_SUPPORT_ACKNOWLEDGED');
    }
    await notify(client, tenantId, conversationId, 'AGENT_MESSAGE');
    traceMediaStage('COMMIT');
    await client.query('COMMIT');
    console.info('OPERATOR_MEDIA_SEND_SUCCEEDED media_category=' + validated.mediaCategory);
    return { duplicate: false, message, resource, delivery: deliveryResult.delivery, attentionAcknowledged: acknowledgement.rowCount === 1 };
  } catch (error) {
    console.error('OPERATOR_MEDIA_SEND_FAILED stage=' + mediaSendStage + ' reason=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    await client.query('ROLLBACK');
    if (uploadedStorageKey && activeStorage?.remove) {
      try { await activeStorage.remove({ key: uploadedStorageKey }); } catch {}
    }
    if (providerDelivered) console.error('OPERATOR_MEDIA_SEND_FAILED stage=POST_DELIVERY_PERSISTENCE reason=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    throw error;
  } finally {
    client.release();
  }
}

export async function recordWhatsAppDeliveryStatus({ phoneNumberId, status, database = pool }) {
  const providerMessageId = String(status?.id ?? '').trim();
  const providerStatus = String(status?.status ?? '').trim().toUpperCase();
  const deliveryStatus = { SENT: 'SENT', DELIVERED: 'DELIVERED', READ: 'READ', FAILED: 'FAILED' }[providerStatus];
  if (!providerMessageId || !deliveryStatus || !phoneNumberId) return { updated: false, reason: 'IGNORED' };

  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE conversation_messages m
          SET delivery_status = $1,
              delivery_status_updated_at = CURRENT_TIMESTAMP,
              delivery_failure_code = CASE WHEN $1 = 'FAILED' THEN COALESCE($2, 'WHATSAPP_DELIVERY_FAILED') ELSE NULL END
         FROM conversations c
         JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
        WHERE m.conversation_id = c.id
          AND m.tenant_id = c.tenant_id
          AND m.external_message_id = $3
          AND m.sender_type IN ('AGENT', 'ASSISTANT')
          AND tc.channel_type = 'WHATSAPP'
          AND tc.external_channel_id = $4
        RETURNING m.tenant_id, m.conversation_id, m.id, m.delivery_status`,
      [deliveryStatus, status?.errors?.[0]?.code ? String(status.errors[0].code) : null, providerMessageId, phoneNumberId]
    );
    for (const row of updated.rows) await notify(client, row.tenant_id, row.conversation_id, 'WHATSAPP_DELIVERY_STATUS');
    await client.query('COMMIT');
    console.info('WHATSAPP_DELIVERY_STATUS status=' + deliveryStatus + ' correlated=' + updated.rowCount);
    return { updated: updated.rowCount === 1, count: updated.rowCount, deliveryStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('WHATSAPP_DELIVERY_STATUS status=FAIL reason=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
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
