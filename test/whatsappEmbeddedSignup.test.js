import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  deriveWhatsAppEncryptionKey,
  encryptWhatsAppCredential,
  decryptWhatsAppCredential,
} from '../services/whatsapp-credential-crypto.js';
import {
  generateWhatsAppOAuthState,
  verifyWhatsAppOAuthState,
} from '../services/whatsapp-oauth-state-service.js';
import {
  resolveWhatsAppOutboundCredential,
  WHATSAPP_CREDENTIAL_SOURCES,
} from '../services/whatsapp-credential-resolution-service.js';
import {
  getWhatsAppEmbeddedSignupConfig,
  exchangeAndOnboardWhatsApp,
  getWhatsAppChannelStatus,
  disconnectWhatsAppChannel,
  WhatsAppEmbeddedSignupError,
} from '../services/whatsapp-embedded-signup-service.js';

function createMockDatabase({
  tenants = [],
  subscriptions = [],
  entitlementOverrides = [],
  assistants = [],
  channels = [],
  integrations = [],
} = {}) {
  const state = {
    tenants: [...tenants],
    subscriptions: [...subscriptions],
    entitlementOverrides: [...entitlementOverrides],
    assistants: [...assistants],
    channels: [...channels],
    integrations: [...integrations],
  };

  const queryFn = async (sql, params = []) => {
    const text = String(sql).trim();

    if (text.includes('FROM tenant_subscriptions s') || text.includes('FROM tenants t')) {
      const tenantId = params[0];
      const sub = state.subscriptions.find((s) => s.tenant_id === tenantId);
      const tenant = state.tenants.find((t) => t.id === tenantId) || { id: tenantId, plan_code: 'GROWTH' };
      const planCode = sub?.plan_code || tenant.plan_code || 'GROWTH';

      const includedCapabilities = ['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'].includes(planCode)
        ? (planCode === 'STARTER' ? ['webchat'] : ['webchat', 'whatsapp', 'shared_inbox', 'contextual_followup'])
        : [];

      return {
        rowCount: 1,
        rows: [{
          id: sub?.id || 'sub-1',
          tenant_id: tenantId,
          plan_code: planCode,
          billing_cycle: 'MONTHLY',
          currency: 'AED',
          monthly_price_aed: 500,
          annual_price_aed: 5000,
          setup_fee_aed: 0,
          status: 'ACTIVE',
          started_at: null,
          current_period_start: null,
          current_period_end: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          display_name: planCode,
          customer_subtitle: '',
          rank: planCode === 'STARTER' ? 1 : 2,
          included_capabilities: includedCapabilities,
          included_limits: { monthly_active_conversations: 1000 },
          plan_metadata: {},
        }],
      };
    }

    if (text.includes('FROM tenant_entitlement_overrides')) {
      const tenantId = params[0];
      const overrides = state.entitlementOverrides.filter((o) => o.tenant_id === tenantId);
      return { rowCount: overrides.length, rows: overrides };
    }

    if (text.includes('FROM tenant_usage_allocations')) {
      return { rowCount: 0, rows: [] };
    }

    if (text.includes('SELECT COUNT(*)::integer FROM ai_assistants')) {
      return {
        rowCount: 1,
        rows: [{
          active_assistants_count: 1,
          team_users_count: 1,
          active_integrations_count: 0,
          webchat_integrations_count: 0,
          whatsapp_integrations_count: state.integrations.filter((i) => i.enabled && i.integration_type === 'WHATSAPP').length,
          guide_integrations_count: 0,
          visual_ai_config_enabled: false,
        }],
      };
    }

    if (text.includes('FROM ai_assistants') && text.includes('WHERE id = $1 AND tenant_id = $2')) {
      const [assistantId, tenantId] = params;
      const found = state.assistants.find(
        (a) => a.id === assistantId && a.tenant_id === tenantId && String(a.status).toLowerCase() === 'active'
      );
      return { rowCount: found ? 1 : 0, rows: found ? [found] : [] };
    }

    if (text.includes('FROM tenant_channels tc') && text.includes('tc.tenant_id <> $1')) {
      const [tenantId, normalizedPhone] = params;
      const conflict = state.channels.find(
        (c) => c.channel_type === 'WHATSAPP' && c.status === 'active' && c.tenant_id !== tenantId && c.external_channel_id === normalizedPhone
      );
      return { rowCount: conflict ? 1 : 0, rows: conflict ? [conflict] : [] };
    }
    if (text.includes('FROM tenant_channels') && text.includes('tenant_id = $1') && !text.includes('tc.tenant_id <> $1') && !text.includes('LEFT JOIN')) {
      const tenantId = params[0];
      const normalizedPhone = params[1];
      let matches = state.channels.filter((c) => c.tenant_id === tenantId && c.channel_type === 'WHATSAPP');
      if (normalizedPhone) {
        matches = matches.filter((c) => c.external_channel_id === normalizedPhone);
      }
      return { rowCount: matches.length, rows: matches };
    }


    if (text.startsWith('UPDATE tenant_channels')) {
      if (text.includes('status = \'inactive\'')) {
        const [channelId, tenantId] = params;
        const target = state.channels.find((c) => c.id === channelId && c.tenant_id === tenantId);
        if (target) target.status = 'inactive';
        return { rowCount: target ? 1 : 0, rows: target ? [target] : [] };
      }
      const [displayName, externalId, assistantId, channelId, tenantId] = params;
      const target = state.channels.find((c) => c.id === channelId && c.tenant_id === tenantId);
      if (target) {
        target.display_name = displayName;
        target.external_channel_id = externalId;
        target.assistant_id = assistantId;
        target.status = 'active';
      }
      return { rowCount: target ? 1 : 0, rows: target ? [target] : [] };
    }

    if (text.startsWith('INSERT INTO tenant_channels')) {
      const [tenantId, displayName, externalId, assistantId] = params;
      const newChannel = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        channel_type: 'WHATSAPP',
        display_name: displayName,
        external_channel_id: externalId,
        assistant_id: assistantId,
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.channels.push(newChannel);
      return { rowCount: 1, rows: [newChannel] };
    }

    if (text.startsWith('INSERT INTO channel_integrations')) {
      const [integrationKey, tenantId, channelId, assistantId, configJson] = [params[0], params[1], params[2], params[3], params[4]];
      let existing = state.integrations.find((i) => i.integration_key === integrationKey);
      const parsedConfig = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
      if (existing) {
        existing.tenant_id = tenantId;
        existing.channel_id = channelId;
        existing.assistant_id = assistantId;
        existing.enabled = true;
        existing.config = parsedConfig;
      } else {
        existing = {
          id: crypto.randomUUID(),
          integration_key: integrationKey,
          integration_type: 'WHATSAPP',
          tenant_id: tenantId,
          channel_id: channelId,
          assistant_id: assistantId,
          enabled: true,
          config: parsedConfig,
        };
        state.integrations.push(existing);
      }
      return { rowCount: 1, rows: [existing] };
    }

    if (text.startsWith('UPDATE channel_integrations')) {
      const [channelId, tenantId] = params;
      const target = state.integrations.find((i) => i.channel_id === channelId && i.tenant_id === tenantId);
      if (target) target.enabled = false;
      return { rowCount: target ? 1 : 0, rows: target ? [target] : [] };
    }

    if (text.includes('FROM tenant_channels tc') && text.includes('LEFT JOIN channel_integrations ci')) {
      const tenantId = params[0];
      const ch = state.channels.find((c) => c.tenant_id === tenantId && c.channel_type === 'WHATSAPP');
      if (!ch) return { rowCount: 0, rows: [] };
      const ast = state.assistants.find((a) => a.id === ch.assistant_id);
      const ci = state.integrations.find((i) => i.channel_id === ch.id);
      return {
        rowCount: 1,
        rows: [{
          channel_id: ch.id,
          tenant_id: ch.tenant_id,
          assistant_id: ch.assistant_id,
          display_name: ch.display_name,
          external_channel_id: ch.external_channel_id,
          channel_status: ch.status,
          created_at: ch.created_at,
          updated_at: ch.updated_at,
          assistant_name: ast?.name || null,
          assistant_status: ast?.status || null,
          integration_id: ci?.id || null,
          integration_enabled: ci?.enabled ?? false,
          integration_config: ci?.config || {},
          integration_updated_at: ci?.updated_at || null,
        }],
      };
    }

    return { rowCount: 0, rows: [] };
  };

  return {
    query: queryFn,
    connect: async () => ({
      query: queryFn,
      release: () => {},
    }),
    state,
  };
}

function createMockMetaHttpClient({
  accessToken = 'mock-meta-access-token-xyz',
  wabaId = '123456789012345',
  phoneNumbers = [
    {
      id: '109876543210987',
      display_phone_number: '+1 555-0199',
      verified_name: 'Acme Support',
      quality_rating: 'GREEN',
      code_verification_status: 'VERIFIED',
    },
  ],
  failTokenExchange = false,
  failPhoneFetch = false,
  failSubscription = false,
} = {}) {
  const calls = [];

  return {
    calls,
    get: async (url, options = {}) => {
      calls.push({ method: 'GET', url, options });
      if (url.includes('/oauth/access_token')) {
        if (failTokenExchange) {
          const err = new Error('Invalid OAuth code');
          err.response = { status: 400, data: { error: { message: 'Invalid verification code', code: 100 } } };
          throw err;
        }
        return { data: { access_token: accessToken, token_type: 'bearer' } };
      }
      if (url.includes('/phone_numbers')) {
        if (failPhoneFetch) {
          const err = new Error('WABA not found');
          err.response = { status: 404, data: { error: { message: 'WABA not found', code: 80001 } } };
          throw err;
        }
        return { data: { data: phoneNumbers } };
      }
      return { data: {} };
    },
    post: async (url, body, options = {}) => {
      calls.push({ method: 'POST', url, body, options });
      if (url.includes('/subscribed_apps')) {
        if (failSubscription) {
          const err = new Error('Webhook subscription failed');
          err.response = { status: 400, data: { error: { message: 'Permissions missing', code: 200 } } };
          throw err;
        }
        return { data: { success: true } };
      }
      return { data: {} };
    },
  };
}

test('WhatsApp Credential Crypto: encrypts and decrypts access token with AES-256-GCM', () => {
  const env = { WHATSAPP_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  const rawToken = 'EAAG123456789MetaTokenSecretXYZ';

  const envelope = encryptWhatsAppCredential(rawToken, { env });
  assert.ok(envelope.ciphertext, 'Ciphertext should be present');
  assert.ok(envelope.iv, 'IV should be present');
  assert.ok(envelope.authTag, 'Auth tag should be present');
  assert.equal(envelope.version, 'v1');

  // Verify raw token is not plaintext inside ciphertext
  assert.equal(envelope.ciphertext.includes('MetaTokenSecretXYZ'), false);

  const decrypted = decryptWhatsAppCredential(envelope, { env });
  assert.equal(decrypted, rawToken);

  // Decryption fails safely with wrong key
  const wrongEnv = { WHATSAPP_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  const failedDecryption = decryptWhatsAppCredential(envelope, { env: wrongEnv });
  assert.equal(failedDecryption, null);
});

test('WhatsApp OAuth State: generates and verifies cryptographically signed state token', () => {
  const env = { JWT_SECRET: 'test-secret-key-12345' };
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  const stateToken = generateWhatsAppOAuthState({ tenantId, userId, env });
  assert.ok(stateToken.includes('.'), 'State token must have header.signature format');

  const check = verifyWhatsAppOAuthState(stateToken, { tenantId, userId, env });
  assert.equal(check.valid, true);
  assert.equal(check.payload.tenantId, tenantId);
  assert.equal(check.payload.userId, userId);

  // Rejects wrong tenant or user
  const wrongTenantCheck = verifyWhatsAppOAuthState(stateToken, { tenantId: crypto.randomUUID(), userId, env });
  assert.equal(wrongTenantCheck.valid, false);
  assert.equal(wrongTenantCheck.error, 'STATE_TENANT_MISMATCH');

  // Rejects tampered token
  const tampered = stateToken.slice(0, -4) + 'abcd';
  const tamperedCheck = verifyWhatsAppOAuthState(tampered, { tenantId, userId, env });
  assert.equal(tamperedCheck.valid, false);
  assert.equal(tamperedCheck.error, 'STATE_SIGNATURE_MISMATCH');
});

test('WhatsApp Credential Resolution: resolves decrypted integration-scoped token, env-ref, or platform fallback', () => {
  const env = {
    WHATSAPP_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    WHATSAPP_TOKEN: 'platform-fallback-token-abc',
    WHATSAPP_CUSTOM_ENV: 'custom-env-token-123',
  };

  // Case 1: Encrypted token in integration config
  const rawToken = 'encrypted-tenant-token-789';
  const envelope = encryptWhatsAppCredential(rawToken, { env });
  const integrationWithEncrypted = {
    whatsapp: {
      encrypted_access_token: envelope,
    },
  };

  const resolution1 = resolveWhatsAppOutboundCredential({
    integrationConfig: integrationWithEncrypted,
    env,
  });
  assert.equal(resolution1.source, WHATSAPP_CREDENTIAL_SOURCES.INTEGRATION_SCOPED);
  assert.equal(resolution1.accessToken, rawToken);

  // Case 2: Integration-scoped env var reference
  const integrationWithEnvRef = {
    whatsapp: {
      access_token_env: 'WHATSAPP_CUSTOM_ENV',
    },
  };
  const resolution2 = resolveWhatsAppOutboundCredential({
    integrationConfig: integrationWithEnvRef,
    env,
  });
  assert.equal(resolution2.source, WHATSAPP_CREDENTIAL_SOURCES.INTEGRATION_SCOPED);
  assert.equal(resolution2.accessToken, 'custom-env-token-123');

  // Case 3: Platform fallback
  const resolution3 = resolveWhatsAppOutboundCredential({
    integrationConfig: null,
    env,
  });
  assert.equal(resolution3.source, WHATSAPP_CREDENTIAL_SOURCES.PLATFORM_FALLBACK);
  assert.equal(resolution3.accessToken, 'platform-fallback-token-abc');
});

test('WhatsApp Embedded Signup: successful fresh tenant onboarding with Meta API mocks', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Acme Corp', plan_code: 'GROWTH' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Support AI', status: 'active' }],
  });

  const httpClient = createMockMetaHttpClient({
    accessToken: 'exchanged-meta-access-token-001',
    wabaId: 'waba-999',
    phoneNumbers: [
      {
        id: '15551234567',
        display_phone_number: '+1 (555) 123-4567',
        verified_name: 'Acme Official',
        quality_rating: 'GREEN',
        code_verification_status: 'VERIFIED',
      },
    ],
  });

  // Step 1: Get Config
  const config = await getWhatsAppEmbeddedSignupConfig({
    database: db,
    tenantId,
    userId,
    env,
  });
  assert.equal(config.entitled, true);
  assert.equal(config.app_id, 'meta-app-12345');
  assert.equal(config.config_id, 'meta-config-abcde');
  assert.ok(config.state_token, 'Signed state token must be issued');

  // Step 2: Complete Embedded Signup exchange
  const result = await exchangeAndOnboardWhatsApp({
    database: db,
    tenantId,
    userId,
    code: 'meta-auth-code-123',
    wabaId: 'waba-999',
    phoneNumberId: '15551234567',
    assistantId,
    oauthState: config.state_token,
    httpClient,
    env,
  });

  assert.equal(result.ok, true);
  assert.equal(result.connection.status, 'CONNECTED');
  assert.equal(result.connection.waba_id, 'waba-999');
  assert.equal(result.connection.phone_number_id, '15551234567');
  assert.equal(result.connection.verified_name, 'Acme Official');

  // Verify webhook subscription call was made
  const subscriptionCall = httpClient.calls.find((c) => c.url.includes('/subscribed_apps'));
  assert.ok(subscriptionCall, 'WABA subscribed_apps endpoint must be invoked');

  // Verify database record has channel and integration with encrypted token
  assert.equal(db.state.channels.length, 1);
  assert.equal(db.state.channels[0].status, 'active');
  assert.equal(db.state.channels[0].external_channel_id, '15551234567');

  assert.equal(db.state.integrations.length, 1);
  const integrationConfig = db.state.integrations[0].config;
  assert.ok(integrationConfig?.whatsapp?.encrypted_access_token, 'Encrypted token must be persisted');
  assert.equal(integrationConfig.whatsapp.access_token, undefined, 'Raw token must NEVER be persisted in plaintext');

  // Step 3: Get Status
  const status = await getWhatsAppChannelStatus({ database: db, tenantId });
  assert.equal(status.status, 'CONNECTED');
  assert.equal(status.entitled, true);
  assert.equal(status.connection.has_credentials, true);
  assert.equal(status.connection.verified_name, 'Acme Official');
  assert.equal(status.assistant.id, assistantId);
});

test('WhatsApp Embedded Signup: server-side entitlement enforcement rejects unentitled plan (STARTER)', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Starter Corp', plan_code: 'STARTER' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Support AI', status: 'active' }],
  });

  const config = await getWhatsAppEmbeddedSignupConfig({
    database: db,
    tenantId,
    userId,
    env,
  });
  assert.equal(config.entitled, false);
  assert.equal(config.min_plan, 'GROWTH');

  // Generating state manually and attempting onboarding still fails server-side
  const stateToken = generateWhatsAppOAuthState({ tenantId, userId, env });
  const httpClient = createMockMetaHttpClient();

  await assert.rejects(
    async () => {
      await exchangeAndOnboardWhatsApp({
        database: db,
        tenantId,
        userId,
        code: 'some-code',
        wabaId: 'waba-1',
        phoneNumberId: '15551234567',
        assistantId,
        oauthState: stateToken,
        httpClient,
        env,
      });
    },
    (err) => {
      assert.ok(err instanceof WhatsAppEmbeddedSignupError);
      assert.equal(err.code, 'TENANT_NOT_ENTITLED');
      return true;
    }
  );
});

test('WhatsApp Embedded Signup: strict tenant isolation prevents claiming another tenant\'s active WhatsApp phone', async () => {
  const tenantA = crypto.randomUUID();
  const tenantB = crypto.randomUUID();
  const userIdB = crypto.randomUUID();
  const assistantB = crypto.randomUUID();
  const sharedPhoneId = '15559876543';

  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [
      { id: tenantA, name: 'Tenant A', plan_code: 'GROWTH' },
      { id: tenantB, name: 'Tenant B', plan_code: 'GROWTH' },
    ],
    assistants: [{ id: assistantB, tenant_id: tenantB, name: 'AI B', status: 'active' }],
    channels: [
      {
        id: crypto.randomUUID(),
        tenant_id: tenantA,
        channel_type: 'WHATSAPP',
        display_name: 'Tenant A WhatsApp',
        external_channel_id: sharedPhoneId,
        status: 'active',
      },
    ],
  });

  const stateToken = generateWhatsAppOAuthState({ tenantId: tenantB, userId: userIdB, env });
  const httpClient = createMockMetaHttpClient({
    phoneNumbers: [{ id: sharedPhoneId, display_phone_number: '+1 555-987-6543' }],
  });

  await assert.rejects(
    async () => {
      await exchangeAndOnboardWhatsApp({
        database: db,
        tenantId: tenantB,
        userId: userIdB,
        code: 'some-auth-code',
        wabaId: 'waba-b',
        phoneNumberId: sharedPhoneId,
        assistantId: assistantB,
        oauthState: stateToken,
        httpClient,
        env,
      });
    },
    (err) => {
      assert.ok(err instanceof WhatsAppEmbeddedSignupError);
      assert.equal(err.code, 'WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT');
      return true;
    }
  );
});

test('WhatsApp Embedded Signup: disconnect and reconnect lifecycle', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const phoneId = '15551112233';

  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Lifecycle Tenant', plan_code: 'GROWTH' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Assistant', status: 'active' }],
  });

  const httpClient = createMockMetaHttpClient({
    phoneNumbers: [{ id: phoneId, display_phone_number: '+1 555-111-2233' }],
  });

  const stateToken = generateWhatsAppOAuthState({ tenantId, userId, env });

  // 1. Initial Connect
  await exchangeAndOnboardWhatsApp({
    database: db,
    tenantId,
    userId,
    code: 'code-1',
    wabaId: 'waba-life',
    phoneNumberId: phoneId,
    assistantId,
    oauthState: stateToken,
    httpClient,
    env,
  });

  let status = await getWhatsAppChannelStatus({ database: db, tenantId });
  assert.equal(status.status, 'CONNECTED');

  // 2. Disconnect
  const disconnectResult = await disconnectWhatsAppChannel({ database: db, tenantId });
  assert.equal(disconnectResult.ok, true);
  assert.equal(disconnectResult.status, 'DISCONNECTED');

  status = await getWhatsAppChannelStatus({ database: db, tenantId });
  assert.equal(status.status, 'NOT_CONNECTED');

  // 3. Reconnect (idempotent update)
  const newStateToken = generateWhatsAppOAuthState({ tenantId, userId, env });
  const reconnectResult = await exchangeAndOnboardWhatsApp({
    database: db,
    tenantId,
    userId,
    code: 'code-2',
    wabaId: 'waba-life',
    phoneNumberId: phoneId,
    assistantId,
    oauthState: newStateToken,
    httpClient,
    env,
  });

  assert.equal(reconnectResult.ok, true);
  status = await getWhatsAppChannelStatus({ database: db, tenantId });
  assert.equal(status.status, 'CONNECTED');
});

test('WhatsApp Embedded Signup: handles Meta API errors and invalid code gracefully', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Test Tenant', plan_code: 'GROWTH' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Assistant', status: 'active' }],
  });

  const failingHttpClient = createMockMetaHttpClient({ failTokenExchange: true });
  const stateToken = generateWhatsAppOAuthState({ tenantId, userId, env });

  await assert.rejects(
    async () => {
      await exchangeAndOnboardWhatsApp({
        database: db,
        tenantId,
        userId,
        code: 'expired-or-bad-code',
        wabaId: 'waba-123',
        assistantId,
        oauthState: stateToken,
        httpClient: failingHttpClient,
        env,
      });
    },
    (err) => {
      assert.ok(err instanceof WhatsAppEmbeddedSignupError);
      assert.equal(err.code, 'META_CODE_EXCHANGE_FAILED');
      return true;
    }
  );
});

test('WhatsApp Embedded Signup: rejects onboarding if no verified phone number exists on WABA', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Test Tenant', plan_code: 'GROWTH' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Assistant', status: 'active' }],
  });

  const emptyPhoneHttpClient = createMockMetaHttpClient({ phoneNumbers: [] });
  const stateToken = generateWhatsAppOAuthState({ tenantId, userId, env });

  await assert.rejects(
    async () => {
      await exchangeAndOnboardWhatsApp({
        database: db,
        tenantId,
        userId,
        code: 'valid-code',
        wabaId: 'waba-no-phones',
        assistantId,
        oauthState: stateToken,
        httpClient: emptyPhoneHttpClient,
        env,
      });
    },
    (err) => {
      assert.ok(err instanceof WhatsAppEmbeddedSignupError);
      assert.equal(err.code, 'WHATSAPP_PHONE_NUMBER_NOT_FOUND');
      return true;
    }
  );
});

test('WhatsApp Embedded Signup: rejects expired OAuth state token', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Test Tenant', plan_code: 'GROWTH' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Assistant', status: 'active' }],
  });

  // Generate expired token (-1 ms expiration)
  const expiredStateToken = generateWhatsAppOAuthState({
    tenantId,
    userId,
    expiresInMs: -1000,
    env,
  });

  await assert.rejects(
    async () => {
      await exchangeAndOnboardWhatsApp({
        database: db,
        tenantId,
        userId,
        code: 'valid-code',
        wabaId: 'waba-123',
        assistantId,
        oauthState: expiredStateToken,
        httpClient: createMockMetaHttpClient(),
        env,
      });
    },
    (err) => {
      assert.ok(err instanceof WhatsAppEmbeddedSignupError);
      assert.equal(err.code, 'OAUTH_STATE_INVALID');
      return true;
    }
  );
});

test('WhatsApp Embedded Signup: rejects inactive or unowned assistant', async () => {
  const tenantId = crypto.randomUUID();
  const otherTenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherAssistantId = crypto.randomUUID();
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Test Tenant', plan_code: 'GROWTH' }],
    assistants: [{ id: otherAssistantId, tenant_id: otherTenantId, name: 'Other Assistant', status: 'active' }],
  });

  const stateToken = generateWhatsAppOAuthState({ tenantId, userId, env });

  await assert.rejects(
    async () => {
      await exchangeAndOnboardWhatsApp({
        database: db,
        tenantId,
        userId,
        code: 'valid-code',
        wabaId: 'waba-123',
        assistantId: otherAssistantId,
        oauthState: stateToken,
        httpClient: createMockMetaHttpClient(),
        env,
      });
    },
    (err) => {
      assert.ok(err instanceof WhatsAppEmbeddedSignupError);
      assert.equal(err.code, 'WHATSAPP_ASSISTANT_INELIGIBLE');
      return true;
    }
  );
});


test('WhatsApp Embedded Signup: duplicate onboarding is idempotent and updates existing channel', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const phoneId = '15554443322';
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Idempotent Corp', plan_code: 'GROWTH' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Assistant', status: 'active' }],
  });

  const httpClient = createMockMetaHttpClient({
    accessToken: 'token-v1',
    phoneNumbers: [{ id: phoneId, display_phone_number: '+1 555-444-3322', verified_name: 'Name V1' }],
  });

  const stateToken1 = generateWhatsAppOAuthState({ tenantId, userId, env });
  const result1 = await exchangeAndOnboardWhatsApp({
    database: db,
    tenantId,
    userId,
    code: 'code-1',
    wabaId: 'waba-idempotent',
    phoneNumberId: phoneId,
    assistantId,
    oauthState: stateToken1,
    httpClient,
    env,
  });
  assert.equal(result1.ok, true);
  assert.equal(db.state.channels.length, 1);
  const initialChannelId = db.state.channels[0].id;

  // Second onboarding with updated verified name
  const httpClient2 = createMockMetaHttpClient({
    accessToken: 'token-v2',
    phoneNumbers: [{ id: phoneId, display_phone_number: '+1 555-444-3322', verified_name: 'Name V2' }],
  });
  const stateToken2 = generateWhatsAppOAuthState({ tenantId, userId, env });
  const result2 = await exchangeAndOnboardWhatsApp({
    database: db,
    tenantId,
    userId,
    code: 'code-2',
    wabaId: 'waba-idempotent',
    phoneNumberId: phoneId,
    assistantId,
    oauthState: stateToken2,
    httpClient: httpClient2,
    env,
  });
  assert.equal(result2.ok, true);
  // Channel count remains exactly 1 and retains same ID
  assert.equal(db.state.channels.length, 1);
  assert.equal(db.state.channels[0].id, initialChannelId);
  assert.equal(db.state.channels[0].display_name, 'Name V2');
});

test('WhatsApp Embedded Signup: duplicate WABA subscription warning does not block onboarding', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const phoneId = '15557778899';
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Warning Corp', plan_code: 'GROWTH' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Assistant', status: 'active' }],
  });

  const httpClient = createMockMetaHttpClient({
    accessToken: 'token-with-sub-warn',
    phoneNumbers: [{ id: phoneId, display_phone_number: '+1 555-777-8899', verified_name: 'Warning Corp' }],
    failSubscription: true,
  });

  const stateToken = generateWhatsAppOAuthState({ tenantId, userId, env });
  const result = await exchangeAndOnboardWhatsApp({
    database: db,
    tenantId,
    userId,
    code: 'code-sub-warn',
    wabaId: 'waba-sub-warn',
    phoneNumberId: phoneId,
    assistantId,
    oauthState: stateToken,
    httpClient,
    env,
  });

  assert.equal(result.ok, true);
  assert.equal(result.connection.status, 'CONNECTED');
});


test('WhatsApp Embedded Signup: security - zero secrets or raw tokens returned to frontend', async () => {
  const tenantId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const rawToken = 'super-secret-access-token-999';
  const env = {
    WHATSAPP_APP_ID: 'meta-app-12345',
    WHATSAPP_APP_SECRET: 'meta-app-secret-67890',
    WHATSAPP_CONFIG_ID: 'meta-config-abcde',
    WHATSAPP_TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    JWT_SECRET: 'test-jwt-secret-xyz',
  };

  const envelope = encryptWhatsAppCredential(rawToken, { env });
  const channelId = crypto.randomUUID();

  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Security Corp', plan_code: 'GROWTH' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Assistant', status: 'active' }],
    channels: [{
      id: channelId,
      tenant_id: tenantId,
      channel_type: 'WHATSAPP',
      display_name: 'Security WhatsApp',
      external_channel_id: '15550001111',
      assistant_id: assistantId,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }],
    integrations: [{
      id: crypto.randomUUID(),
      integration_key: 'whatsapp:15550001111',
      integration_type: 'WHATSAPP',
      tenant_id: tenantId,
      channel_id: channelId,
      assistant_id: assistantId,
      enabled: true,
      config: {
        whatsapp: {
          waba_id: 'waba-sec',
          phone_number_id: '15550001111',
          encrypted_access_token: envelope,
        },
      },
    }],
  });

  const config = await getWhatsAppEmbeddedSignupConfig({ database: db, tenantId, userId, env });
  const configKeys = Object.keys(config);
  assert.equal(configKeys.includes('app_secret'), false);
  assert.equal(configKeys.includes('access_token'), false);
  assert.equal(configKeys.includes('token_encryption_key'), false);

  const status = await getWhatsAppChannelStatus({ database: db, tenantId });
  const statusJson = JSON.stringify(status);
  assert.equal(statusJson.includes(rawToken), false, 'Raw token must NEVER appear in status response');
  assert.equal(statusJson.includes('ciphertext'), false, 'Encrypted envelope must NEVER appear in status response');
  assert.equal(status.connection.has_credentials, true, 'has_credentials boolean only');
});

test('WhatsApp Embedded Signup: fresh tenant onboarding requires zero manual DB setup or per-tenant ENV', async () => {
  const freshTenantId = crypto.randomUUID();
  const freshUserId = crypto.randomUUID();
  const env = {
    WHATSAPP_APP_ID: 'platform-meta-app-id',
    WHATSAPP_APP_SECRET: 'platform-meta-app-secret',
    JWT_SECRET: 'platform-jwt-secret',
  };

  const db = createMockDatabase({
    tenants: [{ id: freshTenantId, name: 'Fresh Startup Inc', plan_code: 'GROWTH' }],
  });

  const config = await getWhatsAppEmbeddedSignupConfig({
    database: db,
    tenantId: freshTenantId,
    userId: freshUserId,
    env,
  });

  assert.equal(config.entitled, true);
  assert.equal(config.configured, true);
  assert.equal(config.config_id, '29049226651367865', 'Uses canonical configuration ID by default');
  assert.ok(config.state_token, 'Issues signed OAuth state token for fresh tenant');

  const status = await getWhatsAppChannelStatus({ database: db, tenantId: freshTenantId });
  assert.equal(status.status, 'NOT_CONNECTED');
  assert.equal(status.channel, null);
  assert.equal(status.connection, null);
});
