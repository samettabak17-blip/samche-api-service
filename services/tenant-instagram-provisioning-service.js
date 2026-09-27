import crypto from 'node:crypto';
import axios from 'axios';
import pool from '../config/db.js';
import { instagramGraphApiBase } from './meta-graph-api-version.js';

export class TenantInstagramProvisioningError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'TenantInstagramProvisioningError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Official required webhook fields for Instagram Messaging.
 */
export const CANONICAL_INSTAGRAM_WEBHOOK_FIELDS = Object.freeze([
  'messages',
  'messaging_postbacks',
  'messaging_referral',
  'messaging_seen',
]);

/**
 * Subscribes the Instagram Professional account to official webhook fields via Meta Graph API.
 * Uses official Instagram Login endpoint: POST https://graph.instagram.com/{version}/{account_id}/subscribed_apps?subscribed_fields=...
 */
export async function subscribeInstagramAccountToWebhooks({
  accountId = 'me',
  accessToken,
  fields = CANONICAL_INSTAGRAM_WEBHOOK_FIELDS,
  http = axios,
  graphBaseUrl = null,
}) {
  if (!accessToken) return { success: false, error: 'ACCESS_TOKEN_REQUIRED' };
  const baseUrl = graphBaseUrl || instagramGraphApiBase();
  const fieldsParam = Array.isArray(fields) ? fields.join(',') : fields;
  const targetId = String(accountId || 'me').trim();

  try {
    const res = await http.post(
      `${baseUrl}/${targetId}/subscribed_apps`,
      null,
      {
        params: {
          subscribed_fields: fieldsParam,
          access_token: accessToken,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000,
      }
    );
    const success = Boolean(res.data?.success || res.status === 200);
    return { success, fields: Array.isArray(fields) ? fields : fields.split(',') };
  } catch (err) {
    const metaError = err?.response?.data?.error;
    console.warn('INSTAGRAM_SUBSCRIBED_APPS_POST_WARN', metaError?.message || err?.message);
    return {
      success: false,
      error: metaError?.code ? `META_ERROR_${metaError.code}` : 'SUBSCRIPTION_FAILED',
      message: metaError?.message || err?.message,
    };
  }
}

/**
 * Queries the current subscribed apps and fields for the Instagram account.
 * Uses official Instagram Login endpoint: GET https://graph.instagram.com/{version}/{account_id}/subscribed_apps
 */
export async function getInstagramSubscribedApps({
  accountId = 'me',
  accessToken,
  http = axios,
  graphBaseUrl = null,
}) {
  if (!accessToken) return { subscribed: false, subscribed_fields: [] };
  const baseUrl = graphBaseUrl || instagramGraphApiBase();
  const targetId = String(accountId || 'me').trim();

  try {
    const res = await http.get(`${baseUrl}/${targetId}/subscribed_apps`, {
      params: { access_token: accessToken },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 8000,
    });
    const entries = Array.isArray(res.data?.data) ? res.data.data : [];
    const subscribed = entries.length > 0;
    const allFields = Array.from(new Set(entries.flatMap((e) => Array.isArray(e?.subscribed_fields) ? e.subscribed_fields : [])));
    return {
      subscribed,
      apps: entries,
      subscribed_fields: allFields,
    };
  } catch (err) {
    const metaError = err?.response?.data?.error;
    console.warn('INSTAGRAM_SUBSCRIBED_APPS_GET_WARN', metaError?.message || err?.message);
    return { subscribed: false, subscribed_fields: [], error: metaError?.message || err?.message };
  }
}

/**
 * Returns the sanitized Instagram connection status and configuration for a tenant.
 * Never leaks access tokens or raw secrets.
 */
export async function getTenantInstagramStatus({ database = pool, tenantId }) {
  if (!tenantId) throw new TenantInstagramProvisioningError('TENANT_ID_REQUIRED', 'Tenant ID is required', 400);

  const client = await database.connect();
  try {
    const result = await client.query(
      `SELECT tc.id AS channel_id, tc.tenant_id, tc.external_channel_id, tc.assistant_id,
              tc.display_name, tc.status AS channel_status, tc.created_at, tc.updated_at,
              a.name AS assistant_name,
              ci.id AS integration_id, ci.enabled AS integration_enabled, ci.config
         FROM tenant_channels tc
         LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
         LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id
          AND ci.integration_type = 'INSTAGRAM' AND ci.enabled = TRUE
        WHERE tc.tenant_id = $1 AND tc.channel_type = 'INSTAGRAM'
        ORDER BY tc.updated_at DESC, ci.updated_at DESC
        LIMIT 1`,
      [tenantId]
    );

    if (result.rowCount < 1) {
      return {
        status: 'DISCONNECTED',
        connected: false,
        channel: null,
      };
    }

    const row = result.rows[0];
    const config = row.config || {};
    const hasToken = Boolean(config.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN);
    const isChannelActive = row.channel_status === 'active' && Boolean(row.integration_enabled !== false);

    let connectionStatus = 'DISCONNECTED';
    if (config.reauth_required) {
      connectionStatus = 'REAUTH_REQUIRED';
    } else if (isChannelActive && hasToken) {
      connectionStatus = 'CONNECTED';
    } else if (isChannelActive && !hasToken) {
      connectionStatus = 'DISCONNECTED';
    } else {
      connectionStatus = 'DISCONNECTED';
    }

    const userId = config.instagram_user_id || null;
    const businessAccountId = config.instagram_business_account_id ||
      (config.page_id && config.page_id !== userId ? config.page_id : null) ||
      (row.external_channel_id && row.external_channel_id !== userId ? row.external_channel_id : null) ||
      config.instagram_account_id ||
      null;

    const primaryId = businessAccountId || userId || row.external_channel_id || null;
    const accountSubscribed = Boolean(config.account_subscribed ?? config.webhook_subscription_enabled ?? true);
    const subscribedFields = Array.isArray(config.subscribed_fields) ? config.subscribed_fields : CANONICAL_INSTAGRAM_WEBHOOK_FIELDS;
    const leadWhatsappDestination = config.lead_whatsapp_destination || config.internal_lead_whatsapp || null;
    const leadWhatsappConfigured = Boolean(leadWhatsappDestination);

    return {
      status: connectionStatus,
      connected: connectionStatus === 'CONNECTED',
      channel_id: row.channel_id,
      display_name: row.display_name,
      external_channel_id: row.external_channel_id,
      assistant_id: row.assistant_id,
      assistant_name: row.assistant_name || null,
      provider: config.provider || 'META_INSTAGRAM',
      auth_mode: config.auth_mode || 'INSTAGRAM_LOGIN',
      activation_policy: config.activation_policy || 'MANUAL_ONLY',
      activation_triggers: Array.isArray(config.activation_triggers) ? config.activation_triggers : [],
      instagram_business_account_id: businessAccountId,
      instagram_user_id: userId,
      instagram_account_id: primaryId,
      page_id: config.page_id || primaryId,
      account_username: config.account_username || null,
      account_name: config.account_name || row.display_name || null,
      account_subscribed: accountSubscribed,
      subscribed_fields: subscribedFields,
      has_token: hasToken,
      reauth_required: Boolean(config.reauth_required),
      lead_notification_enabled: config.lead_notification_enabled !== false,
      lead_notification_whatsapp: config.lead_notification_whatsapp || config.lead_whatsapp_destination || config.internal_lead_whatsapp || null,
      lead_notification_template: config.lead_notification_template
        ? {
            status: config.lead_notification_template.status || null,
            name: config.lead_notification_template.name || null,
            language_code: config.lead_notification_template.language_code || null,
          }
        : null,
      lead_whatsapp_destination: leadWhatsappDestination || config.lead_notification_whatsapp || null,
      internal_lead_whatsapp: leadWhatsappDestination || config.lead_notification_whatsapp || null,
      lead_whatsapp_configured: leadWhatsappConfigured || Boolean(config.lead_notification_whatsapp),
      visual_ai_enabled: Boolean(config.visual_ai_enabled),
      history_import_available: connectionStatus === 'CONNECTED',
      last_health_check_at: config.last_health_check_at || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

  } finally {
    client.release();
  }
}

/**
 * Configures or updates the Instagram channel integration for a tenant.
 */
export async function configureTenantInstagramChannel({
  database = pool,
  tenantId,
  displayName = 'Instagram',
  externalChannelId,
  assistantId = null,
  instagramAccountId,
  pageId,
  instagramBusinessAccountId,
  accountUsername = null,
  accountName = null,
  accessToken = null,
  authMode = 'INSTAGRAM_LOGIN',
  activationPolicy = undefined,
  activationTriggers = undefined,
  leadNotificationEnabled = undefined,
  leadNotificationWhatsapp = undefined,
  leadNotificationTemplate = undefined,
  visualAiEnabled = undefined,
  leadWhatsappDestination = undefined,
  internalLeadWhatsapp = undefined,
  lead_whatsapp_destination = undefined,
  internal_lead_whatsapp = undefined,
  status = 'active',

}) {
  if (!tenantId) throw new TenantInstagramProvisioningError('TENANT_ID_REQUIRED', 'Tenant ID is required', 400);

  let normalizedLeadNotificationTemplate = leadNotificationTemplate;
  if (leadNotificationTemplate !== undefined && leadNotificationTemplate !== null) {
    const templateName = String(leadNotificationTemplate.name || '').trim();
    const languageCode = String(leadNotificationTemplate.language_code || '').trim();
    const templateStatus = String(leadNotificationTemplate.status || '').trim().toUpperCase();
    if (
      !/^[a-z0-9_]{1,512}$/.test(templateName) ||
      !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(languageCode) ||
      templateStatus !== 'APPROVED'
    ) {
      throw new TenantInstagramProvisioningError(
        'INSTAGRAM_LEAD_NOTIFICATION_TEMPLATE_INVALID',
        'Lead notification template must be an approved WhatsApp template with a valid name and language code',
        400
      );
    }
    normalizedLeadNotificationTemplate = {
      status: templateStatus,
      name: templateName,
      language_code: languageCode,
    };
  }

  const client = await database.connect();
  try {
    await client.query('BEGIN');

    // Validate assistant belongs to this tenant and is active
    if (assistantId) {
      const assistantCheck = await client.query(
        "SELECT id FROM ai_assistants WHERE id = $1 AND tenant_id = $2 AND lower(status) = 'active'",
        [assistantId, tenantId]
      );
      if (assistantCheck.rowCount < 1) {
        throw new TenantInstagramProvisioningError('INSTAGRAM_ASSISTANT_INELIGIBLE', 'Assistant must be active and belong to this tenant', 400);
      }
    }

    // Check if tenant already has an existing INSTAGRAM channel
    const existing = await client.query(
      `SELECT id, assistant_id, external_channel_id FROM tenant_channels
        WHERE tenant_id = $1 AND channel_type = 'INSTAGRAM'
        LIMIT 1`,
      [tenantId]
    );

    const resolvedExternalId = String(
      externalChannelId ||
      instagramAccountId ||
      instagramBusinessAccountId ||
      pageId ||
      existing.rows[0]?.external_channel_id ||
      'instagram_account'
    ).trim();

    const normalizedKey = `instagram:${tenantId}:${resolvedExternalId}`;

    let channelId;
    if (existing.rowCount > 0) {
      channelId = existing.rows[0].id;
      await client.query(
        `UPDATE tenant_channels
            SET display_name = $1,
                external_channel_id = $2,
                assistant_id = $3,
                status = $4,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $5 AND tenant_id = $6`,
        [displayName.trim(), resolvedExternalId, assistantId, status, channelId, tenantId]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO tenant_channels
          (tenant_id, channel_type, display_name, external_channel_id, assistant_id, status)
         VALUES ($1, 'INSTAGRAM', $2, $3, $4, $5)
         RETURNING id`,
        [tenantId, displayName.trim(), resolvedExternalId, assistantId, status]
      );
      channelId = inserted.rows[0].id;
    }

    // Prepare JSONB config
    const existingCi = await client.query(
      `SELECT id, integration_key, config FROM channel_integrations
        WHERE (channel_id = $1 OR tenant_id = $2) AND integration_type = 'INSTAGRAM'
        ORDER BY updated_at DESC
        LIMIT 1`,
      [channelId, tenantId]
    );
    const existingConfig = existingCi.rows[0]?.config || {};
    const ciKey = existingCi.rows[0]?.integration_key || normalizedKey;

    const businessAccountId = instagramBusinessAccountId || instagramAccountId || pageId ||
      existingConfig.instagram_business_account_id ||
      (existingConfig.page_id && String(existingConfig.page_id) !== String(existingConfig.instagram_user_id) ? existingConfig.page_id : null) ||
      resolvedExternalId;

    const primaryRoutingId = businessAccountId || resolvedExternalId;

    const validPolicies = ['MANUAL_ONLY', 'ALL_MESSAGES', 'BUSINESS_INTENT_ONLY', 'TRIGGER_ONLY'];
    const resolvedPolicy = activationPolicy && validPolicies.includes(activationPolicy)
      ? activationPolicy
      : (existingConfig.activation_policy || 'MANUAL_ONLY');

    const resolvedTriggers = Array.isArray(activationTriggers)
      ? activationTriggers.map((t) => String(t).trim()).filter(Boolean)
      : (Array.isArray(existingConfig.activation_triggers) ? existingConfig.activation_triggers : []);

    const resolvedToken = accessToken || existingConfig.access_token || null;

    let autoSubscribed = existingConfig.account_subscribed ?? true;
    let autoSubscribedFields = Array.isArray(existingConfig.subscribed_fields) ? existingConfig.subscribed_fields : CANONICAL_INSTAGRAM_WEBHOOK_FIELDS;

    const rawLeadWhatsapp = leadWhatsappDestination ?? internalLeadWhatsapp ?? lead_whatsapp_destination ?? internal_lead_whatsapp;
    const resolvedLeadWhatsapp = rawLeadWhatsapp !== undefined
      ? (rawLeadWhatsapp ? String(rawLeadWhatsapp).trim() : null)
      : (existingConfig.lead_whatsapp_destination || existingConfig.internal_lead_whatsapp || null);

    const updatedConfig = {
      ...existingConfig,
      provider: 'META_INSTAGRAM',
      auth_mode: authMode || existingConfig.auth_mode || 'INSTAGRAM_LOGIN',
      activation_policy: resolvedPolicy,
      activation_triggers: resolvedTriggers,
      instagram_business_account_id: businessAccountId,
      instagram_user_id: existingConfig.instagram_user_id || null,
      instagram_account_id: primaryRoutingId,
      page_id: primaryRoutingId,
      account_username: accountUsername || existingConfig.account_username || null,
      account_name: accountName || existingConfig.account_name || displayName,
      access_token: resolvedToken,
      lead_notification_enabled: typeof leadNotificationEnabled === 'boolean'
        ? leadNotificationEnabled
        : (existingConfig.lead_notification_enabled !== false),
      lead_notification_whatsapp: typeof leadNotificationWhatsapp === 'string'
        ? leadNotificationWhatsapp.trim()
        : (leadNotificationWhatsapp === null ? null : (existingConfig.lead_notification_whatsapp || resolvedLeadWhatsapp)),
      lead_notification_template: normalizedLeadNotificationTemplate === undefined
        ? (existingConfig.lead_notification_template || null)
        : normalizedLeadNotificationTemplate,
      visual_ai_enabled: typeof visualAiEnabled === 'boolean'
        ? visualAiEnabled
        : Boolean(existingConfig.visual_ai_enabled),
      lead_whatsapp_destination: resolvedLeadWhatsapp,
      internal_lead_whatsapp: resolvedLeadWhatsapp,
      account_subscribed: autoSubscribed,

      subscribed_fields: autoSubscribedFields,
      reauth_required: false,
      updated_at: new Date().toISOString(),
    };

    const canonicalIntegration = await client.query(
      `INSERT INTO channel_integrations
        (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled, config)
       VALUES ($1, 'INSTAGRAM', $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (integration_key)
       DO UPDATE SET channel_id = EXCLUDED.channel_id,
                     assistant_id = EXCLUDED.assistant_id,
                     enabled = EXCLUDED.enabled,
                     config = EXCLUDED.config,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [ciKey, tenantId, channelId, assistantId, status === 'active', JSON.stringify(updatedConfig)]
    );

    const canonicalIntegrationId = canonicalIntegration.rows?.[0]?.id || null;
    if (canonicalIntegrationId) {
      await client.query(
        `UPDATE channel_integrations
            SET enabled = FALSE,
                updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $1
            AND channel_id = $2
            AND integration_type = 'INSTAGRAM'
            AND id <> $3
            AND enabled = TRUE`,
        [tenantId, channelId, canonicalIntegrationId]
      );
    }

    await client.query('COMMIT');

    return getTenantInstagramStatus({ database, tenantId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof TenantInstagramProvisioningError) throw error;
    throw error;
  } finally {
    client.release();
  }
}


/**
 * Disconnects the tenant's Instagram channel integration.
 */
export async function disconnectTenantInstagramChannel({ database = pool, tenantId }) {
  if (!tenantId) throw new TenantInstagramProvisioningError('TENANT_ID_REQUIRED', 'Tenant ID is required', 400);

  const client = await database.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE tenant_channels
          SET status = 'inactive',
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND channel_type = 'INSTAGRAM'`,
      [tenantId]
    );

    await client.query(
      `UPDATE channel_integrations
          SET enabled = FALSE,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND integration_type = 'INSTAGRAM'`,
      [tenantId]
    );

    await client.query('COMMIT');
    return { ok: true, status: 'DISCONNECTED' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Tests the tenant's Instagram connection via Meta Graph API.
 * Uses official Instagram Login endpoint: GET https://graph.instagram.com/{version}/{account_id}?fields=id,username,name
 */
export async function testTenantInstagramConnection({
  database = pool,
  tenantId,
  http = axios,
}) {
  const status = await getTenantInstagramStatus({ database, tenantId });
  if (status.status !== 'CONNECTED' || !status.has_token) {
    return {
      healthy: false,
      status: status.status,
      error: 'INSTAGRAM_NOT_CONNECTED',
      message: 'Instagram channel is not connected or access token is missing.',
    };
  }

  const client = await database.connect();
  try {
    const ciRes = await client.query(
      `SELECT ci.config FROM channel_integrations ci
        JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
       WHERE tc.tenant_id = $1 AND tc.channel_type = 'INSTAGRAM' AND ci.integration_type = 'INSTAGRAM'
       LIMIT 1`,
      [tenantId]
    );
    const config = ciRes.rows[0]?.config || {};
    const token = config.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    const accountId = config.instagram_account_id || config.instagram_business_account_id || config.page_id || 'me';

    if (!token) {
      return { healthy: false, status: 'DISCONNECTED', error: 'TOKEN_MISSING' };
    }

    const baseUrl = instagramGraphApiBase();
    try {
      const res = await http.get(`${baseUrl}/me`, {
        params: { fields: 'id,username,name,account_type', access_token: token },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      });

      const verifiedId = res.data?.id || accountId;
      const verifiedUsername = res.data?.username || config.account_username;
      const verifiedName = res.data?.name || res.data?.username || status.account_name;

      // Preserve existing business account / webhook delivery ID if distinct from user ID
      let businessAccountId = config.instagram_business_account_id ||
        (config.page_id && String(config.page_id) !== String(verifiedId) ? config.page_id : null) ||
        (config.instagram_account_id && String(config.instagram_account_id) !== String(verifiedId) ? config.instagram_account_id : null) ||
        (row.external_channel_id && String(row.external_channel_id) !== String(verifiedId) ? row.external_channel_id : null) ||
        null;

      if (!businessAccountId) {
        const candRes = await client.query(
          `SELECT tc2.external_channel_id, ci2.config
             FROM tenant_channels tc2
             LEFT JOIN channel_integrations ci2 ON ci2.channel_id = tc2.id AND ci2.tenant_id = tc2.tenant_id AND ci2.integration_type = 'INSTAGRAM'
            WHERE (tc2.tenant_id = $1 OR ci2.config->>'account_username' = $2)
              AND tc2.channel_type = 'INSTAGRAM'
            ORDER BY tc2.created_at ASC`,
          [tenantId, verifiedUsername || config.account_username || '']
        );
        for (const cand of candRes.rows) {
          const candId = cand.config?.instagram_business_account_id ||
            (cand.config?.page_id && String(cand.config?.page_id) !== String(verifiedId) ? cand.config.page_id : null) ||
            (cand.config?.instagram_account_id && String(cand.config?.instagram_account_id) !== String(verifiedId) ? cand.config.instagram_account_id : null) ||
            (cand.external_channel_id && String(cand.external_channel_id) !== String(verifiedId) ? cand.external_channel_id : null);
          if (candId) {
            businessAccountId = candId;
            break;
          }
        }
      }

      const primaryRoutingId = businessAccountId || verifiedId;

      // Assign assistant if missing
      const asstRes = await client.query(
        `SELECT id FROM ai_assistants WHERE tenant_id = $1 AND lower(status) = 'active' ORDER BY updated_at DESC LIMIT 1`,
        [tenantId]
      );
      const assistantIdToAssign = asstRes.rows[0]?.id || null;

      await client.query(
        `UPDATE tenant_channels
            SET external_channel_id = $1,
                assistant_id = COALESCE(assistant_id, $2),
                updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $3 AND channel_type = 'INSTAGRAM'`,
        [primaryRoutingId, assistantIdToAssign, tenantId]
      );

      // Programmatically verify and ensure account-level webhook subscription via official Meta Instagram Login API
      let accountSubscribed = Boolean(config.account_subscribed ?? true);
      let subscribedFields = Array.isArray(config.subscribed_fields) ? config.subscribed_fields : CANONICAL_INSTAGRAM_WEBHOOK_FIELDS;

      try {
        const subCheck = await getInstagramSubscribedApps({
          accountId: verifiedId,
          accessToken: token,
          http,
          graphBaseUrl: baseUrl,
        });
        if (subCheck.subscribed) {
          accountSubscribed = true;
          if (subCheck.subscribed_fields.length > 0) {
            subscribedFields = subCheck.subscribed_fields;
          }
        } else {
          // Attempt automatic subscription
          const subAttempt = await subscribeInstagramAccountToWebhooks({
            accountId: verifiedId,
            accessToken: token,
            fields: CANONICAL_INSTAGRAM_WEBHOOK_FIELDS,
            http,
            graphBaseUrl: baseUrl,
          });
          if (subAttempt.success) {
            accountSubscribed = true;
            subscribedFields = subAttempt.fields;
          }
        }
      } catch (subErr) {
        console.warn('INSTAGRAM_SUBSCRIPTION_VERIFY_NONBLOCKING_WARN', subErr?.message);
      }

      const updatedConfig = {
        ...config,
        instagram_business_account_id: businessAccountId || config.instagram_business_account_id || null,
        instagram_user_id: verifiedId,
        instagram_account_id: primaryRoutingId,
        page_id: primaryRoutingId,
        account_subscribed: accountSubscribed,
        subscribed_fields: subscribedFields,
        reauth_required: false,
        last_health_check_at: new Date().toISOString(),
        account_username: verifiedUsername || config.account_username,
        account_name: verifiedName || config.account_name,
      };
      await client.query(
        `UPDATE channel_integrations
            SET config = $1::jsonb,
                assistant_id = COALESCE(assistant_id, $2),
                updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $3 AND integration_type = 'INSTAGRAM'`,
        [JSON.stringify(updatedConfig), assistantIdToAssign, tenantId]
      );

      return {
        healthy: true,
        status: 'CONNECTED',
        instagram_business_account_id: businessAccountId,
        instagram_user_id: verifiedId,
        instagram_account_id: primaryRoutingId,
        page_id: primaryRoutingId,
        account_username: verifiedUsername,
        account_name: verifiedName,
        account_subscribed: accountSubscribed,
        subscribed_fields: subscribedFields,
      };
    } catch (metaErr) {
      const errData = metaErr?.response?.data?.error;
      const isAuthError = errData?.code === 190 || errData?.type === 'OAuthException';
      if (isAuthError) {
        // Mark reauth required in config
        const updatedConfig = { ...config, reauth_required: true, last_error: errData?.message || 'Token expired or revoked' };
        await client.query(
          `UPDATE channel_integrations
              SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $2 AND integration_type = 'INSTAGRAM'`,
          [JSON.stringify(updatedConfig), tenantId]
        );
        return {
          healthy: false,
          status: 'REAUTH_REQUIRED',
          error: 'TOKEN_EXPIRED_OR_REVOKED',
          message: errData?.message || 'Access token is expired or revoked. Re-authorization required.',
        };
      }
      return {
        healthy: false,
        status: 'ERROR',
        error: errData?.code ? `META_ERROR_${errData.code}` : 'META_API_ERROR',
        message: errData?.message || metaErr?.message || 'Meta connection test failed.',
      };
    }
  } finally {
    client.release();
  }
}

/**
 * Automatically converges all active Instagram channels:
 * 1. Synchronizes verified Meta User IDs from live Meta /me API into external_channel_id and config
 * 2. Connects active default tenant assistant if assistant_id is unassigned
 * 3. Ensures account-level webhook subscription is active
 */
export async function convergeTenantInstagramChannels({ database = pool, http = axios, graphBaseUrl = null } = {}) {
  const client = await database.connect();
  try {
    await client.query(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY tenant_id, channel_id, integration_type
                  ORDER BY updated_at DESC, id DESC
                ) AS row_rank
           FROM channel_integrations
          WHERE integration_type = 'INSTAGRAM' AND enabled = TRUE
       )
       UPDATE channel_integrations ci
          SET enabled = FALSE,
              updated_at = CURRENT_TIMESTAMP
         FROM ranked
        WHERE ci.id = ranked.id
          AND ranked.row_rank > 1`
    );

    const channels = await client.query(
      `SELECT DISTINCT ON (tc.id)
              tc.id AS channel_id, tc.tenant_id, tc.external_channel_id, tc.assistant_id,
              tc.status AS channel_status, ci.config AS integration_config
         FROM tenant_channels tc
         JOIN tenants t ON t.id = tc.tenant_id AND t.status = 'active'
         LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id
          AND ci.integration_type = 'INSTAGRAM' AND ci.enabled = TRUE
        WHERE tc.channel_type = 'INSTAGRAM'
          AND tc.status = 'active'
        ORDER BY tc.id, ci.updated_at DESC`
    );

    const baseUrl = graphBaseUrl || instagramGraphApiBase();

    for (const row of channels.rows) {
      const config = row.integration_config || {};
      const token = config.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;

      let assistantId = row.assistant_id;
      if (!assistantId) {
        const asstRes = await client.query(
          `SELECT id FROM ai_assistants WHERE tenant_id = $1 AND lower(status) = 'active' ORDER BY updated_at DESC LIMIT 1`,
          [row.tenant_id]
        );
        if (asstRes.rowCount > 0) {
          assistantId = asstRes.rows[0].id;
          await client.query(`UPDATE tenant_channels SET assistant_id = $1 WHERE id = $2`, [assistantId, row.channel_id]);
        }
      }

      if (token) {
        try {
          const meRes = await http.get(`${baseUrl}/me`, {
            params: { fields: 'id,username,name,account_type', access_token: token },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 6000,
          });
          const verifiedId = meRes.data?.id;
          const verifiedUsername = meRes.data?.username;
          const verifiedName = meRes.data?.name || meRes.data?.username || config.account_name || null;


          if (verifiedId) {
            let businessAccountId = config.instagram_business_account_id ||
              (config.page_id && String(config.page_id) !== String(verifiedId) ? config.page_id : null) ||
              (config.instagram_account_id && String(config.instagram_account_id) !== String(verifiedId) ? config.instagram_account_id : null) ||
              (row.external_channel_id && String(row.external_channel_id) !== String(verifiedId) ? row.external_channel_id : null) ||
              null;

            if (!businessAccountId) {
              const candRes = await client.query(
                `SELECT tc2.external_channel_id, ci2.config
                   FROM tenant_channels tc2
                   LEFT JOIN channel_integrations ci2 ON ci2.channel_id = tc2.id AND ci2.tenant_id = tc2.tenant_id AND ci2.integration_type = 'INSTAGRAM'
                  WHERE (tc2.tenant_id = $1 OR ci2.config->>'account_username' = $2)
                    AND tc2.channel_type = 'INSTAGRAM'
                  ORDER BY tc2.created_at ASC`,
                [row.tenant_id, verifiedUsername || config.account_username || '']
              );
              for (const cand of candRes.rows) {
                const candId = cand.config?.instagram_business_account_id ||
                  (cand.config?.page_id && String(cand.config?.page_id) !== String(verifiedId) ? cand.config.page_id : null) ||
                  (cand.config?.instagram_account_id && String(cand.config?.instagram_account_id) !== String(verifiedId) ? cand.config.instagram_account_id : null) ||
                  (cand.external_channel_id && String(cand.external_channel_id) !== String(verifiedId) ? cand.external_channel_id : null);
                if (candId) {
                  businessAccountId = candId;
                  break;
                }
              }
            }

            const primaryRoutingId = businessAccountId || verifiedId;

            await client.query(`UPDATE tenant_channels SET external_channel_id = $1, assistant_id = COALESCE(assistant_id, $2), updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [primaryRoutingId, assistantId, row.channel_id]);
            const updatedConfig = {
              ...config,
              instagram_business_account_id: businessAccountId || config.instagram_business_account_id || null,
              instagram_user_id: verifiedId,
              instagram_account_id: primaryRoutingId,
              page_id: primaryRoutingId,
              account_username: verifiedUsername || config.account_username,
              account_name: verifiedName || config.account_name,
              account_subscribed: true,
              subscribed_fields: CANONICAL_INSTAGRAM_WEBHOOK_FIELDS,
              updated_at: new Date().toISOString(),
            };
            await client.query(
              `UPDATE channel_integrations SET config = $1::jsonb, assistant_id = COALESCE(assistant_id, $2), updated_at = CURRENT_TIMESTAMP WHERE channel_id = $3 AND tenant_id = $4`,
              [JSON.stringify(updatedConfig), assistantId, row.channel_id, row.tenant_id]
            );
            await subscribeInstagramAccountToWebhooks({ accountId: verifiedId, accessToken: token, http, graphBaseUrl: baseUrl }).catch(() => {});
          }
        } catch (err) {
          console.warn('INSTAGRAM_CONVERGENCE_PROBE_WARN', err?.message);
        }
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Imports historical Instagram conversations and messages from Meta Graph API.
 * Strict invariants:
 * - PASSIVE ONLY: ZERO AI, ZERO outbound delivery, ZERO push notifications, ZERO typing, ZERO human handoffs.
 * - ISOLATED TRANSACTIONS: One malformed conversation does not abort or roll back other conversations.
 * - RESILIENT IDENTITIES: Profile lookup failure falls back safely to 'Instagram User' (never @<provider_id>).
 * - MESSAGE RESILIENCE: Safely persists text, media placeholders, and handles unsupported/empty message types.
 * - IDEMPOTENT RECONCILIATION: Reconciles with existing live conversations without resetting AI overrides or CRM state.
 * - SANITIZED REPORTING: Returns operational failure metrics categorized safely.
 */
export async function importTenantInstagramHistory({
  database = pool,
  tenantId,
  http = axios,
  graphBaseUrl = null,
  limit = 100,
}) {
  if (!tenantId) throw new TenantInstagramProvisioningError('TENANT_ID_REQUIRED', 'Tenant ID is required', 400);

  const client = await database.connect();
  let channelRow;
  try {
    const channelRes = await client.query(
      `SELECT tc.id AS channel_id, tc.tenant_id, tc.external_channel_id, tc.assistant_id,
              ci.id AS integration_id, ci.config
         FROM tenant_channels tc
         LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
        WHERE tc.tenant_id = $1 AND tc.channel_type = 'INSTAGRAM' AND tc.status = 'active'
        ORDER BY tc.updated_at DESC
        LIMIT 1`,
      [tenantId]
    );
    if (channelRes.rowCount === 0) {
      throw new TenantInstagramProvisioningError('INSTAGRAM_CHANNEL_NOT_FOUND', 'Active Instagram channel not found for tenant', 404);
    }
    channelRow = channelRes.rows[0];
  } finally {
    client.release();
  }

  const config = channelRow.config || {};
  const token = config.access_token || process.env.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new TenantInstagramProvisioningError('INSTAGRAM_TOKEN_MISSING', 'Instagram access token is missing', 400);
  }

  const baseUrl = graphBaseUrl || instagramGraphApiBase();
  const targetId = config.instagram_user_id || config.page_id || config.instagram_account_id || channelRow.external_channel_id || 'me';

  const businessIds = new Set([
    String(channelRow.external_channel_id || '').trim(),
    String(config.instagram_account_id || '').trim(),
    String(config.instagram_user_id || '').trim(),
    String(config.instagram_business_account_id || '').trim(),
    String(config.page_id || '').trim(),
    'me',
  ].filter(Boolean));

  // 1. Discover Meta Conversations
  let metaConversations = [];
  try {
    const convRes = await http.get(`${baseUrl}/${targetId}/conversations`, {
      params: {
        fields: 'id,updated_time,participants{id,username,name}',
        access_token: token,
        limit: Math.min(Math.max(1, limit), 100),
      },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    metaConversations = Array.isArray(convRes.data?.data) ? convRes.data.data : [];
  } catch (discoveryErr) {
    if (targetId !== 'me') {
      try {
        const retryRes = await http.get(`${baseUrl}/me/conversations`, {
          params: {
            fields: 'id,updated_time,participants{id,username,name}',
            access_token: token,
            limit: Math.min(Math.max(1, limit), 100),
          },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15000,
        });
        metaConversations = Array.isArray(retryRes.data?.data) ? retryRes.data.data : [];
      } catch (retryErr) {
        console.warn('INSTAGRAM_HISTORY_DISCOVERY_ERROR', retryErr?.message || discoveryErr?.message);
        throw new TenantInstagramProvisioningError('META_DISCOVERY_FAILED', `Failed to discover Instagram conversations: ${retryErr?.message || discoveryErr?.message}`, 502);
      }
    } else {
      console.warn('INSTAGRAM_HISTORY_DISCOVERY_ERROR', discoveryErr?.message);
      throw new TenantInstagramProvisioningError('META_DISCOVERY_FAILED', `Failed to discover Instagram conversations: ${discoveryErr?.message}`, 502);
    }
  }

  const result = {
    success: true,
    discovered: metaConversations.length,
    imported: 0,
    reconciled: 0,
    failed: 0,
    messages_imported: 0,
    messages_duplicates: 0,
    messages_failed: 0,
    failure_categories: {
      CONTACT_PERSISTENCE: 0,
      CONVERSATION_PERSISTENCE: 0,
      MESSAGE_PERSISTENCE: 0,
      IDENTITY_RESOLUTION: 0,
      META_MESSAGE_FETCH: 0,
      OTHER: 0,
    },
    errors: [],
  };



  // 2. Process each discovered conversation within isolated transaction
  for (const conv of metaConversations) {
    const convClient = await database.connect();
    try {
      await convClient.query('BEGIN');

      const rawParticipants = Array.isArray(conv.participants?.data)
        ? conv.participants.data
        : (Array.isArray(conv.participants) ? conv.participants : []);

      let customerParticipant = rawParticipants.find(
        (p) => p?.id && !businessIds.has(String(p.id).trim())
      );
      if (!customerParticipant && rawParticipants.length > 0) {
        customerParticipant = rawParticipants[0];
      }

      if (!customerParticipant || !customerParticipant.id) {
        result.failed++;
        result.failure_categories.IDENTITY_RESOLUTION++;
        result.errors.push({
          conversation_id: conv.id,
          stage: 'IDENTITY_RESOLUTION',
          category: 'IDENTITY_RESOLUTION',
          error: 'Unable to resolve customer participant from Meta conversation',
        });
        await convClient.query('ROLLBACK');
        continue;
      }

      const customerIgsid = String(customerParticipant.id).trim();

      let username = customerParticipant.username ? String(customerParticipant.username).trim() : null;
      let name = customerParticipant.name ? String(customerParticipant.name).trim() : null;

      if (!username && !name) {
        try {
          const profRes = await http.get(`${baseUrl}/${customerIgsid}`, {
            params: { fields: 'id,username,name', access_token: token },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000,
          });
          if (profRes.data?.username) username = String(profRes.data.username).trim();
          if (profRes.data?.name) name = String(profRes.data.name).trim();
        } catch {
          // Profile lookup failure must never block persistence
        }
      }

      let displayName = 'Instagram User';
      if (name && name.trim()) {
        displayName = name.trim();
      } else if (username && username.trim() && !/^\d+$/.test(username.trim()) && username.trim() !== customerIgsid) {
        displayName = `@${username.trim().replace(/^@/, '')}`;
      } else {
        displayName = 'Instagram User';
      }

      const customerRef = `instagram:${customerIgsid}`;
      const identityHash = crypto
        .createHash('sha256')
        .update(`${tenantId}:EXTERNAL_CUSTOMER:${customerRef.toLowerCase()}`)
        .digest('hex');

      let contactRow;
      try {
        const contactRes = await convClient.query(
          `INSERT INTO crm_contacts
            (tenant_id, identity_kind, identity_hash, display_name, source, ai_behavior_override, created_at, updated_at)
           VALUES ($1, 'EXTERNAL_CUSTOMER', $2, $3, 'INSTAGRAM', 'FIRST_CONTACT_HOLD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (tenant_id, identity_hash)
           DO UPDATE SET
             display_name = CASE
               WHEN EXCLUDED.display_name IS NOT NULL AND EXCLUDED.display_name != 'Instagram User' THEN EXCLUDED.display_name
               ELSE COALESCE(crm_contacts.display_name, EXCLUDED.display_name)
             END,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [tenantId, identityHash, displayName]
        );
        contactRow = contactRes.rows[0];
      } catch (contactErr) {
        result.failed++;
        result.failure_categories.CONTACT_PERSISTENCE++;
        result.errors.push({
          conversation_id: conv.id,
          stage: 'CONTACT_PERSISTENCE',
          category: 'CONTACT_PERSISTENCE',
          error: contactErr.message,
          sqlstate: contactErr.code,
        });
        await convClient.query('ROLLBACK');
        continue;
      }

      const extConvId = `instagram:${crypto.createHash('sha256').update(customerRef).digest('hex')}`;
      const metaConvId = String(conv.id || '').trim();

      let conversationRow;
      let isReconciled = false;
      try {
        const existingConvRes = await convClient.query(
          `SELECT * FROM conversations
            WHERE tenant_id = $1 AND channel_id = $2
              AND (
                external_conversation_id = $3
                OR customer_external_id = $4
                OR external_conversation_id = $5
              )
            LIMIT 1`,
          [tenantId, channelRow.channel_id, extConvId, customerRef, metaConvId]
        );

        if (existingConvRes.rowCount > 0) {
          conversationRow = existingConvRes.rows[0];
          isReconciled = true;
          if (!conversationRow.contact_id && contactRow?.id) {
            await convClient.query(
              `UPDATE conversations SET contact_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
              [contactRow.id, conversationRow.id]
            );
            conversationRow.contact_id = contactRow.id;
          }
        } else {
          const updatedTime = conv.updated_time ? new Date(conv.updated_time) : new Date();
          const insertConvRes = await convClient.query(
            `INSERT INTO conversations
              (tenant_id, channel_id, contact_id, external_conversation_id, customer_external_id, status, handling_mode, handling_version, ai_behavior_override, created_at, updated_at, last_activity_at)
             VALUES ($1, $2, $3, $4, $5, 'open', 'AI', 1, 'FIRST_CONTACT_HOLD', $6, $6, $6)
             ON CONFLICT (channel_id, external_conversation_id)
             DO UPDATE SET
               contact_id = COALESCE(conversations.contact_id, EXCLUDED.contact_id),
               updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [tenantId, channelRow.channel_id, contactRow?.id || null, extConvId, customerRef, updatedTime]
          );
          conversationRow = insertConvRes.rows[0];
        }
      } catch (convErr) {
        result.failed++;
        result.failure_categories.CONVERSATION_PERSISTENCE++;
        result.errors.push({
          conversation_id: conv.id,
          stage: 'CONVERSATION_PERSISTENCE',
          category: 'CONVERSATION_PERSISTENCE',
          error: convErr.message,
          sqlstate: convErr.code,
        });
        await convClient.query('ROLLBACK');
        continue;
      }

      let rawMessages = [];
      if (metaConvId) {
        try {
          const msgRes = await http.get(`${baseUrl}/${metaConvId}/messages`, {
            params: {
              fields: 'id,created_time,from,to,message,attachments{id,mime_type,name,size,file_url,image_data,video_data}',
              access_token: token,
              limit: 100,
            },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000,
          });
          rawMessages = Array.isArray(msgRes.data?.data) ? msgRes.data.data : [];
        } catch (msgFetchErr) {
          result.failure_categories.META_MESSAGE_FETCH++;
          result.errors.push({
            conversation_id: conv.id,
            stage: 'META_MESSAGE_FETCH',
            category: 'META_MESSAGE_FETCH',
            error: msgFetchErr.message,
          });
        }
      }

      const sortedMessages = [...rawMessages].sort(
        (a, b) => new Date(a.created_time || 0).getTime() - new Date(b.created_time || 0).getTime()
      );

      for (const m of sortedMessages) {
        const msgExtId = m.id ? String(m.id).trim() : null;
        const msgCreated = m.created_time ? new Date(m.created_time) : new Date();
        const fromId = String(m.from?.id ?? '').trim();
        const senderType = fromId === customerIgsid ? 'CUSTOMER' : 'ASSISTANT';

        let contentText = typeof m.message === 'string' ? m.message.trim() : '';
        if (!contentText) {
          const atts = Array.isArray(m.attachments?.data) ? m.attachments.data : (Array.isArray(m.attachments) ? m.attachments : []);
          if (atts.length > 0) {
            const firstAtt = atts[0];
            const mediaKind = firstAtt.mime_type || (firstAtt.image_data ? 'image' : (firstAtt.video_data ? 'video' : 'attachment'));
            contentText = `[Attachment: ${mediaKind}]`;
          } else {
            contentText = '[Message]';
          }
        }

        try {
          if (msgExtId) {
            const existsCheck = await convClient.query(
              `SELECT id FROM conversation_messages WHERE conversation_id = $1 AND external_message_id = $2 LIMIT 1`,
              [conversationRow.id, msgExtId]
            );
            if (existsCheck.rowCount > 0) {
              result.messages_duplicates++;
              continue;
            }
          }

          const insMsg = await convClient.query(
            `INSERT INTO conversation_messages
              (tenant_id, conversation_id, sender_type, content, external_message_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (conversation_id, external_message_id) DO NOTHING
             RETURNING id`,
            [tenantId, conversationRow.id, senderType, contentText, msgExtId, msgCreated]
          );

          if (insMsg.rowCount > 0) {
            result.messages_imported++;
          } else {
            result.messages_duplicates++;
          }
        } catch (msgErr) {
          result.messages_failed++;
          result.failure_categories.MESSAGE_PERSISTENCE++;
          result.errors.push({
            conversation_id: conv.id,
            stage: 'MESSAGE_PERSISTENCE',
            category: 'MESSAGE_PERSISTENCE',
            error: msgErr.message,
            sqlstate: msgErr.code,
          });
        }
      }

      await convClient.query('COMMIT');
      if (isReconciled) {
        result.reconciled++;
      } else {
        result.imported++;
      }
    } catch (err) {
      await convClient.query('ROLLBACK').catch(() => {});
      result.failed++;
      result.failure_categories.OTHER++;
      result.errors.push({
        conversation_id: conv.id,
        stage: 'UNEXPECTED',
        category: 'OTHER',
        error: err.message,
      });
    } finally {
      convClient.release();
    }
  }

  if (result.discovered > 0 && result.imported === 0 && result.reconciled === 0) {
    result.success = false;
  }

  return result;
}


