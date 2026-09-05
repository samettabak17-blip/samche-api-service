import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimNextBusinessProfileGenerationJob,
  enqueueBusinessProfileGenerationJob,
  getBusinessProfileGenerationJob,
  processBusinessProfileGenerationJob,
  recoverStaleBusinessProfileGenerationJobs,
} from '../services/knowledge-semantic-generation-job-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const IDENTITY = '22222222-2222-4222-8222-222222222222';
const REQUESTER = '33333333-3333-4333-8333-333333333333';
const JOB = '44444444-4444-4444-8444-444444444444';
const SOURCE_A = '55555555-5555-4555-8555-555555555555';
const SOURCE_B = '66666666-6666-4666-8666-666666666666';
const PROFILE = '77777777-7777-4777-8777-777777777777';
const FINGERPRINT = 'a'.repeat(64);

function job(overrides = {}) {
  return {
    id: JOB,
    tenant_id: TENANT,
    job_type: 'GENERATE_BUSINESS_PROFILE',
    status: 'PENDING',
    attempts: 0,
    metadata: {
      business_identity_id: IDENTITY,
      source_ids: [SOURCE_A, SOURCE_B],
      requested_by: REQUESTER,
      request_fingerprint: FINGERPRINT,
    },
    ...overrides,
  };
}

test('profile generation enqueue is durable, idempotent, and contains only scoped identifiers', async () => {
  const calls = [];
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    return { rowCount: 1, rows: [job()] };
  } };
  const result = await enqueueBusinessProfileGenerationJob({
    database,
    tenantId: TENANT,
    businessIdentityId: IDENTITY,
    sourceIds: [SOURCE_A, SOURCE_B],
    requestedBy: REQUESTER,
    fingerprint: FINGERPRINT,
    providerPolicy: 'provider-neutral-v1',
  });
  assert.equal(result.id, JOB);
  assert.equal(result.status, 'PENDING');
  assert.match(calls[0].sql, /GENERATE_BUSINESS_PROFILE/);
  assert.match(calls[0].sql, /ON CONFLICT/);
  assert.deepEqual(JSON.parse(calls[0].params[1]).source_ids, [SOURCE_A, SOURCE_B]);
});

test('profile job lookup is tenant scoped and never resolves another tenant job', async () => {
  const calls = [];
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    return { rowCount: params[1] === TENANT ? 1 : 0, rows: params[1] === TENANT ? [job()] : [] };
  } };
  assert.equal((await getBusinessProfileGenerationJob({ database, tenantId: TENANT, jobId: JOB })).id, JOB);
  assert.equal(await getBusinessProfileGenerationJob({ database, tenantId: OTHER_TENANT, jobId: JOB }), null);
  assert.match(calls[0].sql, /id = \$1 AND tenant_id = \$2/);
});

test('worker persists one ready profile result for a durable job', async () => {
  const updates = [];
  const database = { async query(sql, params) { updates.push({ sql, params }); return { rowCount: 1, rows: [] }; } };
  const result = await processBusinessProfileGenerationJob({
    database,
    job: job({ status: 'PROCESSING', attempts: 1 }),
    generateProfile: async (input) => {
      assert.equal(input.tenantId, TENANT);
      assert.equal(input.businessIdentityId, IDENTITY);
      assert.deepEqual(input.sourceIds, [SOURCE_A, SOURCE_B]);
      return { profile: { id: PROFILE, status: 'NEEDS_REVIEW' }, reused: false };
    },
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.profile.id, PROFILE);
  assert.match(updates[0].sql, /SET status = 'READY'/);
  assert.equal(JSON.parse(updates[0].params[2]).profile_version_id, PROFILE);
});

test('provider timeout remains a retryable durable job instead of a false completed HTTP failure', async () => {
  const updates = [];
  const database = { async query(sql, params) { updates.push({ sql, params }); return { rowCount: 1, rows: [] }; } };
  const error = Object.assign(new Error('timed out'), { code: 'KNOWLEDGE_GENERATION_TIMEOUT' });
  await assert.rejects(
    () => processBusinessProfileGenerationJob({
      database,
      job: job({ status: 'PROCESSING', attempts: 1 }),
      generateProfile: async () => { throw error; },
    }),
    error,
  );
  assert.match(updates[0].sql, /SET status = 'PENDING'/);
  assert.equal(updates[0].params[2], 'KNOWLEDGE_GENERATION_TIMEOUT');
});

test('invalid profile output is terminal and stale processing leases are recovered', async () => {
  const terminal = [];
  const invalid = Object.assign(new Error('invalid'), { code: 'KNOWLEDGE_GENERATION_SCHEMA_INVALID' });
  await assert.rejects(
    () => processBusinessProfileGenerationJob({
      database: { async query(sql, params) { terminal.push({ sql, params }); return { rowCount: 1, rows: [] }; } },
      job: job({ status: 'PROCESSING', attempts: 1 }),
      generateProfile: async () => { throw invalid; },
    }),
    invalid,
  );
  assert.match(terminal[0].sql, /SET status = 'FAILED'/);

  const database = { async query(sql) {
    assert.match(sql, /job_type = 'GENERATE_BUSINESS_PROFILE'/);
    return { rows: [{ id: JOB, status: 'PENDING' }] };
  } };
  assert.deepEqual(await recoverStaleBusinessProfileGenerationJobs(database), { recovered: 1, failed: 0 });
  assert.equal((await claimNextBusinessProfileGenerationJob({ query: database.query })).id, JOB);
});
