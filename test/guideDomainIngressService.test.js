import assert from 'node:assert/strict';
import test from 'node:test';
import { GuideDomainError } from '../services/guide-domain-service.js';
import { provisionGuideDomainIngress, resolveGuideDomainIngressStatus, verifyGuideDomainIngress } from '../services/guide-domain-ingress-service.js';

const environment = { RENDER_API_KEY: 'test-key', RENDER_SERVICE_ID: 'srv-test' };

function response(status, payload) {
  return { status, async json() { return payload; } };
}

test('the platform-owned Render ingress registers a normalized hostname without leaking provider control to tenant code', async () => {
  const calls = [];
  const result = await provisionGuideDomainIngress({
    hostname: 'BlueDune.Staging.SamcheCompany.com.', environment,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(201, {}); },
  });
  assert.deepEqual(result, { provider: 'RENDER', hostname: 'bluedune.staging.samchecompany.com', state: 'REGISTERED' });
  assert.match(calls[0].url, /services\/srv-test\/custom-domains$/);
  assert.equal(calls[0].options.body, JSON.stringify({ name: 'bluedune.staging.samchecompany.com' }));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
});

test('the ingress treats an already registered hostname as an idempotent platform result', async () => {
  const result = await provisionGuideDomainIngress({ hostname: 'guide.customer.example', environment, fetchImpl: async () => response(409, {}) });
  assert.equal(result.state, 'EXISTING');
});

test('the ingress status must report verified before the application can activate a public hostname', async () => {
  const pending = await resolveGuideDomainIngressStatus({
    hostname: 'guide.customer.example', environment,
    fetchImpl: async () => response(200, [{ name: 'guide.customer.example', verificationStatus: 'unverified' }]),
  });
  assert.equal(pending.verified, false);
  const verified = await resolveGuideDomainIngressStatus({
    hostname: 'guide.customer.example', environment,
    fetchImpl: async () => response(200, { items: [{ name: 'guide.customer.example', verificationStatus: 'verified' }] }),
  });
  assert.equal(verified.verified, true);
});

test('the ingress verification operation is bounded and fails safe without a configured platform credential', async () => {
  await assert.rejects(
    verifyGuideDomainIngress({ hostname: 'guide.customer.example', environment: {}, fetchImpl: async () => response(202, {}) }),
    (error) => error instanceof GuideDomainError && error.code === 'GUIDE_DOMAIN_INGRESS_UNAVAILABLE',
  );
});
