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
         LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
        WHERE tc.tenant_id = $1 AND tc.channel_type = 'INSTAGRAM'
        ORDER BY tc.updated_at DESC
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
      lead_notification_whatsapp: config.lead_notification_whatsapp || null,
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
  visualAiEnabled = undefined,
  status = 'active',

}) {
  if (!tenantId) throw new TenantInstagramProvisioningError('TENANT_ID_REQUIRED', 'Tenant ID is required', 400);

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

    const resolvedExternalId = String(
      externalChannelId ||
      instagramAccountId ||
      instagramBusinessAccountId ||
      pageId ||
      'instagram_account'
    ).trim();

    const normalizedKey = `instagram:${tenantId}:${resolvedExternalId}`;

    // Check if tenant already has an existing INSTAGRAM channel
    const existing = await client.query(
      `SELECT id, assistant_id, external_channel_id FROM tenant_channels
        WHERE tenant_id = $1 AND channel_type = 'INSTAGRAM'
        LIMIT 1`,
      [tenantId]
    );

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
      `SELECT config FROM channel_integrations
        WHERE channel_id = $1 AND tenant_id = $2 AND integration_type = 'INSTAGRAM'
        LIMIT 1`,
      [channelId, tenantId]
    );
    const existingConfig = existingCi.rows[0]?.config || {};

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
        : (leadNotificationWhatsapp === null ? null : (existingConfig.lead_notification_whatsapp || null)),
      visual_ai_enabled: typeof visualAiEnabled === 'boolean'
        ? visualAiEnabled
        : Boolean(existingConfig.visual_ai_enabled),
      account_subscribed: autoSubscribed,

      subscribed_fields: autoSubscribedFields,
      reauth_required: false,
      updated_at: new Date().toISOString(),
    };

    await client.query(
      `INSERT INTO channel_integrations
        (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled, config)
       VALUES ($1, 'INSTAGRAM', $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (integration_key)
       DO UPDATE SET channel_id = EXCLUDED.channel_id,
                     assistant_id = EXCLUDED.assistant_id,
                     enabled = EXCLUDED.enabled,
                     config = EXCLUDED.config,
                     updated_at = CURRENT_TIMESTAMP`,
      [normalizedKey, tenantId, channelId, assistantId, status === 'active', JSON.stringify(updatedConfig)]
    );

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
    const channels = await client.query(
      `SELECT tc.id AS channel_id, tc.tenant_id, tc.external_channel_id, tc.assistant_id,
              tc.status AS channel_status, ci.config AS integration_config
         FROM tenant_channels tc
         JOIN tenants t ON t.id = tc.tenant_id AND t.status = 'active'
         LEFT JOIN channel_integrations ci ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'INSTAGRAM'
        WHERE tc.channel_type = 'INSTAGRAM'
          AND tc.status = 'active'`
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

