import crypto from 'node:crypto';
import pool from '../config/db.js';
import { createConversationResource } from './conversation-resource-service.js';
import { cancelConversationContextualFollowUps } from './durable-follow-up-service.js';

export class InstagramInboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstagramInboxError';
    this.code = code;
  }
}

export function instagramCustomerReference(senderIgsid) {
  return `instagram:${String(senderIgsid ?? '').trim()}`;
}

export function instagramExternalConversationId(senderIgsid) {
  const ref = instagramCustomerReference(senderIgsid);
  return `instagram:${crypto.createHash('sha256').update(ref).digest('hex')}`;
}

async function notify(client, tenantId, conversationId, type) {
  await client.query('SELECT pg_notify($1, $2)', [
    'samche_live_events',
    JSON.stringify({ tenant_id: tenantId, conversation_id: conversationId, type }),
  ]);
}

/**
 * Resolves Instagram tenant integration by recipient ID (Instagram Business Account ID or Page ID).
 * Fails closed if unknown, inactive, or ambiguous across tenants.
 */
export async function resolveInstagramIntegration(client, recipientId) {
  if (!recipientId || typeof recipientId !== 'string') return null;
  const cleanId = recipientId.trim();
  const normalizedId = cleanId.replace(/^instagram:\s*/i, '');

  const result = await client.query(
    `SELECT tc.tenant_id, tc.id AS channel_id, tc.assistant_id, tc.assistant_id AS channel_assistant_id,
            tc.external_channel_id, tc.channel_type, tc.status AS channel_status, a.status AS assistant_status,
            t.name AS tenant_name, a.name AS assistant_name, a.model AS assistant_model,
            a.system_prompt AS assistant_system_prompt,
            ci.config AS config
       FROM tenant_channels tc
       JOIN tenants t ON t.id = tc.tenant_id AND t.status = 'active'
       LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
       LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
      WHERE tc.channel_type = 'INSTAGRAM'
        AND tc.status = 'active'
        AND (tc.assistant_id IS NULL OR a.status = 'active')
        AND (
          tc.external_channel_id = $1
          OR tc.external_channel_id = $2
          OR regexp_replace(lower(trim(tc.external_channel_id)), '^instagram:\\s*', '') = $1
          OR ci.config->>'instagram_account_id' = $1
          OR ci.config->>'instagram_user_id' = $1
          OR ci.config->>'instagram_business_account_id' = $1
          OR ci.config->>'page_id' = $1
        )
      ORDER BY tc.updated_at DESC
      LIMIT 2`,
    [cleanId, normalizedId]
  );

  if (result.rowCount === 1) {
    return {
      ...result.rows[0],
      external_channel_id: cleanId,
      config: result.rows[0].config || {},
    };
  }

  if (result.rowCount > 1) {
    console.info('INSTAGRAM_CANONICAL_OWNERSHIP_AMBIGUOUS recipient=' + cleanId.slice(0, 8));
  }
  return null;
}

/**
 * Upserts a tenant-isolated conversation for an Instagram contact.
 */
export async function upsertInstagramConversation(client, { tenantId, channelId, senderIgsid }) {
  const extConvId = instagramExternalConversationId(senderIgsid);
  const custRef = instagramCustomerReference(senderIgsid);

  const result = await client.query(
    `INSERT INTO conversations
      (tenant_id, channel_id, external_conversation_id, customer_external_id, last_activity_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (channel_id, external_conversation_id)
     DO UPDATE SET last_activity_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE conversations.tenant_id = EXCLUDED.tenant_id
         AND conversations.channel_id = EXCLUDED.channel_id
     RETURNING *`,
    [tenantId, channelId, extConvId, custRef]
  );

  if (result.rowCount !== 1) {
    throw new InstagramInboxError(
      'INSTAGRAM_CONVERSATION_OWNERSHIP_CONFLICT',
      'Conversation ownership conflicts with canonical Instagram channel ownership'
    );
  }
  return result.rows[0];
}

/**
 * Persists an inbound Instagram message into the canonical conversation database.
 */
export async function persistInstagramInbound({
  database = pool,
  recipientId,
  senderIgsid,
  messageId = null,
  content = '',
  attachments = [],
  referral = null,
  ensureConversationCrmIdentity = null,
  queueLeadQualification = null,
}) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');

    const integration = await resolveInstagramIntegration(client, recipientId);
    if (!integration) {
      await client.query('ROLLBACK');
      return { unmapped: true };
    }

    const tenantId = integration.tenant_id;
    const channelId = integration.channel_id;
    const sourceKind = (referral?.adId || referral?.source === 'ADS') ? 'INSTAGRAM_AD' : 'INSTAGRAM';

    const conversation = await upsertInstagramConversation(client, {
      tenantId,
      channelId,
      senderIgsid,
    });

    const conversationId = conversation.id;

    // Resolve / establish canonical CRM identity for this contact
    const crmEnsureFn = typeof ensureConversationCrmIdentity === 'function'
      ? ensureConversationCrmIdentity
      : (await import('./crm-lead-service.js')).ensureConversationCrmIdentity;

    if (typeof crmEnsureFn === 'function') {
      try {
        await client.query('SAVEPOINT crm_identity_sp');
        await crmEnsureFn(client, {
          tenantId,
          conversationId,
          source: sourceKind,
          externalCustomerId: instagramCustomerReference(senderIgsid),
        });
        await client.query('RELEASE SAVEPOINT crm_identity_sp');
        const freshConvRes = await client.query(
          `SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2`,
          [conversationId, tenantId]
        );
        if (freshConvRes.rowCount === 1) {
          Object.assign(conversation, freshConvRes.rows[0]);
        }
      } catch (crmErr) {
        await client.query('ROLLBACK TO SAVEPOINT crm_identity_sp').catch(() => {});
        console.warn('INSTAGRAM_CRM_IDENTITY_WARN', crmErr?.message);
      }
    }


    // Idempotency check for incoming provider message ID
    if (messageId) {
      const existing = await client.query(
        `SELECT id, sender_type FROM conversation_messages
          WHERE tenant_id = $1 AND conversation_id = $2 AND external_message_id = $3
          LIMIT 1`,
        [tenantId, conversationId, messageId]
      );
      if (existing.rowCount > 0) {
        await client.query('COMMIT');
        return {
          duplicate: true,
          integration,
          conversation,
          shouldInvokeAi: false,
        };
      }
    }

    // Build message text content (include placeholder if text empty but attachments present)
    let messageText = String(content ?? '').trim();
    if (!messageText && attachments.length > 0) {
      messageText = `[Attachment: ${attachments[0].type || 'media'}]`;
    }

    // Insert canonical message into conversation_messages
    const msgResult = await client.query(
      `INSERT INTO conversation_messages
        (tenant_id, conversation_id, sender_type, content, external_message_id, created_at)
       VALUES ($1, $2, 'CUSTOMER', $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (conversation_id, external_message_id) DO NOTHING
       RETURNING *`,
      [tenantId, conversationId, messageText, messageId]
    );

    if (msgResult.rowCount === 0) {
      await client.query('COMMIT');
      return {
        duplicate: true,
        integration,
        conversation,
        shouldInvokeAi: false,
      };
    }

    const customerMessage = msgResult.rows[0];

    // Ingest media attachments into conversation_resources
    for (const att of attachments) {
      try {
        const category = att.type === 'image' ? 'IMAGE'
          : att.type === 'audio' ? 'AUDIO'
          : att.type === 'video' ? 'IMAGE'
          : 'DOCUMENT';

        await createConversationResource(client, {
          tenantId,
          conversationId,
          messageId: customerMessage.id,
          sourceType: 'URL',
          mediaCategory: category,
          originalFilename: att.title || `instagram_${att.type}`,
          sourceUrl: att.url,
          sourceReference: `instagram:${att.type}:${messageId || customerMessage.id}`,
          processingStatus: 'READY',
          metadata: { provider: 'INSTAGRAM', attachment_type: att.type },
        });
      } catch (resErr) {
        console.warn('INSTAGRAM_ATTACHMENT_INGESTION_WARN', resErr?.message);
      }
    }

    // Cancel pending follow-ups on active customer interaction
    await cancelConversationContextualFollowUps({
      database: client,
      tenantId,
      conversationId,
    }).catch(() => {});

    // Update conversation last_activity_at
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
      [conversationId, tenantId]
    );

    // Publish Live Event Bus event for Live Inbox
    await notify(client, tenantId, conversationId, 'CUSTOMER_MESSAGE');

    await client.query('COMMIT');

    // Trigger lead qualification asynchronously
    if (typeof queueLeadQualification === 'function') {
      try {
        queueLeadQualification({
          tenantId,
          conversationId,
          sourceChannel: sourceKind,
        });
      } catch {}
    }


    const shouldInvokeAi = conversation.status === 'open' && conversation.handling_mode === 'AI';

    return {
      duplicate: false,
      integration,
      conversation,
      customerMessage,
      shouldInvokeAi,
      handlingVersion: conversation.handling_version,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

