import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_CODES,
  BILLING_CYCLES,
  CANONICAL_CAPABILITY_CATALOG,
  isHigherPlan,
  isPlanAtLeast,
  resolveEffectiveTenantEntitlements,
  assertTenantEntitlement,
  assertTenantMetricLimit,
  TenantEntitlementError,
} from '../services/tenant-entitlement-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

test('plan catalog constants and pricing structure match canonical spec', () => {
  assert.deepEqual(PLAN_CODES, ['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE']);
  assert.deepEqual(BILLING_CYCLES, ['MONTHLY', 'ANNUAL']);
  assert.equal(isHigherPlan('STARTER', 'GROWTH'), true);
  assert.equal(isHigherPlan('GROWTH', 'BUSINESS'), true);
  assert.equal(isHigherPlan('BUSINESS', 'ENTERPRISE'), true);
  assert.equal(isHigherPlan('ENTERPRISE', 'STARTER'), false);

  assert.equal(isPlanAtLeast('GROWTH', 'STARTER'), true);
  assert.equal(isPlanAtLeast('STARTER', 'GROWTH'), false);
  assert.equal(isPlanAtLeast('BUSINESS', 'GROWTH'), true);
});

test('canonical capability catalog includes multi-channel, knowledge, CRM, visual AI, and commerce placeholders', () => {
  assert.ok(CANONICAL_CAPABILITY_CATALOG.webchat);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.whatsapp);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.guide);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.basic_knowledge_intelligence);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.advanced_knowledge_intelligence);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.entity_awareness);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.visual_ai);

  // Future commerce placeholders
  assert.ok(CANONICAL_CAPABILITY_CATALOG.payment_links);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.payments);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.orders);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.invoicing);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.automatic_invoice_delivery);
  assert.ok(CANONICAL_CAPABILITY_CATALOG.accounting_connectors);
});

test('effective entitlement resolution resolves STARTER plan correctly with locked features', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM tenant_subscriptions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'sub-1', tenant_id: tenantId, plan_code: 'STARTER', billing_cycle: 'MONTHLY', currency: 'AED',
            monthly_price_aed: 1790, annual_price_aed: 18258, setup_fee_aed: 2500, status: 'ACTIVE',
            display_name: 'Starter Plan', customer_subtitle: 'Core AI Workspace', rank: 1,
            included_capabilities: ['webchat', 'basic_knowledge_intelligence', 'page_awareness', 'basic_lead_capture', 'human_handoff', 'standard_support', 'site_intelligence'],
            included_limits: { monthly_interactions: 5000, max_languages: 2, max_web_chatbots: 1, max_team_users: 1, max_integrations: 0 },
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId });
  assert.equal(effective.plan.code, 'STARTER');
  assert.equal(effective.plan.monthly_price_aed, 1790);
  assert.equal(effective.plan.annual_price_aed, 18258);
  assert.equal(effective.plan.setup_fee_aed, 2500);

  // Webchat is entitled on STARTER
  assert.equal(effective.capabilities.webchat.entitled, true);
  assert.equal(effective.capabilities.webchat.source, 'PLAN');

  // WhatsApp is locked on STARTER
  assert.equal(effective.capabilities.whatsapp.entitled, false);
  assert.equal(effective.capabilities.whatsapp.source, 'LOCKED');
  assert.equal(effective.capabilities.whatsapp.upgrade_required, 'GROWTH');

  // AI Guide is locked on STARTER
  assert.equal(effective.capabilities.guide.entitled, false);
  assert.equal(effective.capabilities.guide.upgrade_required, 'BUSINESS');

  // Limits
  assert.equal(effective.limits.monthly_interactions.limit, 5000);
  assert.equal(effective.limits.max_languages.limit, 2);
  assert.equal(effective.limits.max_team_users.limit, 1);
});

test('Super Owner override grants WhatsApp to STARTER tenant', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM tenant_subscriptions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'sub-1', tenant_id: tenantId, plan_code: 'STARTER', billing_cycle: 'MONTHLY', currency: 'AED',
            monthly_price_aed: 1790, annual_price_aed: 18258, setup_fee_aed: 2500, status: 'ACTIVE',
            display_name: 'Starter Plan', rank: 1,
            included_capabilities: ['webchat', 'basic_knowledge_intelligence'],
            included_limits: { monthly_interactions: 5000 },
          }],
        };
      }
      if (sql.includes('FROM tenant_entitlement_overrides')) {
        return {
          rowCount: 1,
          rows: [{ capability_key: 'whatsapp', effect: 'GRANT', reason: 'VIP beta testing' }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId });
  assert.equal(effective.capabilities.whatsapp.entitled, true);
  assert.equal(effective.capabilities.whatsapp.source, 'OVERRIDE');
  assert.equal(effective.capabilities.whatsapp.reason, 'VIP beta testing');
});

test('Super Owner override denies capability to a GROWTH tenant', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM tenant_subscriptions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'sub-1', tenant_id: tenantId, plan_code: 'GROWTH', billing_cycle: 'ANNUAL', currency: 'AED',
            monthly_price_aed: 3990, annual_price_aed: 40698, setup_fee_aed: 5000, status: 'ACTIVE',
            display_name: 'Growth Plan', rank: 2,
            included_capabilities: ['webchat', 'whatsapp', 'crm_integrations'],
            included_limits: { monthly_interactions: 20000 },
          }],
        };
      }
      if (sql.includes('FROM tenant_entitlement_overrides')) {
        return {
          rowCount: 1,
          rows: [{ capability_key: 'whatsapp', effect: 'DENY', reason: 'Compliance hold' }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId });
  assert.equal(effective.capabilities.whatsapp.entitled, false);
  assert.equal(effective.capabilities.whatsapp.source, 'OVERRIDE_DENIED');
  assert.equal(effective.capabilities.whatsapp.reason, 'Compliance hold');

  await assert.rejects(
    () => assertTenantEntitlement({ database, tenantId, capabilityKey: 'whatsapp' }),
    (err) => err instanceof TenantEntitlementError && err.code === 'ENTITLEMENT_REQUIRED'
  );
});

test('server-side assertion passes for entitled capability and rejects unentitled', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM tenant_subscriptions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'sub-1', tenant_id: tenantId, plan_code: 'BUSINESS', billing_cycle: 'MONTHLY', currency: 'AED',
            monthly_price_aed: 7990, annual_price_aed: 81498, setup_fee_aed: 9500, status: 'ACTIVE',
            display_name: 'Business Plan', rank: 3,
            included_capabilities: ['webchat', 'whatsapp', 'guide', 'entity_awareness'],
            included_limits: { monthly_interactions: 50000 },
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const guide = await assertTenantEntitlement({ database, tenantId, capabilityKey: 'guide' });
  assert.equal(guide.entitled, true);

  await assert.rejects(
    () => assertTenantEntitlement({ database, tenantId, capabilityKey: 'enterprise_integrations' }),
    (err) => err instanceof TenantEntitlementError && err.code === 'ENTITLEMENT_REQUIRED'
  );
});

test('metric limit assertion throws when limit is exceeded', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM tenant_subscriptions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'sub-1', tenant_id: tenantId, plan_code: 'STARTER', billing_cycle: 'MONTHLY', currency: 'AED',
            monthly_price_aed: 1790, annual_price_aed: 18258, setup_fee_aed: 2500, status: 'ACTIVE',
            display_name: 'Starter Plan', rank: 1,
            included_capabilities: ['webchat'],
            included_limits: { max_team_users: 1 },
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  await assert.rejects(
    () => assertTenantMetricLimit({ database, tenantId, metricKey: 'max_team_users', currentCount: 1, incrementBy: 1 }),
    (err) => err instanceof TenantEntitlementError && err.code === 'LIMIT_EXCEEDED'
  );
});

test('backward compatibility preserves existing enabled Visual AI config', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM tenant_subscriptions')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'sub-1', tenant_id: tenantId, plan_code: 'GROWTH', billing_cycle: 'MONTHLY', currency: 'AED',
            monthly_price_aed: 3990, annual_price_aed: 40698, setup_fee_aed: 5000, status: 'ACTIVE',
            display_name: 'Growth Plan', rank: 2,
            included_capabilities: ['webchat', 'whatsapp'],
            included_limits: {},
          }],
        };
      }
      if (sql.includes('SELECT COUNT(*)::integer FROM ai_assistants')) {
        return { rowCount: 1, rows: [{ visual_ai_config_enabled: true }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId });
  assert.equal(effective.capabilities.visual_ai.entitled, true);
  assert.equal(effective.capabilities.visual_ai.source, 'CONFIG_PRESERVED');
});

