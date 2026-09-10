import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-web-chat-access-model-jwt-secret';

const { default: dashboardRoutes } = await import('../routes/dashboardRoutes.js');
const {
  canPerformWebChatAction,
  canWriteWebChat,
  canReadWebChat,
  WEBCHAT_PERMISSIONS,
  WEBCHAT_PERMISSION_REGISTRY,
} = await import('../services/web-chat-permissions.js');

const TENANT_A_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_B_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_A_ADMIN_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_A_AGENT_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-cccccccccccc';
const SUPER_OWNER_USER_ID = '99999999-9999-4999-8999-999999999999';
const TENANT_A_ASSISTANT_ID = 'aaaaaaaa-1111-4aaa-8aaa-111111111111';
const TENANT_B_ASSISTANT_ID = 'bbbbbbbb-2222-4bbb-8bbb-222222222222';

function createMockDatabase() {
  const state = {
    tenants: [
      { id: TENANT_A_ID, name: 'Alpha', status: 'active', plan_code: 'BUSINESS' },
      { id: TENANT_B_ID, name: 'Beta', status: 'active', plan_code: 'ENTERPRISE' },
    ],
    tenantUsers: [
      { tenant_id: TENANT_A_ID, user_id: TENANT_A_ADMIN_USER_ID, tenant_role: 'ADMIN' },
      { tenant_id: TENANT_A_ID, user_id: TENANT_A_AGENT_USER_ID, tenant_role: 'AGENT' },
    ],
    assistants: [
      { id: TENANT_A_ASSISTANT_ID, tenant_id: TENANT_A_ID, name: 'A-Ast', model: 'gpt-4o-mini', status: 'active' },
      { id: TENANT_B_ASSISTANT_ID, tenant_id: TENANT_B_ID, name: 'B-Ast', model: 'gpt-4o-mini', status: 'active' },
    ],
    channels: [
      { id: 'c111', tenant_id: TENANT_A_ID, channel_type: 'WEB_CHAT', display_name: 'Alpha Chat', external_channel_id: 'a_ext', assistant_id: TENANT_A_ASSISTANT_ID, status: 'active' },
      { id: 'c222', tenant_id: TENANT_B_ID, channel_type: 'WEB_CHAT', display_name: 'Beta Chat', external_channel_id: 'b_ext', assistant_id: TENANT_B_ASSISTANT_ID, status: 'active' },
    ],
    integrations: [
      { id: 'i111', integration_key: 'key_alpha_111', integration_type: 'WEB_CHAT', tenant_id: TENANT_A_ID, channel_id: 'c111', assistant_id: TENANT_A_ASSISTANT_ID, enabled: true },
      { id: 'i222', integration_key: 'key_beta_222', integration_type: 'WEB_CHAT', tenant_id: TENANT_B_ID, channel_id: 'c222', assistant_id: TENANT_B_ASSISTANT_ID, enabled: true },
    ],
  };

  const handler = ({ sql, params }) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rowCount: 0, rows: [] };
    if (s.startsWith('SELECT id FROM tenants WHERE id = $1')) {
      const r = state.tenants.find((t) => t.id === params[0]);
      return { rowCount: r ? 1 : 0, rows: r ? [{ id: r.id }] : [] };
    }
    if (s.startsWith('SELECT tenant_role FROM tenant_users WHERE user_id = $1 AND tenant_id = $2')) {
      const r = state.tenantUsers.find((tu) => tu.user_id === params[0] && tu.tenant_id === params[1]);
      return { rowCount: r ? 1 : 0, rows: r ? [{ tenant_role: r.tenant_role }] : [] };
    }
    if (s.startsWith('SELECT id, name, status, plan_code FROM tenants WHERE id = $1')) {
      const r = state.tenants.find((t) => t.id === params[0]);
      return { rowCount: r ? 1 : 0, rows: r ? [{ ...r }] : [] };
    }
    if (s.startsWith('SELECT id, name, model, status FROM ai_assistants WHERE id = $1 AND tenant_id = $2')) {
      const r = state.assistants.find((a) => a.id === params[0] && a.tenant_id === params[1]);
      return { rowCount: r ? 1 : 0, rows: r ? [{ ...r }] : [] };
    }
    if (s.startsWith('SELECT id, name, model, status FROM ai_assistants WHERE tenant_id = $1 AND status = \'active\'')) {
      const r = state.assistants.find((a) => a.tenant_id === params[0] && a.status === 'active');
      return { rowCount: r ? 1 : 0, rows: r ? [{ ...r }] : [] };
    }
    if (s.includes('FROM channel_integrations') && s.includes('integration_type = \'WEB_CHAT\'')) {
      const ci = state.integrations.find((i) => i.tenant_id === params[0] && i.integration_type === 'WEB_CHAT');
      if (!ci) return { rowCount: 0, rows: [] };
      const tc = state.channels.find((c) => c.id === ci.channel_id) || {};
      const a = state.assistants.find((ast) => ast.id === ci.assistant_id) || {};
      return {
        rowCount: 1,
        rows: [{
          ...ci,
          integration_id: ci.id,
          integration_enabled: ci.enabled,
          channel_id: tc.id,
          channel_type: tc.channel_type,
          channel_name: tc.display_name,
          channel_status: tc.status,
          assistant_id: a.id,
          assistant_name: a.name,
          assistant_model: a.model,
          assistant_status: a.status,
        }],
      };
    }
    if (s.startsWith('SELECT id, tenant_id, channel_type, display_name, external_channel_id, assistant_id, status FROM tenant_channels WHERE id = $1 AND tenant_id = $2')) {
      const r = state.channels.find((c) => c.id === params[0] && c.tenant_id === params[1]);
      return { rowCount: r ? 1 : 0, rows: r ? [{ ...r }] : [] };
    }
    if (s.startsWith('SELECT id, tenant_id, channel_type, display_name, external_channel_id, assistant_id, status FROM tenant_channels WHERE tenant_id = $1 AND channel_type = \'WEB_CHAT\'')) {
      const r = state.channels.find((c) => c.tenant_id === params[0] && c.channel_type === 'WEB_CHAT');
      return { rowCount: r ? 1 : 0, rows: r ? [{ ...r }] : [] };
    }
    if (s.startsWith('UPDATE tenant_channels SET')) {
      const ch = state.channels.find((c) => c.id === params[3] && c.tenant_id === params[4]);
      if (ch) { ch.assistant_id = params[0]; ch.display_name = params[1]; ch.status = params[2]; }
      return { rowCount: ch ? 1 : 0, rows: ch ? [{ ...ch }] : [] };
    }
    if (s.startsWith('UPDATE channel_integrations SET')) {
      const integ = state.integrations.find((i) => i.id === params[2] && i.tenant_id === params[3]);
      if (integ) { integ.assistant_id = params[0]; integ.enabled = params[1]; }
      return { rowCount: integ ? 1 : 0, rows: integ ? [{ ...integ }] : [] };
    }
    return { rowCount: 0, rows: [] };
  };

  const client = { query: async (sql, params = []) => handler({ sql, params }), release: () => {} };
  return { connect: async () => client, query: async (sql, params = []) => handler({ sql, params }), state };
}

async function withTestServer(callback) {
  const db = createMockDatabase();
  const app = express();
  app.use(express.json());
  app.locals.database = db;
  app.locals.query = db.query.bind(db);
  app.use('/api/v1/tenants', dashboardRoutes);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1/tenants`;
    await callback({ baseUrl, db });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeToken({ userId, systemRole, tenantRole }) {
  return jwt.sign(
    { user_id: userId, system_role: systemRole, tenant_role: tenantRole },
    process.env.JWT_SECRET
  );
}

// ---------------------------------------------------------------------------
// TEST 1: TENANT ADMIN MANAGES OWN TENANT WEB CHAT
// ---------------------------------------------------------------------------
test('TENANT_ADMIN_OWN_TENANT_WEBCHAT: Tenant Admin can read and update Web Chat for their own tenant', async () => {
  await withTestServer(async ({ baseUrl }) => {
    const token = makeToken({
      userId: TENANT_A_ADMIN_USER_ID,
      systemRole: 'CUSTOMER',
      tenantRole: 'ADMIN',
    });

    const getRes = await fetch(`${baseUrl}/${TENANT_A_ID}/channels/web-chat`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.tenant_id, TENANT_A_ID);
    assert.equal(getData.channel.display_name, 'Alpha Chat');
    assert.ok(getData.widget_key);
    assert.ok(getData.embed_snippet.includes(getData.widget_key));

    const updateRes = await fetch(`${baseUrl}/${TENANT_A_ID}/channels/web-chat`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: 'Alpha Customer Support',
        status: 'active',
        appearance: { brand_name: 'Alpha Brand', primary_color: '#0B5FFF' },
        behavior: { proactive_enabled: true, dwell_threshold_seconds: 20 },
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.channel.display_name, 'Alpha Chat');
    assert.equal(updateData.appearance.brand_name, 'Alpha Brand');
    assert.equal(updateData.tenant_id, TENANT_A_ID);

    const previewRes = await fetch(`${baseUrl}/${TENANT_A_ID}/channels/web-chat/theme-preview`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primary_color: '#0B5FFF', mode: 'dark' }),
    });
    assert.equal(previewRes.status, 200);
    const previewData = await previewRes.json();
    assert.equal(previewData.is_accessible, true);
  });
});

// ---------------------------------------------------------------------------
// TEST 2: TENANT ADMIN CROSS-TENANT ACCESS DENIED
// ---------------------------------------------------------------------------
test('TENANT_ADMIN_CROSS_TENANT_DENIED: Tenant Admin cannot access or configure another tenant Web Chat', async () => {
  await withTestServer(async ({ baseUrl }) => {
    const token = makeToken({
      userId: TENANT_A_ADMIN_USER_ID,
      systemRole: 'CUSTOMER',
      tenantRole: 'ADMIN',
    });

    const getRes = await fetch(`${baseUrl}/${TENANT_B_ID}/channels/web-chat`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(getRes.status, 403);
    assert.deepEqual(await getRes.json(), { error: 'Tenant access denied' });

    const putRes = await fetch(`${baseUrl}/${TENANT_B_ID}/channels/web-chat`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ display_name: 'Cross-Tenant Update' }),
    });
    assert.equal(putRes.status, 403);
    assert.deepEqual(await putRes.json(), { error: 'Tenant access denied' });

    const previewRes = await fetch(`${baseUrl}/${TENANT_B_ID}/channels/web-chat/theme-preview`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primary_color: '#0B5FFF' }),
    });
    assert.equal(previewRes.status, 403);
    assert.deepEqual(await previewRes.json(), { error: 'Tenant access denied' });
  });
});


// ---------------------------------------------------------------------------
// TEST 3: SAMCHE PLATFORM SUPER OWNER CAN MANAGE ANY TENANT'S WEB CHAT
// ---------------------------------------------------------------------------
test('SUPER_OWNER_ANY_TENANT_WEBCHAT: Super Owner can access and configure Web Chat for any tenant with data ownership isolation', async () => {
  await withTestServer(async ({ baseUrl }) => {
    const ownerToken = makeToken({
      userId: SUPER_OWNER_USER_ID,
      systemRole: 'OWNER',
    });

    // 1. Super Owner manages Tenant A Web Chat
    const tenantAGet = await fetch(`${baseUrl}/${TENANT_A_ID}/channels/web-chat`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(tenantAGet.status, 200);
    const tenantAData = await tenantAGet.json();
    assert.equal(tenantAData.tenant_id, TENANT_A_ID);

    const tenantAUpdate = await fetch(`${baseUrl}/${TENANT_A_ID}/channels/web-chat`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: 'Super Owner Managed Alpha Chat',
        assistant_id: TENANT_A_ASSISTANT_ID,
        status: 'active',
        appearance: { brand_name: 'Alpha By Owner' },
      }),
    });
    assert.equal(tenantAUpdate.status, 200);
    const aUpdated = await tenantAUpdate.json();
    assert.equal(aUpdated.channel.display_name, 'Alpha Chat');
    assert.equal(aUpdated.appearance.brand_name, 'Alpha By Owner');
    assert.equal(aUpdated.channel.assistant_id, TENANT_A_ASSISTANT_ID);
    assert.equal(aUpdated.tenant_id, TENANT_A_ID);

    // 2. Super Owner switches context and manages Tenant B Web Chat
    const tenantBGet = await fetch(`${baseUrl}/${TENANT_B_ID}/channels/web-chat`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(tenantBGet.status, 200);
    const tenantBData = await tenantBGet.json();
    assert.equal(tenantBData.tenant_id, TENANT_B_ID);

    const tenantBUpdate = await fetch(`${baseUrl}/${TENANT_B_ID}/channels/web-chat`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        display_name: 'Super Owner Managed Beta Chat',
        assistant_id: TENANT_B_ASSISTANT_ID,
        status: 'active',
      }),
    });
    assert.equal(tenantBUpdate.status, 200);
    const bUpdated = await tenantBUpdate.json();
    assert.equal(bUpdated.channel.display_name, 'Beta Chat');
    assert.equal(bUpdated.channel.assistant_id, TENANT_B_ASSISTANT_ID);
    assert.equal(bUpdated.tenant_id, TENANT_B_ID);

    // 3. Security invariant: ACCESS != DATA OWNERSHIP
    // Super Owner cannot link Tenant A's assistant into Tenant B's Web Chat
    const crossAssistantRes = await fetch(`${baseUrl}/${TENANT_B_ID}/channels/web-chat`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistant_id: TENANT_A_ASSISTANT_ID,
      }),
    });
    assert.equal(crossAssistantRes.status, 404);
    const crossAssistantErr = await crossAssistantRes.json();
    assert.equal(crossAssistantErr.error, 'WEB_CHAT_PROVISIONING_ASSISTANT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// TEST 4: SUPER OWNER EMBED SNIPPET & PUBLIC WIDGET KEY INSPECTION
// ---------------------------------------------------------------------------
test('SUPER_OWNER_EMBED_ACCESS: Super Owner can inspect widget key and generated embed code with zero secrets', async () => {
  await withTestServer(async ({ baseUrl }) => {
    const ownerToken = makeToken({
      userId: SUPER_OWNER_USER_ID,
      systemRole: 'OWNER',
    });

    const resA = await fetch(`${baseUrl}/${TENANT_A_ID}/channels/web-chat`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const dataA = await resA.json();
    assert.equal(dataA.widget_key, 'key_alpha_111');
    assert.ok(dataA.embed_snippet.includes('data-widget-key="key_alpha_111"'));
    assert.doesNotMatch(dataA.embed_snippet, /password|secret|bearer|authorization/i);

    const resB = await fetch(`${baseUrl}/${TENANT_B_ID}/channels/web-chat`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const dataB = await resB.json();
    assert.equal(dataB.widget_key, 'key_beta_222');
    assert.ok(dataB.embed_snippet.includes('data-widget-key="key_beta_222"'));
    assert.notEqual(dataA.widget_key, dataB.widget_key);
  });
});


// ---------------------------------------------------------------------------
// TEST 5: SHARED WEB CHAT MANAGEMENT UI INTEGRITY
// ---------------------------------------------------------------------------
test('SHARED_WEBCHAT_MANAGEMENT_UI: Single unified UI component serves Tenant Admin and Super Owner', () => {
  const uiSource = fs.readFileSync(
    new URL('../dashboard/src/features/channels/web-chat-management.tsx', import.meta.url),
    'utf8'
  );

  assert.match(uiSource, /export function WebChatManagement\(\)/);
  assert.match(uiSource, /const\s*\{\s*canManage\s*\}\s*=\s*useTenant\(\)/);
  assert.match(uiSource, /const\s*\{\s*isOwner,\s*selectedTenant,\s*tenantRole\s*\}\s*=\s*useTenant\(\)/);
  assert.match(uiSource, /data-testid="platform-super-owner-banner"/);
  assert.match(uiSource, /data-testid="read-only-banner"/);
  assert.match(uiSource, /selectTenantAssistants\(assistantsQuery\.data/);
  assert.match(uiSource, /handleCopySnippet/);
});

// ---------------------------------------------------------------------------
// TEST 6: SHARED WEB CHAT MANAGEMENT API CONTRACT
// ---------------------------------------------------------------------------
test('SHARED_WEBCHAT_MANAGEMENT_API: Unified canonical routes used by all authorized roles', () => {
  const routesSource = fs.readFileSync(
    new URL('../routes/dashboardRoutes.js', import.meta.url),
    'utf8'
  );

  assert.match(routesSource, /router\.get\('\/:tenantId\/channels\/web-chat',/);
  assert.match(routesSource, /router\.put\('\/:tenantId\/channels\/web-chat',/);
  assert.match(routesSource, /router\.post\('\/:tenantId\/channels\/web-chat',/);
  assert.match(routesSource, /router\.post\('\/:tenantId\/channels\/web-chat\/theme-preview',/);
  assert.doesNotMatch(routesSource, /router\.(get|post|put)\('\/platform\/web-chat/);
  assert.doesNotMatch(routesSource, /router\.(get|post|put)\('\/super-owner\/web-chat/);
  assert.doesNotMatch(routesSource, /router\.(get|post|put)\('\/admin\/web-chat/);
});

// ---------------------------------------------------------------------------
// TEST 7: NO DUPLICATE ADMIN IMPLEMENTATIONS
// ---------------------------------------------------------------------------
test('DUPLICATE_ADMIN_IMPLEMENTATION: Zero duplicated tables, controllers, or embed generators', () => {
  const files = fs.readdirSync(new URL('../services', import.meta.url));
  const webChatServices = files.filter((f) => f.includes('web-chat') || f.includes('webchat'));
  assert.deepEqual(webChatServices.sort(), [
    'public-web-chat-integration-service.js',
    'public-web-chat-session.js',
    'tenant-web-chat-provisioning-service.js',
    'web-chat-permissions.js',
    'web-chat-theme-service.js',
  ]);

  const provisioningServiceSource = fs.readFileSync(
    new URL('../services/tenant-web-chat-provisioning-service.js', import.meta.url),
    'utf8'
  );
  assert.match(provisioningServiceSource, /tenant_channels/);
  assert.match(provisioningServiceSource, /channel_integrations/);
  assert.doesNotMatch(provisioningServiceSource, /super_owner_channels|platform_web_chat/);
});


// ---------------------------------------------------------------------------
// TEST 8: TASK 9 PERMISSION REGISTRY READINESS
// ---------------------------------------------------------------------------
test('TASK9_PERMISSION_REGISTRY_READY: Discrete Web Chat actions and registry metadata structured for Task 9', () => {
  assert.equal(WEBCHAT_PERMISSIONS.VIEW, 'channels.webchat.view');
  assert.equal(WEBCHAT_PERMISSIONS.CONFIGURE, 'channels.webchat.configure');
  assert.equal(WEBCHAT_PERMISSIONS.MANAGE_APPEARANCE, 'channels.webchat.manage_appearance');
  assert.equal(WEBCHAT_PERMISSIONS.MANAGE_BEHAVIOR, 'channels.webchat.manage_behavior');
  assert.equal(WEBCHAT_PERMISSIONS.MANAGE_INTEGRATION, 'channels.webchat.manage_integration');
  assert.equal(WEBCHAT_PERMISSIONS.VIEW_INSTALLATION, 'channels.webchat.view_installation');

  assert.equal(WEBCHAT_PERMISSION_REGISTRY.length, 6);
  for (const item of WEBCHAT_PERMISSION_REGISTRY) {
    assert.equal(item.module, 'channels');
    assert.equal(item.introduced_by_task, 'TASK_8');
    assert.ok(item.description);
    assert.ok(item.allowed_system_roles.includes('OWNER'));
    assert.ok(item.allowed_tenant_roles.includes('ADMIN'));
  }

  // 1. OWNER has full authority
  assert.equal(canPerformWebChatAction({ systemRole: 'OWNER', action: 'channels.webchat.configure' }), true);
  assert.equal(canPerformWebChatAction({ systemRole: 'OWNER', action: 'configure' }), true);
  assert.equal(canPerformWebChatAction({ systemRole: 'OWNER', action: 'view' }), true);

  // 2. Tenant ADMIN has full authority
  assert.equal(canPerformWebChatAction({ systemRole: 'CUSTOMER', tenantRole: 'ADMIN', action: 'channels.webchat.configure' }), true);
  assert.equal(canPerformWebChatAction({ systemRole: 'CUSTOMER', tenantRole: 'ADMIN', action: 'manage_appearance' }), true);

  // 3. Tenant AGENT is strictly read-only
  assert.equal(canPerformWebChatAction({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'view' }), true);
  assert.equal(canPerformWebChatAction({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'view_installation' }), true);
  assert.equal(canPerformWebChatAction({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'configure' }), false);
  assert.equal(canPerformWebChatAction({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'manage_appearance' }), false);
  assert.equal(canPerformWebChatAction({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'manage_behavior' }), false);
  assert.equal(canPerformWebChatAction({ systemRole: 'CUSTOMER', tenantRole: 'AGENT', action: 'manage_integration' }), false);

  // 4. Unknown role denied
  assert.equal(canPerformWebChatAction({ systemRole: 'UNKNOWN', action: 'view' }), false);

  // Helper write/read checks
  assert.equal(canWriteWebChat({ systemRole: 'OWNER' }), true);
  assert.equal(canWriteWebChat({ systemRole: 'CUSTOMER', tenantRole: 'ADMIN' }), true);
  assert.equal(canWriteWebChat({ systemRole: 'CUSTOMER', tenantRole: 'AGENT' }), false);

  assert.equal(canReadWebChat({ systemRole: 'OWNER' }), true);
  assert.equal(canReadWebChat({ systemRole: 'CUSTOMER', tenantRole: 'ADMIN' }), true);
  assert.equal(canReadWebChat({ systemRole: 'CUSTOMER', tenantRole: 'AGENT' }), true);
});

