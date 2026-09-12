import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureWebChatIntegration,
  getWebChatIntegrationForTenant,
  normalizeWebChatAppearance,
  TenantWebChatProvisioningError,
} from '../services/tenant-web-chat-provisioning-service.js';

function createMockDatabase({
  tenants = [],
  assistants = [],
  channels = [],
  integrations = [],
} = {}) {
  const state = {
    tenants: tenants.map((t) => ({ ...t })),
    assistants: assistants.map((a) => ({ ...a })),
    channels: channels.map((c) => ({ ...c })),
    integrations: integrations.map((i) => ({ ...i })),
  };

  const client = {
    async query(sql, params = []) {
      const cleanSql = sql.replace(/\s+/g, ' ').trim();

      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(cleanSql)) {
        return { rowCount: 0, rows: [] };
      }

      if (cleanSql.startsWith('SELECT id, name, status, plan_code FROM tenants WHERE id = $1')) {
        const row = state.tenants.find((t) => t.id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.startsWith('SELECT id, name, model, status FROM ai_assistants WHERE id = $1 AND tenant_id = $2')) {
        const row = state.assistants.find((a) => a.id === params[0] && a.tenant_id === params[1]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.includes('FROM channel_integrations') && cleanSql.includes('integration_type = \'WEB_CHAT\'') && cleanSql.includes('ORDER BY created_at ASC LIMIT 1')) {
        const row = state.integrations.find((i) => i.tenant_id === params[0] && i.integration_type === 'WEB_CHAT' && i.enabled);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.startsWith('SELECT id, name, model, status FROM ai_assistants WHERE tenant_id = $1 AND status = \'active\'')) {
        const row = state.assistants.find((a) => a.tenant_id === params[0] && a.status === 'active');
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.startsWith('INSERT INTO ai_assistants')) {
        const newAssistant = {
          id: '55555555-5555-4555-8555-555555555555',
          tenant_id: params[0],
          name: 'Web Chat Core',
          model: 'gpt-4o-mini',
          status: 'active',
        };
        state.assistants.push(newAssistant);
        return { rowCount: 1, rows: [{ ...newAssistant }] };
      }

      if (cleanSql.startsWith('SELECT id, tenant_id, channel_type, display_name, external_channel_id, assistant_id, status FROM tenant_channels WHERE id = $1 AND tenant_id = $2')) {
        const row = state.channels.find((c) => c.id === params[0] && c.tenant_id === params[1]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.includes('FROM tenant_channels') && cleanSql.includes('channel_type = \'WEB_CHAT\'')) {
        const row = state.channels.find((c) => c.tenant_id === params[0] && c.channel_type === 'WEB_CHAT');
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.startsWith('INSERT INTO tenant_channels')) {
        const newChannel = {
          id: '66666666-6666-4666-8666-666666666666',
          tenant_id: params[0],
          channel_type: 'WEB_CHAT',
          display_name: params[1],
          external_channel_id: params[2],
          assistant_id: params[3],
          status: 'active',
        };
        state.channels.push(newChannel);
        return { rowCount: 1, rows: [{ ...newChannel }] };
      }

      if (cleanSql.startsWith('UPDATE tenant_channels')) {
        const ch = state.channels.find((c) => (c.id === params[3] && c.tenant_id === params[4]) || (c.id === params[1] && c.tenant_id === params[2]));
        if (ch) {
          ch.assistant_id = params[0];
          if (params[1]) ch.status = params[1];
          if (params[2]) ch.display_name = params[2];
        }
        return { rowCount: ch ? 1 : 0, rows: ch ? [{ ...ch }] : [] };
      }

      if (cleanSql.startsWith('SELECT id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled FROM channel_integrations WHERE integration_key = $1')) {
        const row = state.integrations.find((i) => i.integration_key === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.includes('FROM channel_integrations') && cleanSql.includes('WHERE tenant_id = $1 AND integration_type = \'WEB_CHAT\'')) {
        const matches = state.integrations.filter((i) => i.tenant_id === params[0] && i.integration_type === 'WEB_CHAT');
        matches.sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0));
        const row = matches[0];
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.startsWith('INSERT INTO channel_integrations')) {
        const newIntegration = {
          id: '77777777-7777-4777-8777-777777777777',
          integration_key: params[0],
          integration_type: 'WEB_CHAT',
          tenant_id: params[1],
          channel_id: params[2],
          assistant_id: params[3],
          enabled: typeof params[4] === 'boolean' ? params[4] : true,
        };
        state.integrations.push(newIntegration);
        return { rowCount: 1, rows: [{ ...newIntegration }] };
      }

      if (cleanSql.startsWith('UPDATE channel_integrations')) {
        const targetId = params.find((p) => state.integrations.some((i) => i.id === p));
        const integ = state.integrations.find((i) => i.id === targetId);
        if (integ) {
          integ.channel_id = params[0];
          integ.assistant_id = params[1];
          const boolParam = params.find((p) => typeof p === 'boolean');
          if (typeof boolParam === 'boolean') {
            integ.enabled = boolParam;
          }
        }
        return { rowCount: integ ? 1 : 0, rows: integ ? [{ ...integ }] : [] };
      }

      if (cleanSql.includes('FROM channel_integrations ci') && cleanSql.includes('JOIN tenant_channels tc')) {
        const matches = state.integrations.filter((i) => i.tenant_id === params[0] && i.integration_type === 'WEB_CHAT');
        matches.sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0));
        const integ = matches[0];
        if (!integ) return { rowCount: 0, rows: [] };
        const ch = state.channels.find((c) => c.id === integ.channel_id);
        const a = state.assistants.find((ast) => ast.id === integ.assistant_id);
        if (!ch) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            integration_id: integ.id,
            integration_key: integ.integration_key,
            integration_type: integ.integration_type,
            integration_enabled: integ.enabled,
            channel_id: ch.id,
            channel_type: ch.channel_type,
            channel_name: ch.display_name,
            channel_status: ch.status,
            assistant_id: a?.id || null,
            assistant_name: a?.name || null,
            assistant_model: a?.model || null,
            assistant_status: a?.status || null,
          }],
        };
      }

      throw new Error(`Unhandled query in mock: ${cleanSql}`);
    },
    release() {},
  };

  return {
    query: client.query,
    connect: async () => client,
    state,
  };
}

test('ensureWebChatIntegration validates database input', async () => {
  await assert.rejects(
    () => ensureWebChatIntegration({ database: null, tenantId: '11111111-1111-4111-8111-111111111111' }),
    (err) => err instanceof TenantWebChatProvisioningError && err.code === 'WEB_CHAT_PROVISIONING_DATABASE_INVALID'
  );
});

test('ensureWebChatIntegration validates tenant ID format', async () => {
  const db = createMockDatabase();
  await assert.rejects(
    () => ensureWebChatIntegration({ database: db, tenantId: 'invalid-uuid' }),
    (err) => err instanceof TenantWebChatProvisioningError && err.code === 'WEB_CHAT_PROVISIONING_TENANT_INVALID'
  );
});

test('ensureWebChatIntegration rejects non-existent tenant', async () => {
  const db = createMockDatabase({ tenants: [] });
  await assert.rejects(
    () => ensureWebChatIntegration({ database: db, tenantId: '11111111-1111-4111-8111-111111111111' }),
    (err) => err instanceof TenantWebChatProvisioningError && err.code === 'WEB_CHAT_PROVISIONING_TENANT_NOT_FOUND'
  );
});

test('ensureWebChatIntegration rejects inactive tenant', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Inactive Corp', status: 'suspended', plan_code: 'starter' }],
  });
  await assert.rejects(
    () => ensureWebChatIntegration({ database: db, tenantId }),
    (err) => err instanceof TenantWebChatProvisioningError && err.code === 'WEB_CHAT_PROVISIONING_TENANT_INACTIVE'
  );
});

test('ensureWebChatIntegration rejects inactive specified assistant', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const assistantId = '22222222-2222-4222-8222-222222222222';
  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Active Corp', status: 'active', plan_code: 'starter' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Archived Bot', model: 'gpt-4o', status: 'inactive' }],
  });
  await assert.rejects(
    () => ensureWebChatIntegration({ database: db, tenantId, assistantId }),
    (err) => err instanceof TenantWebChatProvisioningError && err.code === 'WEB_CHAT_PROVISIONING_ASSISTANT_INACTIVE'
  );
});

test('ensureWebChatIntegration fails closed on cross-tenant widget key conflict', async () => {
  const tenantA = '11111111-1111-4111-8111-111111111111';
  const tenantB = '22222222-2222-4222-8222-222222222222';
  const db = createMockDatabase({
    tenants: [
      { id: tenantA, name: 'Tenant A', status: 'active', plan_code: 'starter' },
      { id: tenantB, name: 'Tenant B', status: 'active', plan_code: 'pro' },
    ],
    assistants: [
      { id: '33333333-3333-4333-8333-333333333333', tenant_id: tenantA, name: 'A Assistant', model: 'gpt-4o-mini', status: 'active' },
      { id: '44444444-4444-4444-8444-444444444444', tenant_id: tenantB, name: 'B Assistant', model: 'gpt-4o-mini', status: 'active' },
    ],
    integrations: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        integration_key: 'wch_claimed_by_tenant_a',
        integration_type: 'WEB_CHAT',
        tenant_id: tenantA,
        channel_id: 'channel-a',
        assistant_id: '33333333-3333-4333-8333-333333333333',
        enabled: true,
      },
    ],
  });

  await assert.rejects(
    () => ensureWebChatIntegration({ database: db, tenantId: tenantB, widgetKey: 'wch_claimed_by_tenant_a' }),
    (err) => err instanceof TenantWebChatProvisioningError && err.code === 'WEB_CHAT_INTEGRATION_KEY_CONFLICT'
  );
});

test('ensureWebChatIntegration provisions new web chat channel and integration key idempotently', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Acme Corp', status: 'active', plan_code: 'enterprise' }],
    assistants: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenant_id: tenantId, name: 'Acme Bot', model: 'gpt-4o-mini', status: 'active' }],
  });

  const result = await ensureWebChatIntegration({
    database: db,
    tenantId,
    displayName: 'Storefront Chat',
  });

  assert.equal(result.tenant_id, tenantId);
  assert.match(result.widget_key, /^wch_live_[0-9a-f]{32}$/);
  assert.equal(result.channel.channel_type, 'WEB_CHAT');
  assert.equal(result.channel.display_name, 'Storefront Chat');
  assert.equal(result.channel.status, 'active');
  assert.equal(result.assistant.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(result.integration.enabled, true);
  assert.equal(result.bootstrap_config.api_endpoint, '/api/chat/bootstrap');

  const secondCall = await ensureWebChatIntegration({
    database: db,
    tenantId,
  });

  assert.equal(secondCall.widget_key, result.widget_key);
  assert.equal(secondCall.channel.id, result.channel.id);
  assert.equal(db.state.channels.length, 1);
  assert.equal(db.state.integrations.length, 1);

  const retrieved = await getWebChatIntegrationForTenant({ database: db, tenantId });
  assert.ok(retrieved);
  assert.equal(retrieved.widget_key, result.widget_key);
  assert.equal(retrieved.channel.display_name, 'Storefront Chat');
});



test('getWebChatIntegrationForTenant returns canonical unconfigured setup state for unconfigured tenant', async () => {
  const tenantId = '22222222-2222-4222-8222-222222222222';
  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Yeşil Vadi Peyzaj', status: 'active', plan_code: 'standard' }],
    assistants: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenant_id: tenantId, name: 'Yeşil Vadi Asistanı', model: 'gpt-4o-mini', status: 'active' }],
    channels: [],
    integrations: [],
  });

  const state = await getWebChatIntegrationForTenant({ database: db, tenantId });
  assert.ok(state, 'Unconfigured tenant must return canonical state rather than null/404');
  assert.equal(state.configured, false);
  assert.equal(state.widget_key, '');
  assert.equal(state.channel.status, 'inactive');
  assert.equal(state.channel.display_name, 'Yeşil Vadi Peyzaj Web Chat');
  assert.equal(state.assistant.name, 'Yeşil Vadi Asistanı');
  assert.ok(state.appearance);
  assert.ok(state.behavior);
  assert.equal(state.embed_snippet, '');
  assert.equal(state.installation.status, 'unconfigured');
});

test('getWebChatIntegrationForTenant returns null for non-existent tenant', async () => {
  const nonExistentTenantId = '99999999-9999-4999-8999-999999999999';
  const db = createMockDatabase({ tenants: [] });

  const state = await getWebChatIntegrationForTenant({ database: db, tenantId: nonExistentTenantId });
  assert.equal(state, null, 'Non-existent tenant must return null to trigger true 404 TENANT_NOT_FOUND');
});

test('getWebChatIntegrationForTenant returns configured state when Web Chat is inactive/disabled', async () => {
  const tenantId = '33333333-3333-4333-8333-333333333333';
  const channelId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const assistantId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Nordic Designs', status: 'active', plan_code: 'pro' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Nordic Bot', model: 'gpt-4o-mini', status: 'active' }],
    channels: [{ id: channelId, tenant_id: tenantId, channel_type: 'WEB_CHAT', display_name: 'Nordic Web Chat', status: 'inactive' }],
    integrations: [{
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      integration_key: 'wch_live_nordicdisabled1234567890123456',
      integration_type: 'WEB_CHAT',
      tenant_id: tenantId,
      channel_id: channelId,
      assistant_id: assistantId,
      enabled: false,
    }],
  });

  const state = await getWebChatIntegrationForTenant({ database: db, tenantId });
  assert.ok(state, 'Disabled Web Chat must be retrievable and editable without 404');
  assert.equal(state.configured, true);
  assert.equal(state.widget_key, 'wch_live_nordicdisabled1234567890123456');
  assert.equal(state.channel.status, 'inactive');
  assert.equal(state.integration.enabled, false);
});

test('ensureWebChatIntegration supports disabling and re-enabling idempotently without duplicating records', async () => {
  const tenantId = '44444444-4444-4444-8444-444444444444';
  const assistantId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const db = createMockDatabase({
    tenants: [{ id: tenantId, name: 'Solar Corp', status: 'active', plan_code: 'enterprise' }],
    assistants: [{ id: assistantId, tenant_id: tenantId, name: 'Solar Bot', model: 'gpt-4o-mini', status: 'active' }],
  });

  // 1. Initial activation
  const activeResult = await ensureWebChatIntegration({
    database: db,
    tenantId,
    status: 'active',
  });
  assert.equal(activeResult.configured, true);
  assert.equal(activeResult.channel.status, 'active');
  assert.equal(activeResult.integration.enabled, true);
  const widgetKey = activeResult.widget_key;

  // 2. Disable channel
  const disabledResult = await ensureWebChatIntegration({
    database: db,
    tenantId,
    status: 'inactive',
  });
  assert.equal(disabledResult.channel.status, 'inactive');
  assert.equal(disabledResult.integration.enabled, false);
  assert.equal(disabledResult.widget_key, widgetKey, 'Widget key must remain identical when disabled');
  assert.equal(db.state.channels.length, 1, 'No duplicate channels created');
  assert.equal(db.state.integrations.length, 1, 'No duplicate integrations created');

  // 3. Re-enable channel
  const reenabledResult = await ensureWebChatIntegration({
    database: db,
    tenantId,
    status: 'active',
  });
  assert.equal(reenabledResult.channel.status, 'active');
  assert.equal(reenabledResult.integration.enabled, true);
  assert.equal(reenabledResult.widget_key, widgetKey, 'Widget key must remain identical when re-enabled');
  assert.equal(db.state.channels.length, 1);
  assert.equal(db.state.integrations.length, 1);
});

test('Fresh tenant golden path: auto-provisions Web Chat Core assistant when tenant has no assistants', async () => {
  const freshTenantId = '55555555-0000-4000-8000-000000000000';
  const db = createMockDatabase({
    tenants: [{ id: freshTenantId, name: 'Brand New Startup', status: 'active', plan_code: 'starter' }],
    assistants: [],
  });

  // Step 1: Query unconfigured state
  const unconfiguredState = await getWebChatIntegrationForTenant({ database: db, tenantId: freshTenantId });
  assert.equal(unconfiguredState.configured, false);
  assert.equal(unconfiguredState.assistant, null);

  // Step 2: Enable Web Chat (with no assistant pre-created)
  const provisioned = await ensureWebChatIntegration({
    database: db,
    tenantId: freshTenantId,
    status: 'active',
  });
  assert.equal(provisioned.configured, true);
  assert.equal(provisioned.assistant.name, 'Web Chat Core');
  assert.ok(provisioned.widget_key);
  assert.equal(db.state.assistants.length, 1);
  assert.equal(db.state.channels.length, 1);
  assert.equal(db.state.integrations.length, 1);
});

test('normalizeWebChatAppearance supports empty launcher_label and Unicode text (TR/EN/AR)', () => {
  // Default when undefined
  const defaultAppearance = normalizeWebChatAppearance({});
  assert.equal(defaultAppearance.launcher_label, 'Canlı Destek');

  // Empty string allows circular minimal launcher
  const emptyAppearance = normalizeWebChatAppearance({ launcher_label: '' });
  assert.equal(emptyAppearance.launcher_label, '');

  const whitespaceAppearance = normalizeWebChatAppearance({ launcher_label: '   ' });
  assert.equal(whitespaceAppearance.launcher_label, '');

  // Turkish
  const trAppearance = normalizeWebChatAppearance({ launcher_label: 'Müşteri Desteği 🇹🇷' });
  assert.equal(trAppearance.launcher_label, 'Müşteri Desteği 🇹🇷');

  // English
  const enAppearance = normalizeWebChatAppearance({ launcher_label: 'Chat with us' });
  assert.equal(enAppearance.launcher_label, 'Chat with us');

  // Arabic
  const arAppearance = normalizeWebChatAppearance({ launcher_label: 'محادثة مباشرة' });
  assert.equal(arAppearance.launcher_label, 'محادثة مباشرة');

  // Bounded safe length (max 50 chars)
  const longAppearance = normalizeWebChatAppearance({ launcher_label: 'A'.repeat(80) });
  assert.equal(longAppearance.launcher_label.length, 50);
});
