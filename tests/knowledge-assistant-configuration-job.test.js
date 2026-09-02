import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimNextAssistantConfigurationGenerationJob,
  enqueueAssistantConfigurationGenerationJob,
  processAssistantConfigurationGenerationJob,
} from '../services/knowledge-semantic-generation-job-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const assistantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const recommendationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const profileVersionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actorId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const fingerprint = 'b'.repeat(64);

test('accepts a pinned assistant configuration job without calling the provider', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'job-configuration', status: 'PENDING', metadata: {} }] };
  } };

  const job = await enqueueAssistantConfigurationGenerationJob({
    database, tenantId, assistantId, recommendationId, businessProfileVersionId: profileVersionId,
    requestedBy: actorId, fingerprint, providerPolicy: 'structured-policy',
  });

  assert.equal(job.status, 'PENDING');
  assert.match(calls[0].sql, /GENERATE_ASSISTANT_CONFIGURATION/);
  assert.equal(calls[0].params.some((value) => String(value).includes(profileVersionId)), true);
});

test('claims configuration jobs only from the semantic worker queue', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'job-configuration', job_type: 'GENERATE_ASSISTANT_CONFIGURATION' }] };
  } };
  const job = await claimNextAssistantConfigurationGenerationJob(database);
  assert.equal(job.job_type, 'GENERATE_ASSISTANT_CONFIGURATION');
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0].sql, /job_type = 'GENERATE_ASSISTANT_CONFIGURATION'/);
});

test('configuration worker persists only a NEEDS_REVIEW artifact and reaches READY', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  } };
  const result = await processAssistantConfigurationGenerationJob({
    database,
    job: {
      id: 'job-configuration', tenant_id: tenantId, attempts: 1,
      metadata: {
        assistant_id: assistantId, recommendation_id: recommendationId,
        business_profile_version_id: profileVersionId, requested_by: actorId,
        request_fingerprint: fingerprint,
      },
    },
    generateConfiguration: async (input) => {
      assert.equal(input.businessProfileVersionId, profileVersionId);
      assert.equal(input.expectedFingerprint, fingerprint);
      return { configuration: { id: 'configuration-1', status: 'NEEDS_REVIEW' }, reused: false };
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(calls.some(({ sql }) => /SET status = 'READY'/i.test(sql)), true);
  assert.equal(calls.some(({ sql }) => /active_configuration_version_id/i.test(sql)), false);
});

test('configuration worker retries a provider failure without creating a partial configuration', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  } };

  await assert.rejects(
    processAssistantConfigurationGenerationJob({
      database,
      job: {
        id: 'job-configuration-failed', tenant_id: tenantId, attempts: 1,
        metadata: {
          assistant_id: assistantId, recommendation_id: recommendationId,
          business_profile_version_id: profileVersionId, requested_by: actorId,
          request_fingerprint: fingerprint,
        },
      },
      generateConfiguration: async () => {
        const error = new Error('provider unavailable');
        error.code = 'PROVIDER_UNAVAILABLE';
        throw error;
      },
    }),
    { code: 'PROVIDER_UNAVAILABLE' },
  );

  assert.equal(calls.some(({ sql }) => /SET status = 'PENDING'/i.test(sql)), true);
  assert.equal(calls.some(({ sql }) => /INSERT INTO assistant_knowledge_configurations/i.test(sql)), false);
  assert.equal(calls.some(({ sql }) => /active_configuration_version_id/i.test(sql)), false);
});
