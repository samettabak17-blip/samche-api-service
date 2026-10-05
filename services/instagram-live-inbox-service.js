import crypto from 'node:crypto';
import axios from 'axios';
import pool from '../config/db.js';
import { createConversationResource } from './conversation-resource-service.js';
import { cancelConversationContextualFollowUps } from './durable-follow-up-service.js';
import { instagramGraphApiBase, metaGraphApiBase } from './meta-graph-api-version.js';

export class InstagramInboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstagramInboxError';
    this.code = code;
  }
}

const profileCache = new Map();

export function buildInstagramAttachmentResourceMetadata(attachment = {}) {
  const sharedContent = attachment.sharedContent && typeof attachment.sharedContent === 'object'
    ? {
        type: attachment.sharedContent.type || null,
        id: attachment.sharedContent.id || null,
        caption: attachment.sharedContent.caption || null,
        description: attachment.sharedContent.description || null,
        referral_text: attachment.sharedContent.referralText || null,
        source: attachment.sharedContent.source || null,
        permalink: attachment.sharedContent.permalink || null,
      }
    : null;
  return {
    provider: 'INSTAGRAM',
    attachment_type: attachment.type || null,
    shared_content: sharedContent,
  };
}

/**
 * Formats a clean, human-readable display identity from an Instagram profile.
 * Priority: "Name (@username)" -> "@username" -> "Name" -> null.
 * Rejects "Instagram User", empty strings, and raw numeric provider IDs.
 */
export function formatInstagramDisplayName({ name = null, username = null } = {}) {
  const cleanName = typeof name === 'string' && name.trim() && name.trim().toLowerCase() !== 'instagram user' && !/^\d+$/.test(name.trim())
    ? name.trim()
    : null;
  const cleanUsername = typeof username === 'string' && username.trim() && !/^\d+$/.test(username.trim())
    ? username.trim().replace(/^@/, '')
    : null;

  if (cleanName && cleanUsername) {
    return `${cleanName} (@${cleanUsername})`;
  }
  if (cleanUsername) {
    return `@${cleanUsername}`;
  }
  if (cleanName) {
    return cleanName;
  }
  return null;
}

export async function resolveInstagramUserProfile({
  senderIgsid,
  accessToken,
  http = axios,
  graphBaseUrl = null,
  authMode = null,
}) {
  if (!senderIgsid || !accessToken) return null;
  const cleanId = String(senderIgsid).replace(/^instagram:\s*/i, '').trim();
  if (!cleanId || !/^\d+$/.test(cleanId)) return null;

  const cached = profileCache.get(cleanId);
  if (cached && Date.now() - cached.fetchedAt < 3600 * 1000) {
    if (cached.name || cached.username) return cached;
  }

  const token = accessToken.trim();
  const fbBase = metaGraphApiBase();
  const igBase = instagramGraphApiBase();

  const isInstagramLoginToken = String(authMode || '').trim().toUpperCase() === 'INSTAGRAM_LOGIN'
    || token.startsWith('IGA')
    || token.startsWith('IGQ');

  const baseUrls = isInstagramLoginToken
    ? Array.from(new Set([graphBaseUrl, igBase, fbBase].filter(Boolean)))
    : Array.from(new Set([graphBaseUrl, fbBase, igBase].filter(Boolean)));

  const fieldSets = [
    'name,username,profile_pic',
    'name,username',
    'username',
    'name',
  ];

  for (const baseUrl of baseUrls) {
    for (const fields of fieldSets) {
      try {
        const res = await http.get(`${baseUrl}/${cleanId}`, {
          params: { fields, access_token: token },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 4000,
        });

        const name = typeof res.data?.name === 'string' && res.data.name.trim() && res.data.name.trim().toLowerCase() !== 'instagram user' && !/^\d+$/.test(res.data.name.trim())
          ? res.data.name.trim()
          : null;
        const username = typeof res.data?.username === 'string' && res.data.username.trim() && !/^\d+$/.test(res.data.username.trim())
          ? res.data.username.trim().replace(/^@/, '')
          : null;

        if (name || username) {
          const profile = { name, username, fetchedAt: Date.now() };
          profileCache.set(cleanId, profile);
          return profile;
        }
      } catch (err) {
        // Continue fallback attempts across fieldSets and baseUrls
      }
    }
  }

  // Conversation participants fallback (reliably exposes username & name from Meta conversations node)
  for (const baseUrl of baseUrls) {
    try {
      const convRes = await http.get(`${baseUrl}/me/conversations`, {
        params: {
          fields: 'id,participants{id,username,name}',
          limit: 10,
          access_token: token,
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });

      const convList = Array.isArray(convRes.data?.data) ? convRes.data.data : [];
      for (const c of convList) {
        const parts = Array.isArray(c?.participants?.data) ? c.participants.data : [];
        const match = parts.find((p) => String(p?.id || '').trim() === cleanId);
        if (match) {
          const name = typeof match.name === 'string' && match.name.trim() && match.name.trim().toLowerCase() !== 'instagram user' && !/^\d+$/.test(match.name.trim())
            ? match.name.trim()
            : null;
          const username = typeof match.username === 'string' && match.username.trim() && !/^\d+$/.test(match.username.trim())
            ? match.username.trim().replace(/^@/, '')
            : null;

          if (name || username) {
            const profile = { name, username, fetchedAt: Date.now() };
            profileCache.set(cleanId, profile);
            return profile;
          }
        }
      }
    } catch {
      // Continue
    }
  }

  return null;
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
            ci.id AS integration_id, ci.enabled AS integration_enabled,
            ci.updated_at AS integration_updated_at, ci.config AS config
       FROM tenant_channels tc
       JOIN tenants t ON t.id = tc.tenant_id AND t.status = 'active'
       LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
       JOIN channel_integrations ci ON ci.channel_id = tc.id
        AND ci.tenant_id = tc.tenant_id
        AND ci.integration_type = 'INSTAGRAM'
        AND ci.enabled = TRUE
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
      ORDER BY tc.updated_at DESC, ci.updated_at DESC`,
    [cleanId, normalizedId]
  );

  const canonicalOwners = new Map();
  for (const row of result.rows) {
    const ownerKey = `${row.tenant_id}:${row.channel_id}`;
    if (!canonicalOwners.has(ownerKey)) canonicalOwners.set(ownerKey, row);
  }

  if (canonicalOwners.size === 1) {
    const row = canonicalOwners.values().next().value;
    return {
      ...row,
      external_channel_id: cleanId,
      config: row.config || {},
    };
  }

  if (canonicalOwners.size > 1) {
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
      (tenant_id, channel_id, external_conversation_id, customer_external_id, ai_behavior_override, last_activity_at)
     VALUES ($1, $2, $3, $4, 'AI_ONLY', CURRENT_TIMESTAMP)
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
  http = axios,
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

    console.info(
      `INSTAGRAM_TENANT_RESOLVED tenant=${tenantId ? String(tenantId).slice(0, 8) : 'unmapped'}` +
      ` channel=${channelId ? String(channelId).slice(0, 8) : 'none'}`
    );

    const conversation = await upsertInstagramConversation(client, {
      tenantId,
      channelId,
      senderIgsid,
    });

    const conversationId = conversation.id;

    let resolvedDisplayName = null;
    const token = integration.config?.access_token ||
      process.env.INSTAGRAM_ACCESS_TOKEN ||
      process.env.INSTAGRAM_PAGE_ACCESS_TOKEN ||
      process.env.META_ACCESS_TOKEN;

    if (token && senderIgsid) {
      try {
        const profile = await resolveInstagramUserProfile({
          senderIgsid,
          accessToken: token,
          http,
          authMode: integration.config?.auth_mode || null,
        });
        if (profile) {
          resolvedDisplayName = formatInstagramDisplayName(profile);
        }
      } catch {}
    }

    console.info(
      `INSTAGRAM_IDENTITY_RESOLVED sender_prefix=${senderIgsid ? String(senderIgsid).slice(0, 8) : 'none'}` +
      ` has_display_name=${Boolean(resolvedDisplayName)}`
    );

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
          displayName: resolvedDisplayName,
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

    console.info(
      `INSTAGRAM_CONVERSATION_RESOLVED conversation=${conversationId.slice(0, 8)}` +
      ` ai_behavior=${conversation.ai_behavior_override || 'AI_ONLY'}` +
      ` handling_mode=${conversation.handling_mode}`
    );



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

    if (!messageText && attachments.length === 0) {
      await client.query('COMMIT');
      return {
        duplicate: true,
        integration,
        conversation,
        shouldInvokeAi: false,
      };
    }

    // Insert canonical message into conversation_messages
    const priorMsgCheck = await client.query(
      `SELECT count(*)::int AS count FROM conversation_messages WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenantId, conversationId]
    );
    const priorCount = Number(priorMsgCheck.rows[0]?.count || 0);

    // If conversation or contact was on first-contact hold or undecided,
    // transition conversation to AI_ONLY for immediate canonical AI response
    if (conversation.ai_behavior_override === 'FIRST_CONTACT_HOLD' || conversation.ai_behavior_override === 'UNDECIDED') {
      await client.query(
        `UPDATE conversations
            SET ai_behavior_override = 'AI_ONLY',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND tenant_id = $2 AND ai_behavior_override IN ('FIRST_CONTACT_HOLD', 'UNDECIDED')`,
        [conversationId, tenantId]
      );
      conversation.ai_behavior_override = 'AI_ONLY';
      if (conversation.contact_ai_behavior_override === 'FIRST_CONTACT_HOLD' || conversation.contact_ai_behavior_override === 'UNDECIDED') {
        conversation.contact_ai_behavior_override = 'AI_ONLY';
      }
    }

    console.info(`INSTAGRAM_IDENTITY_RESOLVED identity_hash=${conversation?.customer_external_id ? String(conversation.customer_external_id).slice(0, 16) : 'none'} source=${sourceKind}`);

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
        const attachmentType = String(att.type || '').toLowerCase();
        const category = att.type === 'image' || attachmentType === 'reel' ? 'IMAGE'
          : att.type === 'audio' ? 'AUDIO'
          : att.type === 'video' ? 'IMAGE'
          : 'DOCUMENT';

        await createConversationResource(client, {
          tenantId,
          conversationId,
          messageId: customerMessage.id,
          sourceType: 'URL',
          mediaCategory: category,
          originalFilename: att.title || (attachmentType === 'reel' ? 'Instagram Reel' : attachmentType === 'post' ? 'Instagram Shared Post' : `instagram_${att.type}`),
          mimeType: attachmentType === 'reel' ? 'video/mp4' : null,
          sourceUrl: att.url,
          sourceReference: `instagram:${att.type}:${messageId || customerMessage.id}`,
          processingStatus: 'READY',
          metadata: buildInstagramAttachmentResourceMetadata(att),
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
/**
 * Reconciles existing placeholder Instagram contacts ("Instagram User") with live Meta profiles.
 * Purely passive: 0 AI executions, 0 outbound Meta sends, 0 push notifications, 0 typing, 0 CTA.
 */
export async function reconcileTenantInstagramContactIdentities({
  tenantId = null,
  database = pool,
  http = axios,
} = {}) {
  const isPool = typeof database?.connect === 'function' && typeof database?.query !== 'function';
  const client = isPool ? await database.connect() : database;
  try {
    const params = [];
    let tenantFilter = '';
    if (tenantId) {
      params.push(tenantId);
      tenantFilter = `AND c.tenant_id = $${params.length}`;
    }

    const placeholderContacts = await client.query(
      `SELECT c.id AS contact_id, c.tenant_id, c.display_name, c.identity_hash,
              conv.id AS conversation_id, conv.customer_external_id,
              ci.config AS integration_config, tc.external_channel_id
         FROM crm_contacts c
         JOIN conversations conv ON conv.contact_id = c.id AND conv.tenant_id = c.tenant_id
         JOIN tenant_channels tc ON tc.id = conv.channel_id AND tc.tenant_id = c.tenant_id
         JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = c.tenant_id AND ci.integration_type = 'INSTAGRAM' AND ci.enabled = TRUE
        WHERE tc.channel_type = 'INSTAGRAM'
          ${tenantFilter}
          AND (c.display_name IS NULL OR c.display_name = '' OR c.display_name = 'Instagram User' OR c.display_name LIKE 'instagram:%' OR c.display_name ~ '^\\d+$')
        LIMIT 50`,
      params
    );

    let updatedCount = 0;
    for (const row of placeholderContacts.rows) {
      const rawExternal = String(row.customer_external_id || '').replace(/^instagram:\s*/i, '').trim();
      const token = row.integration_config?.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
      if (!rawExternal || !token || !/^\d+$/.test(rawExternal)) continue;

      const profile = await resolveInstagramUserProfile({
        senderIgsid: rawExternal,
        accessToken: token,
        http,
        authMode: row.integration_config?.auth_mode || null,
      });

      if (profile?.name || profile?.username) {
        const enrichedName = formatInstagramDisplayName(profile);
        if (enrichedName) {
          await client.query(
            `UPDATE crm_contacts
                SET display_name = $1,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $2 AND tenant_id = $3`,
            [enrichedName, row.contact_id, row.tenant_id]
          );
          updatedCount++;
        }
      }
    }

    return { totalScanned: placeholderContacts.rowCount, updatedCount };
  } catch (err) {
    console.warn('INSTAGRAM_CONTACT_RECONCILIATION_WARN', err?.message);
    return { error: err?.message, updatedCount: 0 };
  } finally {
    if (isPool && typeof client?.release === 'function') client.release();
  }
}


