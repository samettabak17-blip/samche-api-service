import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GuideDomainError,
  normalizeGuideHostname,
  resolveActiveGuideDomain,
  guideDomainCacheKey,
  archiveGuideDomain,
  activateGuideDomain,
  verifyGuideDomainDns,
  managedGuideHostnameFromSlug,
} from '../services/guide-domain-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const assistantId = '22222222-2222-4222-8222-222222222222';

test('normalizes a public guide hostname without accepting URL, port, wildcard, or IP input', () => {
  assert.equal(normalizeGuideHostname(' BlueDune.Staging.SamcheCompany.com. '), 'bluedune.staging.samchecompany.com');
  for (const invalid of ['https://bluedune.example.test', 'bluedune.example.test:443', '*.example.test', '127.0.0.1', '']) {
    assert.throws(() => normalizeGuideHostname(invalid), (error) => error instanceof GuideDomainError && error.code === 'GUIDE_DOMAIN_INVALID_HOSTNAME');
  }
});

test('managed Guide slugs resolve to the platform namespace and reject takeover-shaped input', () => {
  assert.equal(managedGuideHostnameFromSlug('Blue-Dune', { NODE_ENV: 'production' }), 'blue-dune.guide.samchecompany.com');
  assert.equal(managedGuideHostnameFromSlug('Blue-Dune', { NODE_ENV: 'staging' }), 'blue-dune.guide.staging.samchecompany.com');
  assert.equal(managedGuideHostnameFromSlug('exampletenant', { NODE_ENV: 'production', RENDER_SERVICE_NAME: 'samche-api-staging' }), 'exampletenant.guide.staging.samchecompany.com');
  assert.throws(() => managedGuideHostnameFromSlug('blue.dune'), (error) => error.code === 'GUIDE_DOMAIN_INVALID_SLUG');
  assert.equal(managedGuideHostnameFromSlug('clinic', { GUIDE_MANAGED_DOMAIN_SUFFIX: 'guide.example.test' }), 'clinic.guide.example.test');
});

test('resolves only an active hostname whose channel, tenant, and assistant ownership agree', async () => {
  const database = {
    async query(sql, parameters) {
      assert.match(sql, /guide_domains gd/i);
      assert.match(sql, /gd\.status = 'ACTIVE'/i);
      assert.deepEqual(parameters, ['bluedune.staging.samchecompany.com']);
      return {
        rowCount: 1,
        rows: [{
          domain_id: '33333333-3333-4333-8333-333333333333', hostname: 'bluedune.staging.samchecompany.com', tenant_id: tenantId,
          assistant_id: assistantId, channel_id: '44444444-4444-4444-8444-444444444444', channel_assistant_id: assistantId,
          channel_type: 'SAMCHEGUIDE', channel_status: 'active', assistant_status: 'active', integration_enabled: true,
        }],
      };
    },
  };
  const resolved = await resolveActiveGuideDomain({ database, hostname: 'BlueDune.Staging.SamcheCompany.com' });
  assert.equal(resolved?.tenant_id, tenantId);
  assert.equal(resolved?.assistant_id, assistantId);
});

test('fails closed for an archived or ownership-mismatched hostname', async () => {
  const database = {
    async query() {
      return {
        rowCount: 1,
        rows: [{
          domain_id: '33333333-3333-4333-8333-333333333333', hostname: 'bluedune.staging.samchecompany.com', tenant_id: tenantId,
          assistant_id: assistantId, channel_id: '44444444-4444-4444-8444-444444444444', channel_assistant_id: '55555555-5555-4555-8555-555555555555',
          channel_type: 'SAMCHEGUIDE', channel_status: 'active', assistant_status: 'active', integration_enabled: true,
        }],
      };
    },
  };
  assert.equal(await resolveActiveGuideDomain({ database, hostname: 'bluedune.staging.samchecompany.com' }), null);
});

test('partitions public Guide cache identity by hostname and scope', () => {
  const first = guideDomainCacheKey({ hostname: 'bluedune.staging.samchecompany.com', tenantId, assistantId });
  const otherHost = guideDomainCacheKey({ hostname: 'clinic.staging.samchecompany.com', tenantId, assistantId });
  const otherTenant = guideDomainCacheKey({ hostname: 'bluedune.staging.samchecompany.com', tenantId: '66666666-6666-4666-8666-666666666666', assistantId });
  assert.notEqual(first, otherHost);
  assert.notEqual(first, otherTenant);
});

test('archives only the exact tenant assistant domain and records the scoped audit event', async () => {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.startsWith('UPDATE guide_domains')) {
        return { rowCount: 1, rows: [{ id: '33333333-3333-4333-8333-333333333333', tenant_id: tenantId, assistant_id: assistantId, channel_id: '44444444-4444-4444-8444-444444444444', hostname: 'bluedune.staging.samchecompany.com', status: 'ARCHIVED', verification_record_type: 'CNAME', verification_target: 'samche-api-staging.onrender.com' }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const result = await archiveGuideDomain({ client, tenantId, assistantId, domainId: '33333333-3333-4333-8333-333333333333', actorUserId: '55555555-5555-4555-8555-555555555555' });
  assert.equal(result.status, 'ARCHIVED');
  assert.deepEqual(calls[0].parameters, ['33333333-3333-4333-8333-333333333333', tenantId, assistantId, '55555555-5555-4555-8555-555555555555']);
  assert.match(calls[0].sql, /updated_by=\$4/i);
  assert.match(calls[1].sql, /guide_domain_audit_events/i);
});

test('activates only a verified exact scope and never accepts an unverified binding', async () => {
  const client = {
    async query(sql) {
      if (sql.startsWith('UPDATE guide_domains')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
  };
  await assert.rejects(
    activateGuideDomain({ client, tenantId, assistantId, domainId: '33333333-3333-4333-8333-333333333333', actorUserId: '55555555-5555-4555-8555-555555555555' }),
    (error) => error instanceof GuideDomainError && error.code === 'GUIDE_DOMAIN_NOT_VERIFIED',
  );
});

test('verifies the configured CNAME target into VERIFIED only; ingress readiness controls the separate ACTIVE transition', async () => {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.startsWith('SELECT')) return { rowCount: 1, rows: [{ id: '33333333-3333-4333-8333-333333333333', tenant_id: tenantId, assistant_id: assistantId, channel_id: '44444444-4444-4444-8444-444444444444', hostname: 'bluedune.staging.samchecompany.com', status: 'PENDING', verification_target: 'samche-api-staging.onrender.com' }] };
      if (sql.startsWith('UPDATE guide_domains') && sql.includes("status='VERIFIED'")) return { rowCount: 1, rows: [{ id: '33333333-3333-4333-8333-333333333333', tenant_id: tenantId, assistant_id: assistantId, channel_id: '44444444-4444-4444-8444-444444444444', hostname: 'bluedune.staging.samchecompany.com', status: 'VERIFIED', verification_record_type: 'CNAME', verification_target: 'samche-api-staging.onrender.com' }] };
      return { rowCount: 1, rows: [] };
    },
  };
  const domain = await verifyGuideDomainDns({ client, tenantId, assistantId, domainId: '33333333-3333-4333-8333-333333333333', actorUserId: '55555555-5555-4555-8555-555555555555', resolveCname: async () => ['samche-api-staging.onrender.com.'] });
  assert.equal(domain.status, 'VERIFIED');
  assert.ok(calls.some(({ sql }) => /status='VERIFIED'/.test(sql)));
  assert.equal(calls.some(({ sql }) => /status='ACTIVE'/.test(sql)), false);
  assert.ok(calls.some(({ sql }) => /'VERIFIED'/.test(sql)));
});

test('records a failed DNS verification as a terminal retryable domain state without activating the hostname', async () => {
  const calls = [];
  const client = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.startsWith('SELECT')) return { rowCount: 1, rows: [{ id: '33333333-3333-4333-8333-333333333333', tenant_id: tenantId, assistant_id: assistantId, channel_id: '44444444-4444-4444-8444-444444444444', hostname: 'bluedune.staging.samchecompany.com', status: 'PENDING', verification_target: 'samche-api-staging.onrender.com' }] };
      if (sql.startsWith('UPDATE guide_domains') && sql.includes("status='FAILED'")) return { rowCount: 1, rows: [{ id: '33333333-3333-4333-8333-333333333333', tenant_id: tenantId, assistant_id: assistantId, channel_id: '44444444-4444-4444-8444-444444444444', hostname: 'bluedune.staging.samchecompany.com', status: 'FAILED', verification_record_type: 'CNAME', verification_target: 'samche-api-staging.onrender.com' }] };
      return { rowCount: 1, rows: [] };
    },
  };
  const domain = await verifyGuideDomainDns({ client, tenantId, assistantId, domainId: '33333333-3333-4333-8333-333333333333', actorUserId: '55555555-5555-4555-8555-555555555555', resolveCname: async () => ['wrong-ingress.example'] });
  assert.equal(domain.status, 'FAILED');
  assert.equal(calls.some(({ sql }) => /status='ACTIVE'/.test(sql)), false);
});
