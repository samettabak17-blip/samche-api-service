import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimNextAssistantRecommendationGenerationJob,
  enqueueAssistantRecommendationGenerationJob,
  processAssistantRecommendationGenerationJob,
} from '../services/knowledge-semantic-generation-job-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const assistantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const profileVersionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const fingerprint = 'a'.repeat(64);

const request = {
  tenantId,
  assistantId,
  businessProfileVersionId: profileVersionId,
  requestedBy: actorId,
  fingerprint,
  providerPolicy: 'gemini-structured-v3:thinking-minimal:max-output-1024:timeout-30000',
};

test('accepts an assistant recommendation job without invoking the provider', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'job-1', status: 'PENDING', metadata: {} }] };
  } };

  const job = await enqueueAssistantRecommendationGenerationJob({ database, ...request });

  assert.equal(job.status, 'PENDING');
  assert.match(calls[0].sql, /GENERATE_ASSISTANT_RECOMMENDATION/);
  assert.equal(calls[0].params.includes(fingerprint), true);
  assert.equal(calls[0].params.some((value) => String(value).includes(profileVersionId)), true);
});

test('claims only assistant recommendation jobs so document workers cannot own them', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'job-1', tenant_id: tenantId, job_type: 'GENERATE_ASSISTANT_RECOMMENDATION' }] };
  } };

  const job = await claimNextAssistantRecommendationGenerationJob(database);

  assert.equal(job.job_type, 'GENERATE_ASSISTANT_RECOMMENDATION');
  assert.match(calls[0].sql, /job_type = 'GENERATE_ASSISTANT_RECOMMENDATION'/);
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
});

test('persists only a review recommendation from the captured profile version and then reaches READY', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  } };
  let received;
  const result = await processAssistantRecommendationGenerationJob({
    database,
    job: { id: 'job-1', tenant_id: tenantId, attempts: 1, metadata: { assistant_id: assistantId, business_profile_version_id: profileVersionId, requested_by: actorId, request_fingerprint: fingerprint } },
    generateRecommendation: async (input) => {
      received = input;
      return { recommendation: { id: 'recommendation-1', status: 'NEEDS_REVIEW' }, reused: false };
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(received.businessProfileVersionId, profileVersionId);
  assert.equal(received.allowInactiveProfileSnapshot, true);
  assert.equal(received.expectedFingerprint, fingerprint);
  assert.ok(calls.some(({ sql }) => /SET status = 'READY'/i.test(sql)));
  assert.equal(calls.some(({ sql }) => /assistant_configuration_versions/i.test(sql)), false);
});

test('provider timeout makes the assistant recommendation job retryable without creating an artifact', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  } };
  await assert.rejects(
    () => processAssistantRecommendationGenerationJob({
      database,
      job: { id: 'job-1', tenant_id: tenantId, attempts: 1, metadata: { assistant_id: assistantId, business_profile_version_id: profileVersionId, requested_by: actorId, request_fingerprint: fingerprint } },
      generateRecommendation: async () => { throw Object.assign(new Error('timeout'), { code: 'KNOWLEDGE_GENERATION_TIMEOUT' }); },
    }),
    { code: 'KNOWLEDGE_GENERATION_TIMEOUT' },
  );
  assert.ok(calls.some(({ sql, params }) => /SET status = 'PENDING'/i.test(sql) && params.includes('KNOWLEDGE_GENERATION_TIMEOUT')));
});
