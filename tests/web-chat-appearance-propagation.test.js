import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebChatAppearance, ensureWebChatIntegration } from '../services/tenant-web-chat-provisioning-service.js';
import { deriveWebChatThemeTokens } from '../services/web-chat-theme-service.js';

test('CONFIG VERSIONING: normalizeWebChatAppearance produces canonical config_version and updated_at', () => {
  const t0 = Date.now();
  const app1 = normalizeWebChatAppearance({ brand_name: 'Acme Test' });
  assert.ok(typeof app1.config_version === 'number', 'config_version should be a number');
  assert.ok(app1.config_version >= t0, 'config_version should be recent timestamp');
  assert.ok(typeof app1.updated_at === 'string', 'updated_at should be a string');
  assert.equal(app1.theme.config_version, app1.config_version, 'theme.config_version should match');
  assert.equal(app1.theme.updated_at, app1.updated_at, 'theme.updated_at should match');

  const app2 = normalizeWebChatAppearance({
    brand_name: 'Acme Test',
    config_version: 123456789,
    updated_at: '2026-09-15T00:00:00.000Z',
  });
  assert.equal(app2.config_version, 123456789, 'Explicit config_version should be preserved');
  assert.equal(app2.updated_at, '2026-09-15T00:00:00.000Z', 'Explicit updated_at should be preserved');
});

test('ALIAS NON-REGRESSION: explicit field overrides historical alias in theme', () => {
  // If user sets follow_theme (launcher_background is null), historical theme.launcher_background should NOT override it
  const app = normalizeWebChatAppearance({
    launcher_theme_mode: 'follow_theme',
    launcher_background: null,
    theme: {
      launcher_background: '#EF4444', // Historical alias from custom mode
    },
  });
  // In follow_theme mode, dark mode default launcher_background is #0F172A, NOT the historical #EF4444!
  assert.equal(app.launcher_background, '#0F172A', 'Should resolve follow_theme panel default, not historical theme alias');
  assert.equal(app.theme.launcher_background, '#0F172A', 'theme.launcher_background should match');
});

test('TRANSPARENCY PERSISTENCE: transparent tokens are preserved across canonical normalization', () => {
  const app = normalizeWebChatAppearance({
    launcher_theme_mode: 'custom',
    launcher_background: 'transparent',
    launcher_logo_background: 'transparent',
    launcher_foreground: '#FFFFFF',
    launcher_border_color: 'transparent',
  });

  assert.equal(app.launcher_background, 'transparent');
  assert.equal(app.launcher_bg, 'transparent');
  assert.equal(app.launcher_logo_background, 'transparent');
  assert.equal(app.launcher_logo_bg, 'transparent');
  assert.equal(app.theme.launcher_background, 'transparent');
  assert.equal(app.theme.launcher_logo_background, 'transparent');
});

test('PROVISIONING VERSIONING & SYNC: ensureWebChatIntegration stamps version and syncs across all web chat rows', async () => {
  const tenantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const queries = [];
  const mockClient = {
    connect: async () => mockClient,
    release: () => {},
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id, name, status, plan_code FROM tenants')) {
        return { rowCount: 1, rows: [{ id: tenantId, name: 'Tenant Alpha', status: 'active', plan_code: 'BUSINESS' }] };
      }
      if (sql.includes('SELECT id, name, model, status FROM ai_assistants')) {
        return { rowCount: 1, rows: [{ id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', name: 'Web Assistant', model: 'gpt-4o', status: 'active' }] };
      }
      if (sql.includes('SELECT id, tenant_id, channel_type, display_name')) {
        return { rowCount: 1, rows: [{ id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', tenant_id: tenantId, channel_type: 'WEB_CHAT', display_name: 'Alpha Chat', external_channel_id: 'ext-1', assistant_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', status: 'active' }] };
      }
      if (sql.includes('information_schema.columns')) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('SELECT id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled FROM channel_integrations WHERE integration_key = $1')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'ci-1',
            integration_key: params[0],
            integration_type: 'WEB_CHAT',
            tenant_id: tenantId,
            channel_id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
            assistant_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
            enabled: true,
          }],
        };
      }
      if (sql.includes('UPDATE channel_integrations') && sql.includes('channel_id')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'ci-1',
            integration_key: 'wch_test_key',
            integration_type: 'WEB_CHAT',
            tenant_id: tenantId,
            channel_id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
            assistant_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
            enabled: true,
          }],
        };
      }
      if (sql.includes('UPDATE channel_integrations SET config = $1')) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const result = await ensureWebChatIntegration(mockClient, {
    tenantId,
    widgetKey: 'wch_test_key',
    appearance: {
      launcher_theme_mode: 'custom',
      launcher_background: 'transparent',
    },
  });

  assert.ok(result.config_version, 'Should return config_version in provision result');
  assert.equal(result.appearance.launcher_background, 'transparent');
  assert.equal(result.bootstrap_config.config_version, result.config_version);

  // Verify secondary integrations update query was executed to ensure tenant-wide parity
  const syncQuery = queries.find(q => q.sql.includes('UPDATE channel_integrations') && q.sql.includes('id !='));
  assert.ok(syncQuery, 'Secondary integrations sync query must execute');
  assert.ok(syncQuery.params[0].includes('config_version'), 'Payload must include config_version');
});

test('LOGO SIZING PERSISTENCE & BOUNDS: launcher_logo_scale and panel_logo_scale clamped between 50 and 200', () => {
  // Test valid custom scale
  const appValid = normalizeWebChatAppearance({
    launcher_logo_scale: 145,
    panel_logo_scale: 125,
  });
  assert.equal(appValid.launcher_logo_scale, 145, 'launcher_logo_scale should be preserved');
  assert.equal(appValid.panel_logo_scale, 125, 'panel_logo_scale should be preserved');
  assert.equal(appValid.theme.launcher_logo_scale, 145, 'theme.launcher_logo_scale should match');
  assert.equal(appValid.theme.panel_logo_scale, 125, 'theme.panel_logo_scale should match');

  // Test lower bound clamping (< 50 clamps to 50)
  const appLow = normalizeWebChatAppearance({
    launcher_logo_scale: 20,
    panel_logo_scale: -10,
  });
  assert.equal(appLow.launcher_logo_scale, 50, 'Values below 50 must clamp to 50');
  assert.equal(appLow.panel_logo_scale, 50, 'Values below 50 must clamp to 50');

  // Test upper bound clamping (> 200 clamps to 200)
  const appHigh = normalizeWebChatAppearance({
    launcher_logo_scale: 350,
    panel_logo_scale: 999,
  });
  assert.equal(appHigh.launcher_logo_scale, 200, 'Values above 200 must clamp to 200');
  assert.equal(appHigh.panel_logo_scale, 200, 'Values above 200 must clamp to 200');
});

test('HISTORICAL TENANT SAFE: missing scale fields default to 100', () => {
  // Historical tenant with null/undefined scale values
  const appHistorical = normalizeWebChatAppearance({
    brand_name: 'Historical Tenant',
    title: 'Support',
  });
  assert.equal(appHistorical.launcher_logo_scale, 100, 'Historical tenant missing launcher_logo_scale must default to 100');
  assert.equal(appHistorical.panel_logo_scale, 100, 'Historical tenant missing panel_logo_scale must default to 100');
  assert.equal(appHistorical.theme.launcher_logo_scale, 100, 'theme.launcher_logo_scale must default to 100');
  assert.equal(appHistorical.theme.panel_logo_scale, 100, 'theme.panel_logo_scale must default to 100');
});

test('CANONICAL TOKEN PARITY: deriveWebChatThemeTokens outputs canonical scales and surface tokens', () => {
  const tokensDark = deriveWebChatThemeTokens({
    primaryColor: '#0B5FFF',
    mode: 'dark',
    launcherLogoScale: 135,
    panelLogoScale: 150,
  });
  assert.equal(tokensDark.launcher_logo_scale, 135);
  assert.equal(tokensDark.panel_logo_scale, 150);
  assert.ok(tokensDark.surface_glass.startsWith('rgba('), 'surface_glass must be RGBA');
  assert.equal(tokensDark.surface_solid, '#111827');

  const tokensLight = deriveWebChatThemeTokens({
    primaryColor: '#0B5FFF',
    mode: 'light',
    launcherLogoScale: 85,
    panelLogoScale: 90,
  });
  assert.equal(tokensLight.launcher_logo_scale, 85);
  assert.equal(tokensLight.panel_logo_scale, 90);
  assert.ok(tokensLight.surface_glass.startsWith('rgba('), 'surface_glass must be RGBA');
  assert.equal(tokensLight.surface_solid, '#FFFFFF');
});

