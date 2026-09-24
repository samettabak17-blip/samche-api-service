import { deliverWhatsAppText, deliverWhatsAppMedia, WhatsAppDeliveryError } from './whatsapp-delivery-service.js';
import { deliverInstagramText, deliverInstagramMedia, InstagramDeliveryError } from './instagram-delivery-service.js';
import { normalizeWhatsAppExternalId } from './whatsapp-channel-ownership-service.js';
import { normalizeChannelType } from './channel-routing-service.js';
import { loadPlatformLifecycleMessages, renderPlatformLifecycleMessage } from './platform-lifecycle-message-service.js';

export class ChannelDeliveryError extends Error {
  constructor(status, message, code = 'CHANNEL_DELIVERY_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Loads active WhatsApp channel and integration details for an agent delivery.
 */
export async function loadWhatsAppAgentDelivery(client, conversation) {
  const channelId = conversation?.channel_id;
  const tenantId = conversation?.tenant_id ?? conversation?.tenantId;
  if (!channelId || !tenantId) return null;

  const result = await client.query(
    `SELECT tc.id AS channel_id, tc.tenant_id, tc.external_channel_id, tc.channel_type, tc.status AS channel_status,
            ci.id AS integration_id, ci.integration_key, ci.enabled AS integration_enabled
       FROM tenant_channels tc
       LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND UPPER(ci.integration_type) = 'WHATSAPP'
      WHERE tc.id = $1
        AND tc.tenant_id = $2
        AND UPPER(tc.channel_type) = 'WHATSAPP'
        AND LOWER(tc.status) = 'active'`,
    [channelId, tenantId]
  );
  if (result.rowCount < 1) return null;
  const row = result.rows[0];
  const rawPhone = String(row.external_channel_id ?? conversation.external_channel_id ?? '').trim();
  let cleanPhone = '';
  try {
    cleanPhone = normalizeWhatsAppExternalId(rawPhone);
  } catch {
    cleanPhone = rawPhone.replace(/^whatsapp:\s*/i, '').replace(/[^0-9]/g, '');
  }
  if (!cleanPhone && !rawPhone) return null;

  const canonicalKey = `whatsapp:${cleanPhone || rawPhone}`;
  if (!row.integration_id || !row.integration_enabled) {
    try {
      await client.query(
        `INSERT INTO channel_integrations
           (integration_key, integration_type, tenant_id, channel_id, enabled)
         VALUES ($1, 'WHATSAPP', $2, $3, TRUE)
         ON CONFLICT (integration_key)
         DO UPDATE SET channel_id = EXCLUDED.channel_id,
                       tenant_id = EXCLUDED.tenant_id,
                       enabled = TRUE,
                       updated_at = CURRENT_TIMESTAMP`,
        [canonicalKey, tenantId, channelId]
      );
    } catch {
      // Non-fatal if another transaction converged it concurrently
    }
  }

  return {
    channel_id: channelId,
    tenant_id: tenantId,
    external_channel_id: cleanPhone || rawPhone,
    integration_key: row.integration_key || canonicalKey,
  };
}

/**
 * Loads active Instagram channel and integration credentials for an agent delivery.
 */
export async function loadInstagramAgentDelivery(client, conversation) {
  const channelId = conversation?.channel_id;
  const tenantId = conversation?.tenant_id ?? conversation?.tenantId;
  if (!channelId || !tenantId) return null;

  const result = await client.query(
    `SELECT tc.id AS channel_id, tc.tenant_id, tc.external_channel_id, tc.channel_type, tc.status AS channel_status,
            ci.id AS integration_id, ci.integration_key, ci.enabled AS integration_enabled, ci.config
       FROM tenant_channels tc
       LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND UPPER(ci.integration_type) = 'INSTAGRAM'
      WHERE tc.id = $1
        AND tc.tenant_id = $2
        AND UPPER(tc.channel_type) = 'INSTAGRAM'
        AND LOWER(tc.status) = 'active'`,
    [channelId, tenantId]
  );
  if (result.rowCount < 1) return null;
  const row = result.rows[0];
  const config = row.config || {};
  const accessToken = config.access_token || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || null;
  const pageId = config.page_id || config.instagram_business_account_id || row.external_channel_id || 'me';

  if (!accessToken) return null;

  return {
    channel_id: channelId,
    tenant_id: tenantId,
    external_channel_id: row.external_channel_id,
    page_id: pageId,
    access_token: accessToken,
    config,
  };
}

/**
 * Loads platform lifecycle notice text for a given conversation.
 */
export async function loadHumanSupportLifecycleNotice(client, conversation, templateKey) {
  try {
    const key = templateKey === 'manual_takeover' ? 'human_takeover' : templateKey;
    const templates = await loadPlatformLifecycleMessages({ database: client });
    return renderPlatformLifecycleMessage({ templates, key, locale: conversation.communication_language });
  } catch (error) {
    if (error?.status) throw error;
    console.error('LIFECYCLE_TEMPLATE_LOAD_FAILED', error?.code ?? error?.message);
    throw new ChannelDeliveryError(500, 'Lifecycle message template could not be loaded', error?.code ?? 'PLATFORM_LIFECYCLE_ERROR');
  }
}

/**
 * Delivers a WhatsApp lifecycle notice using typing and pacing.
 */
export async function deliverWhatsAppLifecycleNotice({
  client,
  tenantId,
  conversationId,
  conversation,
  content,
  integration,
  deliverWhatsApp = deliverWhatsAppText,
  sendTyping,
  applyPacing,
}) {
  let lastCustomerMessageId = null;
  try {
    const lastCustomerMsg = await client.query(
      `SELECT external_message_id FROM conversation_messages
        WHERE tenant_id = $1 AND conversation_id = $2 AND sender_type = 'CUSTOMER' AND external_message_id IS NOT NULL
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tenantId, conversationId]
    );
    lastCustomerMessageId = lastCustomerMsg.rows?.[0]?.external_message_id ?? null;
  } catch (err) {
    console.warn('LIFECYCLE_TYPING_WAMID_LOOKUP_FAILED', err?.message);
  }

  let typingAttempted = false;
  let typingSucceeded = false;
  if (lastCustomerMessageId && typeof sendTyping === 'function') {
    typingAttempted = true;
    const typingStartedAt = Date.now();
    try {
      const outcome = await sendTyping({
        phoneNumberId: integration.external_channel_id,
        incomingMessageId: lastCustomerMessageId,
      });
      typingSucceeded = outcome?.ok !== false;
    } catch (err) {
      console.warn('LIFECYCLE_TYPING_NON_BLOCKING_ERROR', err?.message);
    }
    if (typingSucceeded && typeof applyPacing === 'function') {
      try {
        await applyPacing({
          generationStartedAt: typingStartedAt,
          content,
        });
      } catch {}
    }
  }

  console.info(
    'LIFECYCLE_TYPING_DIAGNOSTIC'
    + ' tenant=' + String(tenantId).slice(0, 8)
    + ' conversation=' + String(conversationId).slice(0, 8)
    + ' typing_attempted=' + (typingAttempted ? '1' : '0')
    + ' typing_succeeded=' + (typingSucceeded ? '1' : '0')
    + ' wamid=' + (lastCustomerMessageId ? 'RESOLVED' : 'NONE')
  );

  return deliverWhatsApp({
    phoneNumberId: integration.external_channel_id,
    recipient: conversation.customer_external_id,
    content,
  });
}

/**
 * Outbound Channel Delivery Registry
 */
export class OutboundChannelDeliveryRegistry {
  constructor() {
    this._adapters = new Map();
    this._registerDefaultAdapters();
  }

  _registerDefaultAdapters() {
    // WHATSAPP
    this.registerAdapter('WHATSAPP', {
      async getDeliveryCapability(client, conversation) {
        const integration = await loadWhatsAppAgentDelivery(client, conversation);
        return {
          channelType: 'WHATSAPP',
          configured: Boolean(integration),
        };
      },

      async deliverTextMessage({ client, conversation, content, deliverWhatsApp = deliverWhatsAppText, traceStage }) {
        const integration = await loadWhatsAppAgentDelivery(client, conversation);
        if (!integration) {
          throw new ChannelDeliveryError(409, 'WhatsApp delivery is not configured for this conversation', 'WHATSAPP_DELIVERY_NOT_CONFIGURED');
        }
        traceStage?.('DELIVERY_STARTED');
        try {
          await deliverWhatsApp({
            phoneNumberId: integration.external_channel_id,
            recipient: conversation.customer_external_id,
            content,
          });
        } catch (error) {
          if (error instanceof WhatsAppDeliveryError) {
            const status = error.code === 'WHATSAPP_DELIVERY_NOT_CONFIGURED' || error.code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH' ? 409 : 502;
            throw new ChannelDeliveryError(status, 'WhatsApp delivery could not be completed', error.code);
          }
          throw new ChannelDeliveryError(502, 'WhatsApp delivery could not be completed', 'WHATSAPP_DELIVERY_FAILED');
        }
        traceStage?.('DELIVERY_SUCCEEDED');
        return { delivery: 'SENT_TO_WHATSAPP' };
      },

      async deliverMediaMessage({ client, conversation, file, mediaCategory, caption, deliverMedia = deliverWhatsAppMedia, traceMediaStage }) {
        const integration = await loadWhatsAppAgentDelivery(client, conversation);
        if (!integration) {
          throw new ChannelDeliveryError(409, 'WhatsApp delivery is not configured for this conversation', 'WHATSAPP_DELIVERY_NOT_CONFIGURED');
        }
        try {
          traceMediaStage?.('WHATSAPP_MEDIA_UPLOAD_AND_SEND');
          const deliveryResult = await deliverMedia({
            phoneNumberId: integration.external_channel_id,
            recipient: conversation.customer_external_id,
            file,
            mediaCategory,
            caption,
          });
          if (!String(deliveryResult?.providerMessageId ?? '').trim()) {
            throw new WhatsAppDeliveryError('WHATSAPP_MEDIA_SEND_UNCORRELATED');
          }
          traceMediaStage?.('WHATSAPP_PROVIDER_ACCEPTED');
          return {
            delivery: 'SENT_TO_WHATSAPP',
            mediaId: deliveryResult.mediaId ?? null,
            providerMessageId: deliveryResult.providerMessageId,
          };
        } catch (error) {
          if (error instanceof WhatsAppDeliveryError) {
            const status = error.code === 'WHATSAPP_DELIVERY_NOT_CONFIGURED' || error.code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH' ? 409 : 502;
            throw new ChannelDeliveryError(status, 'WhatsApp media delivery could not be completed', error.code);
          }
          throw new ChannelDeliveryError(502, 'WhatsApp media delivery could not be completed', 'WHATSAPP_MEDIA_SEND_FAILED');
        }
      },

      async deliverLifecycleNotice({ client, tenantId, conversationId, conversation, eventType, deliverWhatsApp, sendTyping, applyPacing }) {
        const content = await loadHumanSupportLifecycleNotice(client, conversation, eventType);
        const integration = await loadWhatsAppAgentDelivery(client, conversation);
        if (!content || !integration) {
          throw new ChannelDeliveryError(409, 'WhatsApp human delivery is not configured for this conversation', 'WHATSAPP_DELIVERY_NOT_CONFIGURED');
        }
        try {
          await deliverWhatsAppLifecycleNotice({
            client,
            tenantId,
            conversationId,
            conversation,
            content,
            integration,
            deliverWhatsApp,
            sendTyping,
            applyPacing,
          });
        } catch (error) {
          const code = error instanceof WhatsAppDeliveryError ? error.code : 'WHATSAPP_DELIVERY_FAILED';
          throw new ChannelDeliveryError(code === 'WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH' ? 409 : 502, 'WhatsApp delivery could not be completed', code);
        }
        return { handled: true, content, persistAssistantMessage: true, persistPublicAssistantMessage: false };
      },
    });

    // SAMCHEGUIDE & WEB_CHAT
    const publicFeedAdapter = (channelType) => ({
      async getDeliveryCapability() {
        return { channelType, configured: true };
      },

      async deliverTextMessage() {
        return { delivery: 'AVAILABLE_TO_SAMCHEGUIDE' };
      },

      async deliverMediaMessage() {
        return { delivery: 'AVAILABLE_TO_SAMCHEGUIDE', mediaId: null, providerMessageId: null };
      },

      async deliverLifecycleNotice({ client, conversation, eventType }) {
        if (eventType === 'return_to_ai') {
          const content = await loadHumanSupportLifecycleNotice(client, conversation, 'return_to_ai');
          return { handled: false, content, persistAssistantMessage: true, persistPublicAssistantMessage: true };
        }
        return { handled: false, content: null, persistAssistantMessage: false, persistPublicAssistantMessage: false };
      },
    });

    this.registerAdapter('SAMCHEGUIDE', publicFeedAdapter('SAMCHEGUIDE'));
    this.registerAdapter('WEB_CHAT', publicFeedAdapter('WEB_CHAT'));

    // INSTAGRAM
    this.registerAdapter('INSTAGRAM', {
      async getDeliveryCapability(client, conversation) {
        const integration = await loadInstagramAgentDelivery(client, conversation);
        return {
          channelType: 'INSTAGRAM',
          configured: Boolean(integration),
        };
      },

      async deliverTextMessage({ client, conversation, content, http, traceStage }) {
        const integration = await loadInstagramAgentDelivery(client, conversation);
        if (!integration) {
          throw new ChannelDeliveryError(409, 'Instagram delivery is not configured for this conversation', 'INSTAGRAM_DELIVERY_NOT_CONFIGURED');
        }
        traceStage?.('DELIVERY_STARTED');
        const recipientIgsid = String(conversation.customer_external_id ?? '').replace(/^instagram:\s*/i, '');
        try {
          const result = await deliverInstagramText({
            recipientId: recipientIgsid,
            content,
            accessToken: integration.access_token,
            pageId: integration.page_id,
            http,
          });
          traceStage?.('DELIVERY_SUCCEEDED');
          return result;
        } catch (error) {
          if (error instanceof InstagramDeliveryError) {
            throw new ChannelDeliveryError(error.status, error.message, error.code);
          }
          throw new ChannelDeliveryError(502, 'Instagram delivery could not be completed', 'INSTAGRAM_DELIVERY_FAILED');
        }
      },

      async deliverMediaMessage({ client, conversation, file, mediaCategory, caption, http, traceMediaStage }) {
        const integration = await loadInstagramAgentDelivery(client, conversation);
        if (!integration) {
          throw new ChannelDeliveryError(409, 'Instagram media delivery is not configured for this conversation', 'INSTAGRAM_DELIVERY_NOT_CONFIGURED');
        }
        traceMediaStage?.('INSTAGRAM_MEDIA_DELIVERY');
        const recipientIgsid = String(conversation.customer_external_id ?? '').replace(/^instagram:\s*/i, '');
        try {
          const mediaUrl = file?.url || (file?.storageKey ? `/api/v1/resources/${file.storageKey}` : null);
          if (!mediaUrl) {
            throw new ChannelDeliveryError(400, 'Instagram media requires a valid public or storage URL', 'INSTAGRAM_MEDIA_URL_REQUIRED');
          }
          const result = await deliverInstagramMedia({
            recipientId: recipientIgsid,
            mediaUrl,
            mediaCategory,
            caption,
            accessToken: integration.access_token,
            pageId: integration.page_id,
            http,
          });
          return result;
        } catch (error) {
          if (error instanceof InstagramDeliveryError) {
            throw new ChannelDeliveryError(error.status, error.message, error.code);
          }
          throw new ChannelDeliveryError(502, 'Instagram media delivery could not be completed', 'INSTAGRAM_MEDIA_SEND_FAILED');
        }
      },

      async deliverLifecycleNotice({ client, conversation, eventType }) {
        if (eventType === 'return_to_ai') {
          const content = await loadHumanSupportLifecycleNotice(client, conversation, 'return_to_ai');
          return { handled: false, content, persistAssistantMessage: true, persistPublicAssistantMessage: true };
        }
        return { handled: false, content: null, persistAssistantMessage: false, persistPublicAssistantMessage: false };
      },
    });
  }

  registerAdapter(channelType, adapter) {
    const normalized = normalizeChannelType(channelType);
    if (normalized) {
      this._adapters.set(normalized, adapter);
    }
  }

  getAdapter(channelType) {
    const normalized = normalizeChannelType(channelType);
    return (normalized ? this._adapters.get(normalized) : null) ?? null;
  }

  async getDeliveryCapability(client, conversation) {
    const channelType = String(conversation?.channel_type ?? '').toUpperCase();
    const adapter = this.getAdapter(channelType);
    if (!adapter) {
      return { channelType, configured: false };
    }
    return adapter.getDeliveryCapability(client, conversation);
  }

  async deliverTextMessage(params) {
    const channelType = String(params?.conversation?.channel_type ?? '').toUpperCase();
    const adapter = this.getAdapter(channelType);
    if (!adapter) {
      throw new ChannelDeliveryError(409, 'Human delivery is not configured for this channel', 'CHANNEL_DELIVERY_UNSUPPORTED');
    }
    return adapter.deliverTextMessage(params);
  }

  async deliverMediaMessage(params) {
    const channelType = String(params?.conversation?.channel_type ?? '').toUpperCase();
    const adapter = this.getAdapter(channelType);
    if (!adapter) {
      throw new ChannelDeliveryError(409, 'Media delivery is not configured for this channel', 'CHANNEL_DELIVERY_UNSUPPORTED');
    }
    return adapter.deliverMediaMessage(params);
  }

  async deliverLifecycleNotice(params) {
    const channelType = String(params?.conversation?.channel_type ?? '').toUpperCase();
    const adapter = this.getAdapter(channelType);
    if (!adapter) {
      return { handled: false, content: null, persistAssistantMessage: false, persistPublicAssistantMessage: false };
    }
    return adapter.deliverLifecycleNotice(params);
  }
}

export const channelDeliveryRegistry = new OutboundChannelDeliveryRegistry();
