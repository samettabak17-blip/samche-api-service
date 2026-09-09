import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureWebChatIntegration,
  getWebChatIntegrationForTenant,
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

      if (cleanSql.startsWith('SELECT id, tenant_id, channel_type, display_name, external_channel_id, assistant_id, status FROM tenant_channels WHERE tenant_id = $1 AND channel_type = \'WEB_CHAT\'')) {
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
        const ch = state.channels.find((c) => c.id === params[1] && c.tenant_id === params[2]);
        if (ch) {
          ch.assistant_id = params[0];
          ch.status = 'active';
        }
        return { rowCount: ch ? 1 : 0, rows: ch ? [{ ...ch }] : [] };
      }

      if (cleanSql.startsWith('SELECT id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled FROM channel_integrations WHERE integration_key = $1')) {
        const row = state.integrations.find((i) => i.integration_key === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [{ ...row }] : [] };
      }

      if (cleanSql.includes('FROM channel_integrations') && cleanSql.includes('WHERE tenant_id = $1 AND integration_type = \'WEB_CHAT\'')) {
        const row = state.integrations.find((i) => i.tenant_id === params[0] && i.integration_type === 'WEB_CHAT' && i.enabled);
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
          enabled: true,
        };
        state.integrations.push(newIntegration);
        return { rowCount: 1, rows: [{ ...newIntegration }] };
      }

      if (cleanSql.startsWith('UPDATE channel_integrations')) {
        const integ = state.integrations.find((i) => i.id === params[2] && i.tenant_id === params[3]);
        if (integ) {
          integ.channel_id = params[0];
          integ.assistant_id = params[1];
          integ.enabled = true;
        }
        return { rowCount: integ ? 1 : 0, rows: integ ? [{ ...integ }] : [] };
      }

      if (cleanSql.includes('FROM channel_integrations ci') && cleanSql.includes('JOIN tenant_channels tc') && cleanSql.includes('JOIN ai_assistants a')) {
        const integ = state.integrations.find((i) => i.tenant_id === params[0] && i.integration_type === 'WEB_CHAT' && i.enabled);
        if (!integ) return { rowCount: 0, rows: [] };
        const ch = state.channels.find((c) => c.id === integ.channel_id);
        const a = state.assistants.find((ast) => ast.id === integ.assistant_id);
        if (!ch || !a) return { rowCount: 0, rows: [] };
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
            assistant_id: a.id,
            assistant_name: a.name,
            assistant_model: a.model,
            assistant_status: a.status,
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

