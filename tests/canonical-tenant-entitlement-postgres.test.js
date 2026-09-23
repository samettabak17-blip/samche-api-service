process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import {
  listPlatformPlans,
  getTenantSubscription,
  resolveEffectiveTenantEntitlements,
  assertTenantEntitlement,
  assertTenantMetricLimit,
  grantTenantEntitlementOverride,
  revokeTenantEntitlementOverride,
  updateTenantUsageAllocation,
  changeTenantSubscriptionAsOwner,
  listTenantEntitlementAuditLog,
  TenantEntitlementError,
} from '../services/tenant-entitlement-service.js';
import { createTenantWithPlatformCapabilities } from '../services/tenant-platform-provisioning-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) throw new Error('TEST_DATABASE_URL_REQUIRED');

const database = new pg.Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }),
  max: 6,
});

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const created = {};

test('PostgreSQL: listPlatformPlans returns canonical plans with pricing, annual discount, and limits', async () => {
  const plans = await listPlatformPlans({ database });
  assert.equal(plans.length, 4);

  const starter = plans.find((p) => p.code === 'STARTER');
  assert.equal(Number(starter.monthly_price_aed), 1790);
  assert.equal(Number(starter.annual_price_aed), 18258);
  assert.equal(Number(starter.setup_fee_aed), 2500);
  assert.equal(starter.currency, 'AED');
  assert.equal(starter.included_limits.monthly_interactions, 5000);
  assert.equal(starter.included_limits.max_languages, 2);

  const growth = plans.find((p) => p.code === 'GROWTH');
  assert.equal(Number(growth.monthly_price_aed), 3990);
  assert.equal(Number(growth.annual_price_aed), 40698);
  assert.equal(Number(growth.setup_fee_aed), 5000);
  assert.ok(growth.included_capabilities.includes('whatsapp'));

  const business = plans.find((p) => p.code === 'BUSINESS');
  assert.equal(Number(business.monthly_price_aed), 7990);
  assert.equal(Number(business.annual_price_aed), 81498);
  assert.equal(Number(business.setup_fee_aed), 9500);
  assert.ok(business.included_capabilities.includes('guide'));
  assert.ok(business.included_capabilities.includes('entity_awareness'));

  const enterprise = plans.find((p) => p.code === 'ENTERPRISE');
  assert.equal(Number(enterprise.monthly_price_aed), 12500);
  assert.equal(Number(enterprise.annual_price_aed), 127500);
  assert.equal(Number(enterprise.setup_fee_aed), 20000);
  assert.ok(enterprise.included_capabilities.includes('multiple_brands_websites'));
});

test('PostgreSQL: fresh tenant provisioning automatically initializes subscriptions & default allocations', async () => {
  const owner = await database.query(
    `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
     VALUES ($1, $1, 'test-fixture-only', 'OWNER', 'ACTIVE', 'Test', 'Owner', TRUE)
     RETURNING id`,
    [`owner-${suffix}@example.com`]
  );
  created.ownerId = owner.rows[0].id;

  const tenant = await createTenantWithPlatformCapabilities({
    database,
    name: `Entitlement Test Tenant ${suffix}`,
    planCode: 'STARTER',
  });
  created.tenantId = tenant.id;

  const sub = await getTenantSubscription({ database, tenantId: created.tenantId });
  assert.equal(sub.plan_code, 'STARTER');
  assert.equal(sub.billing_cycle, 'MONTHLY');
  assert.equal(Number(sub.monthly_price_aed), 1790);
  assert.equal(sub.status, 'ACTIVE');

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId: created.tenantId });
  assert.equal(effective.plan.code, 'STARTER');
  assert.equal(effective.capabilities.webchat.entitled, true);
  assert.equal(effective.capabilities.whatsapp.entitled, false);
  assert.equal(effective.capabilities.guide.entitled, false);
  assert.equal(effective.limits.monthly_interactions.limit, 5000);
});

test('PostgreSQL: Super Owner can change plan and billing cycle to ANNUAL with 15% discount', async () => {
  const updatedSub = await changeTenantSubscriptionAsOwner({
    database,
    tenantId: created.tenantId,
    ownerUserId: created.ownerId,
    planCode: 'GROWTH',
    billingCycle: 'ANNUAL',
  });

  assert.equal(updatedSub.plan_code, 'GROWTH');
  assert.equal(updatedSub.billing_cycle, 'ANNUAL');
  assert.equal(Number(updatedSub.annual_price_aed), 40698);

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId: created.tenantId });
  assert.equal(effective.plan.code, 'GROWTH');
  assert.equal(effective.capabilities.whatsapp.entitled, true);
  assert.equal(effective.capabilities.guide.entitled, false);
  assert.equal(effective.limits.monthly_interactions.limit, 20000);
});

test('PostgreSQL: Super Owner can grant and revoke entitlement overrides', async () => {
  const override = await grantTenantEntitlementOverride({
    database,
    tenantId: created.tenantId,
    capabilityKey: 'guide',
    effect: 'GRANT',
    reason: 'Partner pilot program',
    ownerUserId: created.ownerId,
  });

  assert.equal(override.capability_key, 'guide');
  assert.equal(override.effect, 'GRANT');

  let effective = await resolveEffectiveTenantEntitlements({ database, tenantId: created.tenantId });
  assert.equal(effective.capabilities.guide.entitled, true);
  assert.equal(effective.capabilities.guide.source, 'OVERRIDE');

  const revoked = await revokeTenantEntitlementOverride({
    database,
    tenantId: created.tenantId,
    capabilityKey: 'guide',
    ownerUserId: created.ownerId,
  });
  assert.equal(revoked.revoked, true);

  effective = await resolveEffectiveTenantEntitlements({ database, tenantId: created.tenantId });
  assert.equal(effective.capabilities.guide.entitled, false);
  assert.equal(effective.capabilities.guide.source, 'LOCKED');
});

test('PostgreSQL: Super Owner can update custom usage limits and audit history tracks all mutations', async () => {
  const alloc = await updateTenantUsageAllocation({
    database,
    tenantId: created.tenantId,
    metricKey: 'monthly_interactions',
    allocatedLimit: 75000,
    ownerUserId: created.ownerId,
  });

  assert.equal(alloc.allocated_limit, 75000);

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId: created.tenantId });
  assert.equal(effective.limits.monthly_interactions.limit, 75000);

  const audit = await listTenantEntitlementAuditLog({ database, tenantId: created.tenantId });
  assert.ok(audit.length >= 3);
  assert.ok(audit.some((a) => a.action_type === 'PLAN_CHANGE'));
  assert.ok(audit.some((a) => a.action_type === 'LIMIT_UPDATE'));
});

test('PostgreSQL: strict tenant isolation ensures Tenant A overrides do not leak to Tenant B', async () => {
  const tenantB = await createTenantWithPlatformCapabilities({
    database,
    name: `Tenant B ${suffix}`,
    planCode: 'STARTER',
  });

  const effectiveB = await resolveEffectiveTenantEntitlements({ database, tenantId: tenantB.id });
  assert.equal(effectiveB.plan.code, 'STARTER');
  assert.equal(effectiveB.capabilities.whatsapp.entitled, false);
  assert.equal(effectiveB.limits.monthly_interactions.limit, 5000);
});

test.after(async () => {
  await database.end();
});


