import assert from 'node:assert/strict';
import test from 'node:test';
import { createOnboardingPayloadHash, validateOnboardingInput } from '../services/customer-onboarding-service.js';

test('owner onboarding input requires bounded idempotency, tenant, and administrator fields', () => {
  const valid = validateOnboardingInput({
    idempotencyKey: 'a'.repeat(32),
    payload: { name: 'Example Company', first_name: 'Ada', last_name: 'Lovelace', email: ' Ada@Example.TEST ' },
  });
  assert.deepEqual(valid, { name: 'Example Company', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', tenantRole: 'ADMIN' });
  assert.throws(() => validateOnboardingInput({ idempotencyKey: 'short', payload: {} }));
});

test('onboarding payload hash is deterministic over canonical input', () => {
  const first = createOnboardingPayloadHash({ name: 'Example Company', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', tenantRole: 'ADMIN' });
  const second = createOnboardingPayloadHash({ tenantRole: 'ADMIN', email: 'ada@example.test', lastName: 'Lovelace', firstName: 'Ada', name: 'Example Company' });
  assert.equal(first, second);
});
