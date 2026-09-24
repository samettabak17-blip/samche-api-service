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

    const accountId = config.instagram_account_id || config.instagram_business_account_id || config.page_id || row.external_channel_id || null;

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
      instagram_account_id: accountId,
      page_id: config.page_id || accountId,
      instagram_business_account_id: config.instagram_business_account_id || accountId,
      account_username: config.account_username || null,
      account_name: config.account_name || row.display_name || null,
      has_token: hasToken,
      reauth_required: Boolean(config.reauth_required),
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

    const resolvedAccountId = instagramAccountId || resolvedExternalId;

    const validPolicies = ['MANUAL_ONLY', 'ALL_MESSAGES', 'BUSINESS_INTENT_ONLY', 'TRIGGER_ONLY'];
    const resolvedPolicy = activationPolicy && validPolicies.includes(activationPolicy)
      ? activationPolicy
      : (existingConfig.activation_policy || 'MANUAL_ONLY');

    const resolvedTriggers = Array.isArray(activationTriggers)
      ? activationTriggers.map((t) => String(t).trim()).filter(Boolean)
      : (Array.isArray(existingConfig.activation_triggers) ? existingConfig.activation_triggers : []);

    const updatedConfig = {
      ...existingConfig,
      provider: 'META_INSTAGRAM',
      auth_mode: authMode || existingConfig.auth_mode || 'INSTAGRAM_LOGIN',
      activation_policy: resolvedPolicy,
      activation_triggers: resolvedTriggers,
      instagram_account_id: resolvedAccountId,
      instagram_business_account_id: resolvedAccountId,
      page_id: pageId || existingConfig.page_id || resolvedAccountId,
      account_username: accountUsername || existingConfig.account_username || null,
      account_name: accountName || existingConfig.account_name || displayName,
      access_token: accessToken || existingConfig.access_token || null,
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
      const res = await http.get(`${baseUrl}/${accountId}`, {
        params: { fields: 'id,username,name', access_token: token },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      });

      const verifiedId = res.data?.id || accountId;
      const verifiedUsername = res.data?.username || config.account_username;
      const verifiedName = res.data?.name || res.data?.username || status.account_name;

      const updatedConfig = {
        ...config,
        reauth_required: false,
        last_health_check_at: new Date().toISOString(),
        account_username: verifiedUsername || config.account_username,
        account_name: verifiedName || config.account_name,
      };
      await client.query(
        `UPDATE channel_integrations
            SET config = $1::jsonb, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $2 AND integration_type = 'INSTAGRAM'`,
        [JSON.stringify(updatedConfig), tenantId]
      );

      return {
        healthy: true,
        status: 'CONNECTED',
        instagram_account_id: verifiedId,
        page_id: verifiedId,
        account_username: verifiedUsername,
        account_name: verifiedName,
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
