import axios from 'axios';
import { resolveMetaGraphApiVersion, metaGraphApiBase } from './meta-graph-api-version.js';
import { generateWhatsAppOAuthState, verifyWhatsAppOAuthState } from './whatsapp-oauth-state-service.js';
import { encryptWhatsAppCredential } from './whatsapp-credential-crypto.js';
import { resolveEffectiveTenantEntitlements } from './tenant-entitlement-service.js';
import { normalizeWhatsAppExternalId } from './whatsapp-channel-ownership-service.js';
import { whatsappPhoneNumberFingerprint } from './whatsapp-live-inbox-service.js';

export const CANONICAL_WHATSAPP_CONFIG_ID = '29049226651367865';

export class WhatsAppEmbeddedSignupError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WhatsAppEmbeddedSignupError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Retrieves the public Meta configuration & signed OAuth state token required
 * for starting the Meta Embedded Signup popup on the frontend.
 */
export async function getWhatsAppEmbeddedSignupConfig({
  database,
  tenantId,
  userId,
  env = process.env,
}) {
  if (!tenantId) {
    throw new WhatsAppEmbeddedSignupError('TENANT_ID_REQUIRED', 'Tenant ID is required');
  }

  // 1. Verify tenant entitlement for WhatsApp AI
  if (database) {
    try {
      const entitlements = await resolveEffectiveTenantEntitlements({ database, tenantId });
      const isEntitled = Boolean(entitlements?.capabilities?.whatsapp?.entitled);
      if (!isEntitled) {
        return {
          entitled: false,
          min_plan: 'GROWTH',
          reason: 'TENANT_NOT_ENTITLED',
          message: 'WhatsApp AI is not included in your current subscription plan. Upgrade to Growth or higher to connect WhatsApp.',
        };
      }
    } catch (err) {
      console.warn('WHATSAPP_CONFIG_ENTITLEMENT_CHECK_FAILED', err?.message);
    }
  }

  const appId = String(env?.WHATSAPP_APP_ID || env?.META_APP_ID || env?.VITE_WHATSAPP_APP_ID || '').trim();
  const configId = String(
    env?.WHATSAPP_CONFIG_ID ||
    env?.META_EMBEDDED_SIGNUP_CONFIG_ID ||
    env?.VITE_WHATSAPP_CONFIG_ID ||
    CANONICAL_WHATSAPP_CONFIG_ID
  ).trim();
  const graphApiVersion = resolveMetaGraphApiVersion(env);

  const stateToken = userId
    ? generateWhatsAppOAuthState({ tenantId, userId, env })
    : null;

  return {
    entitled: true,
    app_id: appId || null,
    config_id: configId || null,
    graph_api_version: graphApiVersion,
    state_token: stateToken,
    configured: Boolean(appId && configId),
  };
}

/**
 * Exchanges the short-lived authorization code with Meta Graph API,
 * inspects WABA & phone number ownership, subscribes WABA to webhooks,
 * encrypts credentials, and idempotently provisions the tenant's WhatsApp channel.
 */
export async function exchangeAndOnboardWhatsApp({
  database,
  tenantId,
  userId,
  code,
  wabaId,
  phoneNumberId = null,
  assistantId,
  oauthState,
  httpClient = axios,
  env = process.env,
}) {
  if (!database?.query) {
    throw new WhatsAppEmbeddedSignupError('DATABASE_UNAVAILABLE', 'Database is unavailable');
  }
  if (!tenantId || !userId) {
    throw new WhatsAppEmbeddedSignupError('AUTHENTICATION_REQUIRED', 'Tenant and user context are required');
  }
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new WhatsAppEmbeddedSignupError('AUTHORIZATION_CODE_REQUIRED', 'Meta authorization code is required');
  }
  if (!wabaId || typeof wabaId !== 'string' || !wabaId.trim()) {
    throw new WhatsAppEmbeddedSignupError('WABA_ID_REQUIRED', 'WhatsApp Business Account ID is required');
  }
  if (!assistantId || typeof assistantId !== 'string') {
    throw new WhatsAppEmbeddedSignupError('ASSISTANT_ID_REQUIRED', 'An active AI Assistant must be selected');
  }

  // 1. Verify OAuth State security token
  const stateCheck = verifyWhatsAppOAuthState(oauthState, { tenantId, userId, env });
  if (!stateCheck.valid) {
    throw new WhatsAppEmbeddedSignupError(
      'OAUTH_STATE_INVALID',
      'The signup session has expired or is invalid. Please try connecting again.',
      { reason: stateCheck.error }
    );
  }

  // 2. Server-side Entitlement Enforcement
  const entitlements = await resolveEffectiveTenantEntitlements({ database, tenantId });
  if (!entitlements?.capabilities?.whatsapp?.entitled) {
    throw new WhatsAppEmbeddedSignupError(
      'TENANT_NOT_ENTITLED',
      'WhatsApp AI capability is not included in your current subscription plan.',
      { minPlan: 'GROWTH' }
    );
  }

  // 3. Validate Assistant belongs to this tenant and is active
  const assistantRes = await database.query(
    `SELECT id, name, status
       FROM ai_assistants
      WHERE id = $1 AND tenant_id = $2 AND lower(status) = 'active'`,
    [assistantId, tenantId]
  );
  if (assistantRes.rowCount !== 1) {
    throw new WhatsAppEmbeddedSignupError(
      'WHATSAPP_ASSISTANT_INELIGIBLE',
      'The selected assistant must be active and belong to your organization.'
    );
  }

  const appId = String(env?.WHATSAPP_APP_ID || env?.META_APP_ID || '').trim();
  const appSecret = String(env?.WHATSAPP_APP_SECRET || '').trim();
  if (!appId || !appSecret) {
    throw new WhatsAppEmbeddedSignupError(
      'META_APP_NOT_CONFIGURED',
      'Platform Meta App credentials are not fully configured.'
    );
  }

  const graphBase = metaGraphApiBase(env);

  // 4. Exchange authorization code for access token
  let accessToken;
  try {
    const tokenResponse = await httpClient.get(`${graphBase}/oauth/access_token`, {
      params: {
        client_id: appId,
        client_secret: appSecret,
        code: code.trim(),
      },
      timeout: 15000,
    });
    accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      throw new Error('access_token missing in response');
    }
  } catch (err) {
    const providerErr = err?.response?.data?.error;
    console.error('META_CODE_EXCHANGE_ERROR', providerErr?.message || err?.message);
    throw new WhatsAppEmbeddedSignupError(
      'META_CODE_EXCHANGE_FAILED',
      'Failed to authorize with Meta. The code may be expired or already used.',
      { providerCode: providerErr?.code }
    );
  }

  // 5. Inspect WABA details & verify phone numbers
  const cleanWabaId = String(wabaId).trim();
  let phoneNumbersData = [];
  try {
    const phoneRes = await httpClient.get(`${graphBase}/${cleanWabaId}/phone_numbers`, {
      params: {
        fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type',
        access_token: accessToken,
      },
      timeout: 15000,
    });
    phoneNumbersData = Array.isArray(phoneRes.data?.data) ? phoneRes.data.data : [];
  } catch (err) {
    const providerErr = err?.response?.data?.error;
    console.error('META_WABA_PHONE_FETCH_ERROR', providerErr?.message || err?.message);
    throw new WhatsAppEmbeddedSignupError(
      'META_WABA_VERIFICATION_FAILED',
      'Failed to retrieve phone numbers for the provided WhatsApp Business Account.',
      { providerCode: providerErr?.code }
    );
  }

  if (phoneNumbersData.length === 0) {
    throw new WhatsAppEmbeddedSignupError(
      'WHATSAPP_PHONE_NUMBER_NOT_FOUND',
      'No phone numbers were found in your WhatsApp Business Account. Please complete phone verification in Meta Business Manager.'
    );
  }

  // Resolve matching or primary phone number
  let targetPhone = null;
  if (phoneNumberId) {
    const normalizedInput = String(phoneNumberId).trim().replace(/[^0-9]/g, '');
    targetPhone = phoneNumbersData.find((p) => String(p.id).trim() === normalizedInput) || null;
  }
  if (!targetPhone) {
    targetPhone = phoneNumbersData[0];
  }

  let normalizedExternalId;
  try {
    normalizedExternalId = normalizeWhatsAppExternalId(targetPhone.id);
  } catch {
    throw new WhatsAppEmbeddedSignupError(
      'WHATSAPP_PHONE_ID_INVALID',
      'The phone number ID returned from Meta is invalid.'
    );
  }

  // 6. Subscribe WABA to Platform Webhooks
  try {
    await httpClient.post(
      `${graphBase}/${cleanWabaId}/subscribed_apps`,
      {},
      {
        params: { access_token: accessToken },
        timeout: 15000,
      }
    );
    console.info(`WHATSAPP_WEBHOOK_SUBSCRIBED waba_id=${cleanWabaId}`);
  } catch (err) {
    const providerErr = err?.response?.data?.error;
    console.warn('META_WEBHOOK_SUBSCRIPTION_WARN', providerErr?.message || err?.message);
  }

  // 7. Tenant Isolation check: Verify phone number is not actively claimed by another tenant
  const existingActiveOwner = await database.query(
    `SELECT tc.id, tc.tenant_id, t.name AS tenant_name
       FROM tenant_channels tc
       JOIN tenants t ON t.id = tc.tenant_id
      WHERE tc.channel_type = 'WHATSAPP'
        AND tc.status = 'active'
        AND tc.tenant_id <> $1
        AND regexp_replace(
              regexp_replace(lower(trim(tc.external_channel_id)), '^whatsapp:\\s*', ''),
              '[^0-9]', '', 'g'
            ) = $2
      LIMIT 1`,
    [tenantId, normalizedExternalId]
  );

  if (existingActiveOwner.rowCount > 0) {
    throw new WhatsAppEmbeddedSignupError(
      'WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT',
      'This WhatsApp phone number is currently connected to another organization in SamChe. Please contact support or your administrator to transfer ownership.',
      {
        externalChannelId: normalizedExternalId,
        sourceTenantId: existingActiveOwner.rows[0].tenant_id,
      }
    );
  }

  // 8. Encrypt the access token securely for storage
  const encryptedTokenEnvelope = encryptWhatsAppCredential(accessToken, { env });

  const displayName = targetPhone.verified_name || targetPhone.display_phone_number || 'WhatsApp Business';
  const integrationKey = `whatsapp:${normalizedExternalId}`;
  const nowIso = new Date().toISOString();

  const integrationConfig = {
    whatsapp: {
      waba_id: cleanWabaId,
      phone_number_id: normalizedExternalId,
      display_phone_number: targetPhone.display_phone_number || null,
      verified_name: targetPhone.verified_name || null,
      quality_rating: targetPhone.quality_rating || 'UNKNOWN',
      code_verification_status: targetPhone.code_verification_status || 'VERIFIED',
      onboarded_via: 'EMBEDDED_SIGNUP',
      encrypted_access_token: encryptedTokenEnvelope,
      access_token_env: null,
      onboarded_at: nowIso,
      updated_at: nowIso,
    },
  };
  // 9. Transactional Channel & Integration Provisioning
  const client = await database.connect();
  let channel;
  try {
    await client.query('BEGIN');

    // Check if tenant already has a channel for this phone number
    const existingTenantChannel = await client.query(
      `SELECT id, tenant_id, status
         FROM tenant_channels
        WHERE tenant_id = $1
          AND channel_type = 'WHATSAPP'
          AND regexp_replace(
                regexp_replace(lower(trim(external_channel_id)), '^whatsapp:\\s*', ''),
                '[^0-9]', '', 'g'
              ) = $2
        LIMIT 1`,
      [tenantId, normalizedExternalId]
    );

    if (existingTenantChannel.rowCount > 0) {
      const updatedChannel = await client.query(
        `UPDATE tenant_channels
            SET display_name = $1,
                external_channel_id = $2,
                assistant_id = $3,
                status = 'active',
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $4 AND tenant_id = $5
          RETURNING *`,
        [displayName, normalizedExternalId, assistantId, existingTenantChannel.rows[0].id, tenantId]
      );
      channel = updatedChannel.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO tenant_channels
           (tenant_id, channel_type, display_name, external_channel_id, assistant_id, status)
         VALUES ($1, 'WHATSAPP', $2, $3, $4, 'active')
         RETURNING *`,
        [tenantId, displayName, normalizedExternalId, assistantId]
      );
      channel = inserted.rows[0];
    }

    // Converge channel_integrations
    await client.query(
      `INSERT INTO channel_integrations
         (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled, config)
       VALUES ($1, 'WHATSAPP', $2, $3, $4, TRUE, $5::jsonb)
       ON CONFLICT (integration_key) DO UPDATE SET
         integration_type = 'WHATSAPP',
         tenant_id = EXCLUDED.tenant_id,
         channel_id = EXCLUDED.channel_id,
         assistant_id = EXCLUDED.assistant_id,
         enabled = TRUE,
         config = EXCLUDED.config,
         updated_at = CURRENT_TIMESTAMP`,
      [integrationKey, tenantId, channel.id, assistantId, JSON.stringify(integrationConfig)]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.info(
    'WHATSAPP_EMBEDDED_SIGNUP_COMPLETED' +
    ' tenant=' + String(tenantId).slice(0, 8) +
    ' channel=' + String(channel.id).slice(0, 8) +
    ' phone_hash=' + whatsappPhoneNumberFingerprint(normalizedExternalId)
  );

  return {
    ok: true,
    channel: {
      id: channel.id,
      tenant_id: channel.tenant_id,
      assistant_id: channel.assistant_id,
      channel_type: 'WHATSAPP',
      display_name: channel.display_name,
      external_channel_id: normalizedExternalId,
      status: 'active',
    },
    connection: {
      waba_id: cleanWabaId,
      phone_number_id: normalizedExternalId,
      display_phone_number: targetPhone.display_phone_number || null,
      verified_name: targetPhone.verified_name || null,
      quality_rating: targetPhone.quality_rating || 'UNKNOWN',
      code_verification_status: targetPhone.code_verification_status || 'VERIFIED',
      status: 'CONNECTED',
    },
  };
}

/**
 * Returns current tenant WhatsApp channel & integration status for the dashboard.
 * NEVER emits raw access tokens or private secrets.
 */
export async function getWhatsAppChannelStatus({ database, tenantId }) {
  if (!database?.query || !tenantId) {
    throw new WhatsAppEmbeddedSignupError('INVALID_INPUT', 'Database and tenantId are required');
  }

  // 1. Entitlement check
  let entitled = false;
  try {
    const entitlements = await resolveEffectiveTenantEntitlements({ database, tenantId });
    entitled = Boolean(entitlements?.capabilities?.whatsapp?.entitled);
  } catch (err) {
    console.warn('WHATSAPP_STATUS_ENTITLEMENT_CHECK_FAILED', err?.message);
  }

  // 2. Fetch channel & integration details
  const result = await database.query(
    `SELECT tc.id AS channel_id, tc.tenant_id, tc.assistant_id, tc.display_name,
            tc.external_channel_id, tc.status AS channel_status, tc.created_at, tc.updated_at,
            a.name AS assistant_name, a.status AS assistant_status,
            ci.id AS integration_id, ci.enabled AS integration_enabled,
            ci.config AS integration_config, ci.updated_at AS integration_updated_at
       FROM tenant_channels tc
       LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
       LEFT JOIN channel_integrations ci
              ON ci.channel_id = tc.id AND ci.tenant_id = tc.tenant_id AND ci.integration_type = 'WHATSAPP'
      WHERE tc.tenant_id = $1
        AND tc.channel_type = 'WHATSAPP'
      ORDER BY tc.updated_at DESC
      LIMIT 1`,
    [tenantId]
  );

  if (result.rowCount === 0) {
    return {
      status: 'NOT_CONNECTED',
      entitled,
      channel: null,
      connection: null,
      assistant: null,
      action_required: entitled ? null : 'PLAN_UPGRADE_REQUIRED',
    };
  }

  const row = result.rows[0];
  const config = row.integration_config?.whatsapp || {};
  const isChannelActive = row.channel_status === 'active';
  const isIntegrationEnabled = row.integration_enabled === true;
  const isAssistantActive = row.assistant_id && String(row.assistant_status ?? '').toLowerCase() === 'active';

  let computedStatus = 'NOT_CONNECTED';
  let actionRequired = null;

  if (!entitled) {
    computedStatus = 'ACTION_REQUIRED';
    actionRequired = 'PLAN_UPGRADE_REQUIRED';
  } else if (!isChannelActive) {
    computedStatus = 'NOT_CONNECTED';
  } else if (!row.assistant_id || !isAssistantActive) {
    computedStatus = 'ACTION_REQUIRED';
    actionRequired = 'ASSISTANT_INACTIVE_OR_UNASSIGNED';
  } else if (!isIntegrationEnabled) {
    computedStatus = 'ACTION_REQUIRED';
    actionRequired = 'INTEGRATION_DISABLED';
  } else {
    computedStatus = 'CONNECTED';
  }

  return {
    status: computedStatus,
    entitled,
    action_required: actionRequired,
    channel: {
      id: row.channel_id,
      tenant_id: row.tenant_id,
      channel_type: 'WHATSAPP',
      display_name: row.display_name,
      external_channel_id: row.external_channel_id,
      status: row.channel_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    connection: {
      waba_id: config.waba_id || null,
      phone_number_id: config.phone_number_id || row.external_channel_id || null,
      display_phone_number: config.display_phone_number || null,
      verified_name: config.verified_name || row.display_name || null,
      quality_rating: config.quality_rating || null,
      code_verification_status: config.code_verification_status || null,
      onboarded_via: config.onboarded_via || 'MANUAL',
      onboarded_at: config.onboarded_at || null,
      has_credentials: Boolean(config.encrypted_access_token || config.access_token_env),
    },
    assistant: row.assistant_id ? {
      id: row.assistant_id,
      name: row.assistant_name,
      status: row.assistant_status,
      is_active: isAssistantActive,
    } : null,
  };
}

/**
 * Disconnects the tenant's WhatsApp channel.
 * Sets channel status to 'inactive' and integration enabled to false.
 */
export async function disconnectWhatsAppChannel({ database, tenantId, channelId = null }) {
  if (!database?.query || !tenantId) {
    throw new WhatsAppEmbeddedSignupError('INVALID_INPUT', 'Database and tenantId are required');
  }

  const client = await database.connect();
  try {
    await client.query('BEGIN');

    const channelRes = await client.query(
      `SELECT id, tenant_id FROM tenant_channels
        WHERE tenant_id = $1 AND channel_type = 'WHATSAPP'
          ${channelId ? 'AND id = $2' : ''}
        ORDER BY updated_at DESC LIMIT 1`,
      channelId ? [tenantId, channelId] : [tenantId]
    );

    if (channelRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: true, status: 'NOT_CONNECTED' };
    }

    const resolvedChannelId = channelRes.rows[0].id;

    await client.query(
      `UPDATE tenant_channels
          SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [resolvedChannelId, tenantId]
    );

    await client.query(
      `UPDATE channel_integrations
          SET enabled = FALSE,
              updated_at = CURRENT_TIMESTAMP
        WHERE channel_id = $1 AND tenant_id = $2 AND integration_type = 'WHATSAPP'`,
      [resolvedChannelId, tenantId]
    );

    await client.query('COMMIT');
    console.info(`WHATSAPP_CHANNEL_DISCONNECTED tenant=${String(tenantId).slice(0, 8)} channel=${String(resolvedChannelId).slice(0, 8)}`);
    return { ok: true, status: 'DISCONNECTED', channel_id: resolvedChannelId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}