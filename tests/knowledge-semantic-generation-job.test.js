import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueImageSemanticGenerationJob,
  processImageSemanticGenerationJob,
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
