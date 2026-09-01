import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerOnboardingError, validateOnboardingInput } from '../services/customer-onboarding-service.js';

const idempotencyKey = 'x'.repeat(32);
const payload = { name: 'Example Company', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test', plan_code: 'GROWTH' };

test('company onboarding requires a backend-owned canonical plan', () => {
  assert.equal(validateOnboardingInput({ idempotencyKey, payload }).planCode, 'GROWTH');
  assert.throws(() => validateOnboardingInput({ idempotencyKey, payload: { ...payload, plan_code: 'CUSTOM' } }), (error) => error instanceof CustomerOnboardingError && error.code === 'ONBOARDING_INPUT_INVALID');
  assert.throws(() => validateOnboardingInput({ idempotencyKey, payload: { ...payload, plan_code: undefined } }), (error) => error instanceof CustomerOnboardingError && error.code === 'ONBOARDING_INPUT_INVALID');
});
