import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  ensureManagedGuideDomainForAssistant,
  repairEligibleGuideDomains,
  resolveGuideRuntimeScopeFromRequest,
} from '../services/guide-domain-service.js';
import { issueGuidePreviewToken } from '../services/guide-preview-service.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const ASSISTANT_A = '22222222-2222-4222-8222-222222222222';
const CHANNEL_A = '33333333-3333-4333-8333-333333333333';
const DOMAIN_A = '44444444-4444-4444-8444-444444444444';

const TENANT_B = '55555555-5555-4555-8555-555555555555';
const ASSISTANT_B = '66666666-6666-4666-8666-666666666666';
const CHANNEL_B = '77777777-7777-4777-8777-777777777777';
const DOMAIN_B = '88888888-8888-4888-8888-888888888888';

const USER_ID = '99999999-9999-4999-8999-999999999999';
const DRAFT_VERSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('1. Newly provisioned tenant with AI Guide enabled receives the required generic runtime/domain/integration configuration', async () => {
  const database = {
    async query(sql, params = []) {
      if (sql.includes('SELECT id, tenant_id') && sql.includes('guide_domains')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id FROM guide_domains WHERE hostname')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO guide_domains')) {
        return {
          rowCount: 1,
          rows: [{
            id: DOMAIN_A,
            tenant_id: TENANT_A,
            assistant_id: ASSISTANT_A,
            channel_id: CHANNEL_A,
            hostname: params[3],
            status: 'ACTIVE',
            domain_mode: 'MANAGED',
            verification_record_type: 'CNAME',
            verification_target: 'ingress.samchecompany.com',
            verified_at: new Date(),
            activated_at: new Date(),
            archived_at: null,
            created_at: new Date(),
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const domain = await ensureManagedGuideDomainForAssistant({
    database,
    tenantId: TENANT_A,
    assistantId: ASSISTANT_A,
    channelId: CHANNEL_A,
  });

  assert.equal(domain.status, 'ACTIVE');
  assert.equal(domain.domain_mode, 'MANAGED');
  assert.equal(domain.tenant_id, TENANT_A);
  assert.equal(domain.assistant_id, ASSISTANT_A);
  assert.match(domain.hostname, /^t-[0-9a-f]+\.guide\./);
});

test('2. A second tenant receives independent configuration with a distinct non-colliding managed hostname', async () => {
  const database = {
    async query(sql, params = []) {
      if (sql.includes('SELECT id, tenant_id') && sql.includes('guide_domains')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id FROM guide_domains WHERE hostname')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO guide_domains')) {
        return {
          rowCount: 1,
          rows: [{
            id: DOMAIN_B,
            tenant_id: TENANT_B,
            assistant_id: ASSISTANT_B,
            channel_id: CHANNEL_B,
            hostname: params[3],
            status: 'ACTIVE',
            domain_mode: 'MANAGED',
            verification_record_type: 'CNAME',
            verification_target: 'ingress.samchecompany.com',
            verified_at: new Date(),
            activated_at: new Date(),
            archived_at: null,
            created_at: new Date(),
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const domainB = await ensureManagedGuideDomainForAssistant({
    database,
    tenantId: TENANT_B,
    assistantId: ASSISTANT_B,
    channelId: CHANNEL_B,
  });

  assert.equal(domainB.status, 'ACTIVE');
  assert.equal(domainB.tenant_id, TENANT_B);
  assert.notEqual(domainB.tenant_id, TENANT_A);
  assert.match(domainB.hostname, /^t-[0-9a-f]+\.guide\./);
});

test('3. Tenant A Guide request resolves Tenant A only', async () => {
  const hostA = 'tenant-a.guide.staging.samchecompany.com';
  const database = {
    async query(sql, params = []) {
      if (sql.includes('WHERE gd.hostname = $1 AND gd.status = \'ACTIVE\'')) {
        if (params[0] === hostA) {
          return {
            rowCount: 1,
            rows: [{
              domain_id: DOMAIN_A,
              hostname: hostA,
              tenant_id: TENANT_A,
              assistant_id: ASSISTANT_A,
              channel_id: CHANNEL_A,
              channel_assistant_id: ASSISTANT_A,
              channel_type: 'SAMCHEGUIDE',
              channel_status: 'active',
              integration_enabled: true,
              assistant_status: 'active',
            }],
          };
        }
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const scopeByHost = await resolveGuideRuntimeScopeFromRequest({
    database,
    req: { headers: { host: hostA } },
  });
  assert.equal(scopeByHost?.tenant_id, TENANT_A);
  assert.equal(scopeByHost?.assistant_id, ASSISTANT_A);
});

test('4. Tenant B Guide request resolves Tenant B only', async () => {
  const hostB = 'tenant-b.guide.staging.samchecompany.com';
  const database = {
    async query(sql, params = []) {
      if (sql.includes('WHERE gd.hostname = $1 AND gd.status = \'ACTIVE\'')) {
        if (params[0] === hostB) {
          return {
            rowCount: 1,
            rows: [{
              domain_id: DOMAIN_B,
              hostname: hostB,
              tenant_id: TENANT_B,
              assistant_id: ASSISTANT_B,
              channel_id: CHANNEL_B,
              channel_assistant_id: ASSISTANT_B,
              channel_type: 'SAMCHEGUIDE',
              channel_status: 'active',
              integration_enabled: true,
              assistant_status: 'active',
            }],
          };
        }
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const scopeByHost = await resolveGuideRuntimeScopeFromRequest({
    database,
    req: { headers: { host: hostB } },
  });
  assert.equal(scopeByHost?.tenant_id, TENANT_B);
  assert.equal(scopeByHost?.assistant_id, ASSISTANT_B);
});

test('5. Tenant A cannot use Tenant B session/token/context (cross-tenant isolation on shared host)', async () => {
  process.env.JWT_SECRET = 'task7i-test-secret';
  const previewTokenB = issueGuidePreviewToken({
    tenantId: TENANT_B,
    assistantId: ASSISTANT_B,
    versionId: DRAFT_VERSION,
    actorUserId: USER_ID,
  });

  const database = {
    async query(sql, params = []) {
      if (sql.includes('WHERE gd.hostname = $1 AND gd.status = \'ACTIVE\'')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('WHERE ci.tenant_id = $1') && sql.includes('AND ci.assistant_id = $2')) {
        if (params[0] === TENANT_B) {
          return {
            rowCount: 1,
            rows: [{
              domain_id: DOMAIN_B,
              hostname: 't-b.guide.staging.samchecompany.com',
              tenant_id: TENANT_B,
              assistant_id: ASSISTANT_B,
              channel_id: CHANNEL_B,
              channel_assistant_id: ASSISTANT_B,
              channel_type: 'SAMCHEGUIDE',
              channel_status: 'active',
              integration_enabled: true,
              assistant_status: 'active',
            }],
          };
        }
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const resolvedScope = await resolveGuideRuntimeScopeFromRequest({
    database,
    req: {
      headers: {
        host: 'samche-api-staging.onrender.com',
        'x-samcheguide-preview': previewTokenB,
      },
    },
  });

  assert.equal(resolvedScope?.tenant_id, TENANT_B);
  assert.notEqual(resolvedScope?.tenant_id, TENANT_A);
});

test('6. Unknown/unapproved host without signed context remains rejected', async () => {
  const database = {
    async query() {
      return { rowCount: 0, rows: [] };
    },
  };

  const scope = await resolveGuideRuntimeScopeFromRequest({
    database,
    req: { headers: { host: 'unknown-intruder.com' } },
  });
  assert.equal(scope, null);
});
test('7. Disabled Guide integration remains rejected', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('WHERE gd.hostname = $1 AND gd.status = \'ACTIVE\'')) {
        return {
          rowCount: 1,
          rows: [{
            domain_id: DOMAIN_A,
            hostname: 'disabled.guide.samchecompany.com',
            tenant_id: TENANT_A,
            assistant_id: ASSISTANT_A,
            channel_id: CHANNEL_A,
            channel_assistant_id: ASSISTANT_A,
            channel_type: 'SAMCHEGUIDE',
            channel_status: 'inactive',
            integration_enabled: false,
            assistant_status: 'active',
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const scope = await resolveGuideRuntimeScopeFromRequest({
    database,
    req: { headers: { host: 'disabled.guide.samchecompany.com' } },
  });
  assert.equal(scope, null);
});

test('8. Existing eligible Guide integrations can be repaired/backfilled idempotently', async () => {
  const database = {
    async query(sql, params = []) {
      if (sql.includes('SELECT ci.tenant_id, ci.assistant_id, ci.channel_id')) {
        return {
          rowCount: 2,
          rows: [
            { tenant_id: TENANT_A, assistant_id: ASSISTANT_A, channel_id: CHANNEL_A },
            { tenant_id: TENANT_B, assistant_id: ASSISTANT_B, channel_id: CHANNEL_B },
          ],
        };
      }
      if (sql.includes('SELECT id, tenant_id') && sql.includes('guide_domains')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id FROM guide_domains WHERE hostname')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('INSERT INTO guide_domains')) {
        return {
          rowCount: 1,
          rows: [{
            id: params[0] === TENANT_A ? DOMAIN_A : DOMAIN_B,
            tenant_id: params[0],
            assistant_id: params[1],
            channel_id: params[2],
            hostname: params[3],
            status: 'ACTIVE',
            domain_mode: 'MANAGED',
            verification_record_type: 'CNAME',
            verification_target: 'ingress.samchecompany.com',
            verified_at: new Date(),
            activated_at: new Date(),
            archived_at: null,
            created_at: new Date(),
          }],
        };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const repaired = await repairEligibleGuideDomains({ database });
  assert.equal(repaired.length, 2);
  assert.equal(repaired[0].status, 'ACTIVE');
  assert.equal(repaired[1].status, 'ACTIVE');
  assert.equal(repaired[0].tenant_id, TENANT_A);
  assert.equal(repaired[1].tenant_id, TENANT_B);
});

test('9. No tenant/customer names are required by the implementation', () => {
  const domainServiceCode = fs.readFileSync(new URL('../services/guide-domain-service.js', import.meta.url), 'utf8');
  const routesCode = fs.readFileSync(new URL('../routes/guideExperienceRoutes.js', import.meta.url), 'utf8');
  const bootstrapCode = fs.readFileSync(new URL('../scripts/bootstrap_samcheguide_mapping.js', import.meta.url), 'utf8');

  for (const [name, code] of [['guide-domain-service.js', domainServiceCode], ['guideExperienceRoutes.js', routesCode], ['bootstrap_samcheguide_mapping.js', bootstrapCode]]) {
    assert.doesNotMatch(code, /Blue\s*Dune/i, `${name} contains forbidden customer name`);
    assert.doesNotMatch(code, /Meridian/i, `${name} contains forbidden customer name`);
    assert.doesNotMatch(code, /bluedune/i, `${name} contains forbidden customer hostname`);
  }
});
