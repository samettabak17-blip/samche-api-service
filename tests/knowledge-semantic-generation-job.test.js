import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimNextImageSemanticGenerationJob,
  enqueueImageSemanticGenerationJob,
  processImageSemanticGenerationJob,
  recoverStaleImageSemanticGenerationJobs,
} from '../services/knowledge-semantic-generation-job-service.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sourceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const extractionHash = 'a'.repeat(64);

test('accepts an image semantic generation job without waiting for provider work', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'job-1', status: 'PENDING' }] };
  } };

  const job = await enqueueImageSemanticGenerationJob({ database, tenantId, sourceId, extractionHash });

  assert.equal(job.status, 'PENDING');
  assert.match(calls[0].sql, /GENERATE_IMAGE_CANDIDATES/);
  assert.equal(calls[0].params.includes(extractionHash), true);
});

test('requeues a completed image semantic job so a later assistant assignment can produce its missing behavior recommendation', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'job-1', status: 'PENDING' }] };
  } };

  const job = await enqueueImageSemanticGenerationJob({ database, tenantId, sourceId, extractionHash });

  assert.equal(job.status, 'PENDING');
  assert.match(calls[0].sql, /WHEN knowledge_processing_jobs\.status = 'READY' THEN 'PENDING'/);
  assert.match(calls[0].sql, /available_at = CASE WHEN knowledge_processing_jobs\.status = 'PROCESSING' THEN knowledge_processing_jobs\.available_at ELSE CURRENT_TIMESTAMP END/);
});

test('worker persists durable candidates and assistant recommendations outside the browser request', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => { calls.push({ sql, params }); return { rows: [] }; } };
  const result = await processImageSemanticGenerationJob({
    database,
    job: { id: 'job-1', tenant_id: tenantId, source_id: sourceId, content_hash: extractionHash },
    createCandidates: async () => {
      const candidates = [{ id: 'candidate-1', reused: false }];
      Object.defineProperties(candidates, {
        behavior_recommendations: { value: [{ id: 'recommendation-1', assistant_id: 'assistant-a', status: 'NEEDS_REVIEW' }] },
        warnings: { value: [] },
      });
      return candidates;
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.candidateCount, 1);
  assert.equal(result.behaviorRecommendationCount, 1);
  assert.ok(calls.some(({ sql }) => /SET status = 'READY'/i.test(sql)));
});

test('recovers an expired semantic PROCESSING lease before a worker claims the next job', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rowCount: 1, rows: [{ id: 'job-1', status: 'PENDING' }] };
  } };

  const recovered = await recoverStaleImageSemanticGenerationJobs(database);
  await claimNextImageSemanticGenerationJob(database);

  assert.equal(recovered.recovered, 1);
  assert.match(calls[0].sql, /status = 'PROCESSING'/);
  assert.match(calls[0].sql, /locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP/);
  assert.match(calls[0].sql, /locked_until < CURRENT_TIMESTAMP/);
  assert.match(calls[0].sql, /KNOWLEDGE_SEMANTIC_LEASE_EXPIRED/);
  assert.match(calls[1].sql, /status = 'PENDING'/);
});
