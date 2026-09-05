import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import crypto from 'node:crypto';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import { onboardCustomer } from '../services/customer-onboarding-service.js';
import {
  provisionTenantPlatformCapabilities,
  repairTenantPlatformCapabilities,
} from '../services/tenant-platform-provisioning-service.js';
import {
  PLATFORM_CAPABILITY_MANIFEST,
  PLATFORM_CAPABILITY_MANIFEST_VERSION,
  validatePlatformCapabilityManifest,
} from '../services/platform-capability-registry.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('FRESH_TENANT_GOLDEN_PATH_REQUIRES_TEST_DATABASE_URL');
if (!isSafeTestDatabaseUrl(connectionString)) {
  throw new Error('FRESH_TENANT_GOLDEN_PATH_REFUSES_NON_ISOLATED_TEST_DATABASE');
}

const { Pool } = pg;
const database = new Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: 'strict', nodeEnv: 'test' }),
  max: 4,
});
const runTag = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const email = (role) => `fresh-golden-${runTag}-${role}@example.test`;
const names = {
  legacy: `Fresh Golden Legacy ${runTag}`,
  first: `Fresh Golden A ${runTag}`,
  second: `Fresh Golden B ${runTag}`,
};
const envelopeKey = Buffer.alloc(32, 7).toString('base64');
const tenantIds = [];
const fixtureEmails = [email('owner'), email('admin-a'), email('admin-b')];

async function seedHarnessUsers() {
  const owner = await database.query(
    `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
     VALUES ($1, $1, 'test-fixture-only', 'OWNER', 'ACTIVE', 'Golden', 'Owner', TRUE)
     RETURNING id`,
    [email('owner')],
  );
  for (const address of [email('admin-a'), email('admin-b')]) {
    await database.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'test-fixture-only', 'CUSTOMER', 'ACTIVE', 'Golden', 'Administrator', TRUE)`,
      [address],
    );
  }
  return owner.rows[0].id;
}

async function onboard(ownerUserId, name, address, suffix) {
  const result = await onboardCustomer({
    database,
    ownerUserId,
    idempotencyKey: `fresh-golden-path-${runTag}-${suffix}`,
    envelopeKey,
    payload: {
      name,
      first_name: 'Golden',
      last_name: 'Administrator',
      email: address,
      plan_code: 'STARTER',
    },
  });
  tenantIds.push(result.tenant.id);
  return result;
}

async function provisionedState(tenantId) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const state = await provisionTenantPlatformCapabilities({ client, tenantId });
    await client.query('COMMIT');
    return state;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

after(async () => {
  try {
    if (tenantIds.length) {
      await database.query('DELETE FROM owner_onboarding_idempotency WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await database.query('DELETE FROM human_support_escalation_levels WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await database.query('DELETE FROM human_support_escalation_policies WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await database.query('DELETE FROM tenant_platform_provisioning WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await database.query('DELETE FROM crm_pipeline_stages WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
      await database.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
    }
    await database.query('DELETE FROM users WHERE email_normalized = ANY($1::text[]) AND is_test_fixture = TRUE', [fixtureEmails]);
  } finally {
    await database.end();
  }
});

test('cumulative old-tenant and two-fresh-tenant provisioning parity is canonical and isolated', async () => {
  assert.equal(validatePlatformCapabilityManifest(), true);
  assert.ok(PLATFORM_CAPABILITY_MANIFEST.every((item) => item.golden_path_test === 'tests/fresh-tenant-golden-path.test.js'));

  const ownerUserId = await seedHarnessUsers();
  const legacy = await database.query(
    `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
    [names.legacy],
  );
  tenantIds.push(legacy.rows[0].id);
  const repaired = await repairTenantPlatformCapabilities({ database, tenantId: legacy.rows[0].id });
  assert.equal(repaired.length, 1);

  const freshA = await onboard(ownerUserId, names.first, email('admin-a'), 'a');
  const freshB = await onboard(ownerUserId, names.second, email('admin-b'), 'b');
  assert.equal(freshA.onboarding_status, 'ASSIGNED_EXISTING_CUSTOMER');
  assert.equal(freshB.onboarding_status, 'ASSIGNED_EXISTING_CUSTOMER');

  const states = await Promise.all([
    provisionedState(legacy.rows[0].id),
    provisionedState(freshA.tenant.id),
    provisionedState(freshB.tenant.id),
  ]);
  assert.deepEqual(states[0].capabilities, states[1].capabilities);
  assert.deepEqual(states[1].capabilities, states[2].capabilities);
  assert.ok(Object.values(states[0].capabilities).every((capability) => capability.available === true));
  assert.ok(['human_support', 'escalation', 'notification', 'knowledge_intelligence', 'durable_scheduling']
    .every((key) => states[0].capabilities[key].enabled === true));
  assert.equal(states[0].capabilities.guide_persistence.enabled, false);

  const membership = await database.query(
    `SELECT tenant_id, count(*)::integer AS members
       FROM tenant_users WHERE tenant_id = ANY($1::uuid[])
      GROUP BY tenant_id ORDER BY tenant_id`,
    [tenantIds],
  );
  assert.deepEqual(membership.rows.map((row) => row.members).sort(), [1, 1]);

  const provisioning = await database.query(
    `SELECT tenant_id, manifest_version, count(*)::integer AS rows
       FROM tenant_platform_provisioning WHERE tenant_id = ANY($1::uuid[])
      GROUP BY tenant_id, manifest_version ORDER BY tenant_id`,
    [tenantIds],
  );
  assert.equal(provisioning.rows.length, 3);
  assert.ok(provisioning.rows.every((row) => row.rows === 1 && row.manifest_version === PLATFORM_CAPABILITY_MANIFEST_VERSION));

  const escalation = await database.query(
    `SELECT p.tenant_id, count(DISTINCT p.id)::integer AS policies, count(l.id)::integer AS levels
       FROM human_support_escalation_policies p
       LEFT JOIN human_support_escalation_levels l ON l.policy_id = p.id AND l.tenant_id = p.tenant_id
      WHERE p.tenant_id = ANY($1::uuid[])
      GROUP BY p.tenant_id ORDER BY p.tenant_id`,
    [tenantIds],
  );
  assert.equal(escalation.rows.length, 3);
  assert.ok(escalation.rows.every((row) => row.policies === 1 && row.levels === 1));

  const accidentalFeatureRows = await database.query(
    `SELECT
       (SELECT count(*) FROM ai_assistants WHERE tenant_id = ANY($1::uuid[]))::integer AS assistants,
       (SELECT count(*) FROM tenant_channels WHERE tenant_id = ANY($1::uuid[]))::integer AS channels,
       (SELECT count(*) FROM business_identities WHERE tenant_id = ANY($1::uuid[]))::integer AS identities,
       (SELECT count(*) FROM business_profiles WHERE tenant_id = ANY($1::uuid[]))::integer AS profiles`,
    [tenantIds],
  );
  assert.deepEqual(accidentalFeatureRows.rows[0], { assistants: 0, channels: 0, identities: 0, profiles: 0 });

  const templates = await database.query(
    `SELECT message_key, array_agg(locale ORDER BY locale) AS locales
       FROM platform_lifecycle_message_templates WHERE active = TRUE
      GROUP BY message_key ORDER BY message_key`,
  );
  assert.equal(templates.rows.length, 5);
  assert.ok(templates.rows.every((row) => JSON.stringify(row.locales) === JSON.stringify(['ar', 'en', 'tr'])));

  await repairTenantPlatformCapabilities({ database, tenantId: freshA.tenant.id });
  const noDuplicates = await database.query(
    `SELECT
       (SELECT count(*) FROM tenant_platform_provisioning WHERE tenant_id=$1)::integer AS provisioning_rows,
       (SELECT count(*) FROM human_support_escalation_policies WHERE tenant_id=$1)::integer AS policies,
       (SELECT count(*) FROM human_support_escalation_levels WHERE tenant_id=$1)::integer AS levels`,
    [freshA.tenant.id],
  );
  assert.deepEqual(noDuplicates.rows[0], { provisioning_rows: 1, policies: 1, levels: 1 });

  const crossTenant = await database.query(
    `SELECT count(*)::integer AS visible
       FROM tenant_users membership
       JOIN users actor ON actor.id = membership.user_id
      WHERE (actor.email_normalized = $1 AND membership.tenant_id = $2)
         OR (actor.email_normalized = $3 AND membership.tenant_id = $4)`,
    [email('admin-a'), freshB.tenant.id, email('admin-b'), freshA.tenant.id],
  );
  assert.equal(crossTenant.rows[0].visible, 0);
});
