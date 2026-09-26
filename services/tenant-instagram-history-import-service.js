import crypto from 'node:crypto';
import axios from 'axios';
import pool from '../config/db.js';
import { instagramGraphApiBase, metaGraphApiBase } from './meta-graph-api-version.js';
import { instagramCustomerReference, instagramExternalConversationId, resolveInstagramUserProfile } from './instagram-live-inbox-service.js';


export class TenantInstagramHistoryImportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'TenantInstagramHistoryImportError';
    this.code = code;
    this.status = status;
  }
}

function resolveCustomerParticipant(participants, myAccountIds = []) {
  if (!Array.isArray(participants) || participants.length === 0) return null;
  const myIdSet = new Set(myAccountIds.filter(Boolean).map(String));
  const customer = participants.find((p) => p?.id && !myIdSet.has(String(p.id)));
  if (customer) return customer;
  return participants[0];
}

/**
 * Imports historical Instagram conversations and messages for a tenant via official Meta Graph API.
 * Passive data ingestion: ZERO AI, ZERO outbound, ZERO notifications, ZERO side effects.
 * Idempotent: safe to run multiple times without duplicates.
 */
export async function importTenantInstagramHistory({
  tenantId,
  database = pool,
  limit = 100,
  http = axios,
  graphBaseUrl = null,
}) {
  if (!tenantId) {
    throw new TenantInstagramHistoryImportError('TENANT_ID_REQUIRED', 'Tenant ID is required', 400);
  }

  const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
  const client = await database.connect();

  try {
    const channelRes = await client.query(
      `SELECT tc.id AS channel_id, tc.tenant_id, tc.external_channel_id, tc.assistant_id,
              ci.config AS integration_config
         FROM tenant_channels tc
         JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
        WHERE tc.tenant_id = $1 AND tc.channel_type = 'INSTAGRAM' AND tc.status = 'active'
        LIMIT 1`,
      [tenantId]
    );

    if (channelRes.rowCount < 1) {
      throw new TenantInstagramHistoryImportError('INSTAGRAM_NOT_CONNECTED', 'Active Instagram channel not found for this tenant', 404);
    }

    const channel = channelRes.rows[0];
    const config = channel.integration_config || {};
    const accessToken = config.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;

    if (!accessToken) {
      throw new TenantInstagramHistoryImportError('INSTAGRAM_TOKEN_MISSING', 'Instagram access token is not configured for this tenant', 400);
    }

    const myUserId = config.instagram_user_id || null;
    const myBusinessAccountId = config.instagram_business_account_id || config.instagram_account_id || config.page_id || channel.external_channel_id || 'me';
    const accountUsername = config.account_username || null;
    const myAccountIds = [myUserId, myBusinessAccountId, channel.external_channel_id, 'me'].filter(Boolean);

    const baseUrl = graphBaseUrl || (config.auth_mode === 'FACEBOOK_LOGIN' ? metaGraphApiBase() : instagramGraphApiBase());
    const targetAccountId = myBusinessAccountId || 'me';

    let allMetaConversations = [];
    let nextUrl = `${baseUrl}/${targetAccountId}/conversations`;
    let isFirstPage = true;

    while (nextUrl && allMetaConversations.length < boundedLimit) {
      const pageLimit = Math.min(boundedLimit - allMetaConversations.length, 50);
      try {
        let res;
        if (isFirstPage) {
          res = await http.get(nextUrl, {
            params: {
              fields: 'id,updated_time,participants,messages{id,created_time,from,to,message,attachments}',
              limit: pageLimit,
              access_token: accessToken,
            },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 15000,
          });
          isFirstPage = false;
        } else {
          res = await http.get(nextUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 15000,
          });
        }

        const data = Array.isArray(res.data?.data) ? res.data.data : [];
        if (data.length === 0) break;

        allMetaConversations = allMetaConversations.concat(data);
        nextUrl = res.data?.paging?.next || null;
      } catch (err) {
        if (isFirstPage && targetAccountId !== 'me') {
          try {
            const fallbackRes = await http.get(`${baseUrl}/me/conversations`, {
              params: {
                fields: 'id,updated_time,participants,messages{id,created_time,from,to,message,attachments}',
                limit: pageLimit,
                access_token: accessToken,
              },
              headers: { Authorization: `Bearer ${accessToken}` },
              timeout: 15000,
            });
            const fbData = Array.isArray(fallbackRes.data?.data) ? fallbackRes.data.data : [];
            allMetaConversations = fbData;
            break;
          } catch (fbErr) {
            console.warn('INSTAGRAM_HISTORY_FETCH_FALLBACK_WARN', fbErr?.response?.data?.error?.message || fbErr?.message);
          }
        }
        console.warn('INSTAGRAM_HISTORY_FETCH_WARN', err?.response?.data?.error?.message || err?.message);
        break;
      }
    }

    allMetaConversations = allMetaConversations.slice(0, boundedLimit);

    let conversationsImported = 0;
    let messagesImported = 0;
    let duplicatesSkipped = 0;
    let failedConversations = 0;

    for (const metaConv of allMetaConversations) {

      try {
        await client.query('BEGIN');
        const rawParticipants = Array.isArray(metaConv.participants?.data)
          ? metaConv.participants.data
          : (Array.isArray(metaConv.participants) ? metaConv.participants : []);

        const customerParticipant = resolveCustomerParticipant(rawParticipants, myAccountIds);
        const customerIgsid = customerParticipant?.id ||
          (metaConv.messages?.data?.[0]?.from?.id !== myUserId ? metaConv.messages?.data?.[0]?.from?.id : null) ||
          metaConv.id;

        let custName = customerParticipant?.name || null;
        let custUsername = customerParticipant?.username || null;

        if (!custName && !custUsername && customerIgsid) {
          try {
            const profile = await resolveInstagramUserProfile({
              senderIgsid: customerIgsid,
              accessToken,
              http,
            });
            if (profile?.name) custName = profile.name;
            if (profile?.username) custUsername = profile.username;
          } catch {}
        }

        let customerDisplayName = null;
        if (custName && custUsername) {
          customerDisplayName = `${custName} (@${custUsername.replace(/^@/, '')})`;
        } else if (custUsername) {
          customerDisplayName = `@${custUsername.replace(/^@/, '')}`;
        } else if (custName) {
          customerDisplayName = custName;
        }


        const custRef = instagramCustomerReference(customerIgsid);
        const extConvId = instagramExternalConversationId(customerIgsid);

        const identityHash = crypto.createHash('sha256').update(`${tenantId}:EXTERNAL_CUSTOMER:${custRef.toLowerCase()}`).digest('hex');

        const contactRes = await client.query(
          `INSERT INTO crm_contacts
            (tenant_id, identity_kind, identity_hash, display_name, source, created_at, updated_at)
           VALUES ($1, 'EXTERNAL_CUSTOMER', $2, $3, 'INSTAGRAM', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (tenant_id, identity_hash)
           DO UPDATE SET
             display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), crm_contacts.display_name),
             updated_at = CURRENT_TIMESTAMP
           RETURNING id, ai_behavior_override`,
          [tenantId, identityHash, customerDisplayName]
        );


        const contact = contactRes.rows[0];
        const contactOverride = contact.ai_behavior_override && contact.ai_behavior_override !== 'UNDECIDED'
          ? contact.ai_behavior_override
          : 'FIRST_CONTACT_HOLD';

        const convRes = await client.query(
          `INSERT INTO conversations
            (tenant_id, channel_id, external_conversation_id, customer_external_id, contact_id, status, handling_mode, ai_behavior_override, created_at, last_activity_at)
           VALUES ($1, $2, $3, $4, $5, 'open', 'AI', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (channel_id, external_conversation_id)
           DO UPDATE SET
             contact_id = COALESCE(conversations.contact_id, EXCLUDED.contact_id),
             customer_external_id = EXCLUDED.customer_external_id,
             updated_at = CURRENT_TIMESTAMP
           RETURNING id, status, ai_behavior_override`,
          [tenantId, channel.id, extConvId, custRef, contact.id, contactOverride]
        );

        const conversation = convRes.rows[0];
        const conversationId = conversation.id;
        conversationsImported++;

        const rawMessages = Array.isArray(metaConv.messages?.data)
          ? metaConv.messages.data
          : (Array.isArray(metaConv.messages) ? metaConv.messages : []);

        const messages = [...rawMessages].sort((a, b) => {
          const timeA = new Date(a.created_time || 0).getTime();
          const timeB = new Date(b.created_time || 0).getTime();
          return timeA - timeB;
        });

        for (const msg of messages) {
          const msgId = msg.id;
          if (!msgId) continue;

          const fromId = String(msg.from?.id || '');
          const fromUsername = String(msg.from?.username || '');

          const isFromMe = (fromId && myAccountIds.includes(fromId)) ||
            (accountUsername && fromUsername === accountUsername);

          const senderType = isFromMe ? 'AGENT' : 'CUSTOMER';
          let messageText = typeof msg.message === 'string' ? msg.message.trim() : '';

          if (!messageText && msg.attachments?.data?.length > 0) {
            const attType = msg.attachments.data[0]?.type || 'media';
            messageText = `[Attachment: ${attType}]`;
          }

          const messageCreatedAt = msg.created_time ? new Date(msg.created_time) : new Date();

          const insertRes = await client.query(
            `INSERT INTO conversation_messages
              (tenant_id, conversation_id, sender_type, content, external_message_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (conversation_id, external_message_id) DO NOTHING
             RETURNING id`,
            [tenantId, conversationId, senderType, messageText, msgId, messageCreatedAt]
          );

          if (insertRes.rowCount > 0) {
            messagesImported++;
          } else {
            duplicatesSkipped++;
          }
        }

        await client.query('COMMIT');
      } catch (convErr) {
        await client.query('ROLLBACK').catch(() => {});
        console.warn('INSTAGRAM_CONVERSATION_IMPORT_ERROR', convErr?.message);
        failedConversations++;
      }
    }

    return {
      success: true,
      status: failedConversations > 0 && conversationsImported > 0 ? 'PARTIAL' : (failedConversations > 0 && conversationsImported === 0 ? 'FAILED' : 'COMPLETED'),
      conversations_discovered: allMetaConversations.length,
      conversations_imported: conversationsImported,
      messages_imported: messagesImported,
      duplicates_skipped: duplicatesSkipped,
      failed_conversations: failedConversations,
    };
  } finally {
    client.release();
  }
}

