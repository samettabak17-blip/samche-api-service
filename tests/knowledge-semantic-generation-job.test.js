import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimNextImageSemanticGenerationJob,
  enqueueAssistantRecommendationGenerationJob,
  enqueueImageSemanticGenerationJob,
  processImageSemanticGenerationJob,
  recoverStaleImageSemanticGenerationJobs,
  startImageSemanticGenerationWorker,
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

test('provider or persistence failure always writes a terminal-or-retryable state without leaving PROCESSING', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [] };
  } };
  await assert.rejects(
    () => processImageSemanticGenerationJob({
      database,
      job: { id: 'job-1', tenant_id: tenantId, source_id: sourceId, content_hash: extractionHash, attempts: 1 },
      createCandidates: async () => { throw Object.assign(new Error('provider timed out'), { code: 'KNOWLEDGE_GENERATION_TIMEOUT' }); },
    }),
    { code: 'KNOWLEDGE_GENERATION_TIMEOUT' },
  );
  const transition = calls.find(({ sql }) => /UPDATE knowledge_processing_jobs SET status = 'PENDING'/i.test(sql));
  assert.ok(transition);
  assert.equal(transition.params[2], 'KNOWLEDGE_GENERATION_TIMEOUT');
  assert.doesNotMatch(transition.sql, /CASE WHEN \$3/i);
});

test('image semantic jobs retry provider availability but fail deterministic persistence errors', async () => {
  for (const [code, expectedStatus] of [
    ['KNOWLEDGE_GENERATION_PROVIDERS_UNAVAILABLE', 'PENDING'],
    ['KNOWLEDGE_DATABASE_UNAVAILABLE', 'FAILED'],
  ]) {
    const calls = [];
    const database = { query: async (sql, params = []) => { calls.push({ sql, params }); return { rows: [] }; } };
    await assert.rejects(
      processImageSemanticGenerationJob({
        database,
        job: { id: `job-${code}`, tenant_id: tenantId, source_id: sourceId, content_hash: extractionHash, attempts: 1 },
        createCandidates: async () => { throw Object.assign(new Error(code), { code }); },
      }),
      { code },
    );
    assert.ok(calls.some(({ sql }) => new RegExp(`SET status = '${expectedStatus}'`, 'i').test(sql)));
  }
});

test('recovers an expired semantic PROCESSING lease before a worker claims the next job', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/legacy_lease_recovery|semantic_timeout_recovery/i.test(sql)) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ id: 'job-1', status: 'PENDING' }] };
  } };

  const recovered = await recoverStaleImageSemanticGenerationJobs(database);
  await claimNextImageSemanticGenerationJob(database);

  assert.equal(recovered.recovered, 1);
  assert.match(calls[0].sql, /status = 'PROCESSING'/);
  assert.match(calls[0].sql, /locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP/);
  assert.match(calls[0].sql, /locked_until < CURRENT_TIMESTAMP/);
  assert.match(calls[0].sql, /KNOWLEDGE_SEMANTIC_LEASE_EXPIRED/);
  assert.match(calls[0].sql, /stale_recovery_count/);
  assert.match(calls[1].sql, /status = 'PENDING'/);
});

test('requeues one legacy lease-expired terminal job created by the former recovery policy', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/status = 'PROCESSING'/i.test(sql)) return { rows: [] };
    if (/legacy_lease_recovery/i.test(sql)) return { rows: [{ id: 'legacy-job', status: 'PENDING' }] };
    return { rows: [] };
  } };
  const recovered = await recoverStaleImageSemanticGenerationJobs(database);
  assert.equal(recovered.recovered, 1);
  const compatibilityRecovery = calls.find(({ sql }) => /legacy_lease_recovery/i.test(sql));
  assert.ok(compatibilityRecovery);
  assert.match(compatibilityRecovery.sql, /last_error_code = 'KNOWLEDGE_SEMANTIC_LEASE_EXPIRED'/);
  assert.match(compatibilityRecovery.sql, /stale_recovery_count.*= 0/is);
});

test('requeues one legacy semantic provider timeout so the corrected bounded provider contract can finish it', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/status = 'PROCESSING'/i.test(sql)) return { rows: [] };
    if (/legacy_lease_recovery/i.test(sql)) return { rows: [] };
    if (/semantic_thinking_low_recovery/i.test(sql)) return { rows: [] };
    if (/semantic_timeout_recovery/i.test(sql)) return { rows: [{ id: 'timeout-job', status: 'PENDING' }] };
    return { rows: [] };
  } };
  const recovered = await recoverStaleImageSemanticGenerationJobs(database);
  assert.equal(recovered.recovered, 1);
  const compatibilityRecovery = calls.find(({ sql }) => /semantic_timeout_recovery/i.test(sql));
  assert.match(compatibilityRecovery.sql, /last_error_code = 'KNOWLEDGE_GENERATION_TIMEOUT'/);
  assert.match(compatibilityRecovery.sql, /embedding_model = 'IMAGE_SEMANTIC'/);
});

test('requeues one semantic timeout after the low-thinking contract is deployed', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/status = 'PROCESSING'/i.test(sql)) return { rows: [] };
    if (/semantic_thinking_low_recovery/i.test(sql)) return { rows: [{ id: 'thinking-job', status: 'PENDING' }] };
    if (/legacy_lease_recovery|semantic_timeout_recovery/i.test(sql)) return { rows: [] };
    return { rows: [] };
  } };
  const recovered = await recoverStaleImageSemanticGenerationJobs(database);
  assert.equal(recovered.recovered, 1);
  const compatibilityRecovery = calls.find(({ sql }) => /semantic_thinking_low_recovery/i.test(sql));
  assert.match(compatibilityRecovery.sql, /last_error_code = 'KNOWLEDGE_GENERATION_TIMEOUT'/);
  assert.match(compatibilityRecovery.sql, /semantic_timeout_recovery/);
});

test('semantic worker exposes only safe operational status for deployment health checks', async () => {
  const database = { query: async () => ({ rows: [] }) };
  const worker = startImageSemanticGenerationWorker({ database, semanticClassifier: { classify: async () => ({}) }, intervalMs: 60_000, logger: { error: () => {} } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(worker.status().state, 'RUNNING');
  assert.equal(worker.status().last_failure_code, null);
  worker();
  assert.equal(worker.status().state, 'STOPPED');
});

test('recommendation worker logs safe failure diagnostics without provider error content', async () => {
  const logged = [];
  const recommendationJob = {
    id: 'job-1',
    tenant_id: tenantId,
    attempts: 3,
    metadata: {
      assistant_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      business_profile_version_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      requested_by: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      request_fingerprint: extractionHash,
    },
  };
  const database = { query: async (sql) => {
    if (/job_type = 'GENERATE_ASSISTANT_RECOMMENDATION'/i.test(sql) && /FOR UPDATE SKIP LOCKED/i.test(sql)) {
      return { rows: [recommendationJob] };
    }
    return { rows: [] };
  } };
  const worker = startImageSemanticGenerationWorker({
    database,
    semanticClassifier: { classify: async () => ({}) },
    generateRecommendation: async () => {
      throw Object.assign(new Error('provider returned token=should-not-be-logged'), {
        code: 'KNOWLEDGE_GENERATION_PROVIDER_FAILED',
      });
    },
    intervalMs: 60_000,
    logger: { error: (...args) => logged.push(args) },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  worker();

  const event = logged.find(([eventName]) => eventName === 'KNOWLEDGE_SEMANTIC_GENERATION_WORKER_FAILED');
  assert.ok(event);
  const diagnostic = event[1];
  assert.deepEqual(diagnostic, {
    job_id: 'job-1',
    tenant_id: tenantId,
    assistant_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    last_error_code: 'KNOWLEDGE_GENERATION_PROVIDER_FAILED',
    error_class: 'Error',
    safe_error_message: 'Recommendation generation provider request failed',
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /should-not-be-logged/);
});

test('enqueues fresh recommendation job as PENDING with zero attempts when retryRequested is true or job failed', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/INSERT INTO knowledge_processing_jobs/i.test(sql)) {
      return { rows: [{ id: 'job-rec-1', status: 'PENDING', attempts: 0, last_error_code: null }] };
    }
    return { rows: [] };
  } };

  const job = await enqueueAssistantRecommendationGenerationJob({
    database,
    tenantId,
    assistantId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    businessProfileVersionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    requestedBy: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    fingerprint: extractionHash,
    providerPolicy: 'gemini-policy',
    retryRequested: true,
  });

  assert.equal(job.status, 'PENDING');
  assert.equal(job.attempts, 0);
  const insertCall = calls.find(({ sql }) => /INSERT INTO knowledge_processing_jobs/i.test(sql));
  assert.ok(insertCall);
  assert.equal(insertCall.params[3], true);
});

