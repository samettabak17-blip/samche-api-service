import assert from 'node:assert/strict';
import test from 'node:test';
import { createOnboardingPayloadHash, onboardCustomer, validateOnboardingInput } from '../services/customer-onboarding-service.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';

test('owner onboarding input requires bounded idempotency, tenant, and administrator fields', () => {
  const valid = validateOnboardingInput({
    idempotencyKey: 'a'.repeat(32),
    payload: { name: 'Example Company', first_name: 'Ada', last_name: 'Lovelace', email: ' Ada@Example.TEST ', plan_code: 'STARTER' },
  });
  assert.deepEqual(valid, { name: 'Example Company', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', tenantRole: 'ADMIN', planCode: 'STARTER' });
  assert.throws(() => validateOnboardingInput({ idempotencyKey: 'short', payload: {} }));
});

test('onboarding payload hash is deterministic over canonical input', () => {
  const first = createOnboardingPayloadHash({ name: 'Example Company', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', tenantRole: 'ADMIN', planCode: 'STARTER' });
  const second = createOnboardingPayloadHash({ planCode: 'STARTER', tenantRole: 'ADMIN', email: 'ada@example.test', lastName: 'Lovelace', firstName: 'Ada', name: 'Example Company' });
  assert.equal(first, second);
});

test('normal owner onboarding provisions the tenant platform before committing', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
      if (sql.includes('FROM owner_onboarding_idempotency')) return { rowCount: 0, rows: [] };
      if (sql.includes('INSERT INTO owner_onboarding_idempotency')) return { rowCount: 1, rows: [] };
      if (sql.includes('INSERT INTO tenants')) return { rowCount: 1, rows: [{ id: TENANT_ID, name: params[0], status: 'active', plan_code: params[1] }] };
      if (sql.includes('SELECT id, plan_code, status FROM tenants')) return { rowCount: 1, rows: [{ id: TENANT_ID, plan_code: 'STARTER', status: 'active' }] };
      if (sql.includes('ensure_tenant_platform_capabilities')) return { rowCount: 1, rows: [{}] };
      if (sql.includes('AS assistant_enabled')) return { rowCount: 1, rows: [{ human_support_enabled: true }] };
      if (sql.includes('FROM users WHERE email_normalized')) return { rowCount: 1, rows: [{ id: CUSTOMER_ID, email: 'ada@example.test', system_role: 'CUSTOMER', status: 'ACTIVE' }] };
      if (sql.includes('INSERT INTO tenant_users')) return { rowCount: 1, rows: [] };
      if (sql.includes('UPDATE owner_onboarding_idempotency')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const result = await onboardCustomer({
    database: { connect: async () => client },
    ownerUserId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: 'a'.repeat(32),
    payload: { name: 'Synthetic Company', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test', plan_code: 'STARTER' },
  });

  const ensureIndex = calls.findIndex((sql) => sql.includes('ensure_tenant_platform_capabilities'));
  const commitIndex = calls.indexOf('COMMIT');
  assert.ok(ensureIndex > -1);
  assert.ok(ensureIndex < commitIndex);
  assert.equal(result.tenant.id, TENANT_ID);
});
