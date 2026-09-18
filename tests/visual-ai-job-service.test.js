import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTenantVisualAiEntitlement,
  claimNextVisualAiGenerationJob,
  completeVisualAiGenerationJob,
  computeVisualAiIdempotencyKey,
  enqueueVisualAiGenerationJob,
  failVisualAiGenerationJob,
  getTenantVisualAiConfig,
  getVisualAiGenerationJob,
  processVisualAiGenerationJob,
  recoverStaleVisualAiGenerationJobs,
  upsertTenantVisualAiConfig,
  VisualAiJobError,
} from '../services/visual-ai-job-service.js';
import {
  createDeterministicMockVisualProvider,
  DETERMINISTIC_MOCK_PNG,
  VisualAIProviderError,
} from '../services/visual-ai-provider-adapter.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const targetResourceId = '44444444-4444-4444-8444-444444444444';
const referenceResourceId = '55555555-5555-4555-8555-555555555555';
const jobId = '66666666-6666-4666-8666-666666666666';

test('assertTenantVisualAiEntitlement rejects disabled tenant', async () => {
  const database = {
    query: async () => ({ rows: [{ tenant_id: tenantA, enabled: false }] }),
  };

  await assert.rejects(
    () => assertTenantVisualAiEntitlement({ database, tenantId: tenantA }),
    (err) => err instanceof VisualAiJobError && err.code === 'VISUAL_AI_NOT_ENABLED'
  );
});

test('enqueueVisualAiGenerationJob verifies target resource ownership under caller tenant', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('tenant_visual_ai_config')) {
        return { rows: [{ tenant_id: tenantA, enabled: true }] };
      }
      if (sql.includes('SELECT id, mime_type, storage_key FROM conversation_resources')) {
        return { rowCount: 0, rows: [] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    () => enqueueVisualAiGenerationJob({
      database,
      tenantId: tenantA,
      conversationId,
      targetResourceId,
      promptInstruction: 'Modern redesign',
    }),
    (err) => err instanceof VisualAiJobError && err.code === 'TARGET_RESOURCE_NOT_FOUND'
  );

  assert.ok(calls.some(({ sql, params }) => sql.includes('conversation_resources') && params.includes(tenantA) && params.includes(targetResourceId)));
});

test('enqueueVisualAiGenerationJob successfully enqueues with deterministic idempotency key', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('tenant_visual_ai_config')) {
        return { rows: [{ tenant_id: tenantA, enabled: true }] };
      }
      if (sql.includes('SELECT id, mime_type, storage_key FROM conversation_resources')) {
        return { rowCount: 1, rows: [{ id: targetResourceId, mime_type: 'image/jpeg', storage_key: 'key' }] };
      }
      if (sql.includes('INSERT INTO visual_ai_generation_jobs')) {
        return { rows: [{ id: jobId, status: 'PENDING', tenant_id: tenantA }] };
      }
      return { rows: [] };
    },
  };

  const job = await enqueueVisualAiGenerationJob({
    database,
    tenantId: tenantA,
    conversationId,
    targetResourceId,
    promptInstruction: 'Modern redesign',
  });

  assert.equal(job.status, 'PENDING');
  const insertCall = calls.find(({ sql }) => sql.includes('INSERT INTO visual_ai_generation_jobs'));
  assert.ok(insertCall);
  const expectedKey = computeVisualAiIdempotencyKey({
    tenantId: tenantA,
    conversationId,
    targetResourceId,
    promptInstruction: 'Modern redesign',
  });
  assert.equal(insertCall.params[11], expectedKey);
});

test('claimNextVisualAiGenerationJob uses SKIP LOCKED to lock pending job', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows: [{ id: jobId, status: 'PROCESSING', attempts: 1 }] };
    },
  };

  const claimed = await claimNextVisualAiGenerationJob(database, { leaseDurationSeconds: 120 });

  assert.equal(claimed.status, 'PROCESSING');
  assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[0].sql, /status = 'PROCESSING'/);
  assert.equal(calls[0].params[0], 120);
});

test('completeVisualAiGenerationJob persists VISUAL_AI_GENERATED resource and completes job', async () => {
  const dbCalls = [];
  const storageCalls = [];
  const database = {
    query: async (sql, params = []) => {
      dbCalls.push({ sql, params });
      if (sql.includes('INSERT INTO conversation_resources')) {
        return { rows: [{ id: 'res-gen-1', tenant_id: tenantA, source_type: 'VISUAL_AI_GENERATED', media_category: 'IMAGE' }] };
      }
      if (sql.includes('UPDATE visual_ai_generation_jobs')) {
        return { rows: [{ id: jobId, status: 'COMPLETED', generated_resource_id: 'res-gen-1' }] };
      }
      return { rows: [] };
    },
  };
  const storage = {
    put: async (args) => { storageCalls.push(args); },
  };

  const result = {
    imageBuffer: DETERMINISTIC_MOCK_PNG,
    mimeType: 'image/png',
    provider: 'MOCK',
    model: 'mock-visual-v1',
    costMetadata: { computeUnits: 0 },
  };

  const completed = await completeVisualAiGenerationJob({
    database,
    storage,
    tenantId: tenantA,
    jobId,
    conversationId,
    result,
  });

  assert.equal(completed.job.status, 'COMPLETED');
  assert.equal(completed.resource.source_type, 'VISUAL_AI_GENERATED');
  assert.equal(storageCalls.length, 1);
  assert.match(storageCalls[0].key, new RegExp(`^conversation-resources/${tenantA}/${conversationId}/`));
});

test('failVisualAiGenerationJob correctly marks retryable vs terminal failure', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows: [{ id: jobId, status: params[0] ? 'PENDING' : 'FAILED' }] };
    },
  };

  // 1. Retryable error
  await failVisualAiGenerationJob({
    database,
    tenantId: tenantA,
    jobId,
    error: new VisualAIProviderError('RATE_LIMIT', 'Rate limited', { retryable: true, status: 429 }),
  });
  assert.equal(calls[0].params[0], true); // isRetryable = true

  // 2. Terminal error
  await failVisualAiGenerationJob({
    database,
    tenantId: tenantA,
    jobId,
    error: new Error('Unrecoverable safety filter'),
    retryable: false,
  });
  assert.equal(calls[1].params[0], false); // isRetryable = false
});

test('recoverStaleVisualAiGenerationJobs recovers expired leases and fails max-attempt jobs', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows: [
        { id: 'job-1', status: 'PENDING' },
        { id: 'job-2', status: 'FAILED', last_error_code: 'VISUAL_AI_LEASE_EXPIRED' },
      ] };
    },
  };

  const summary = await recoverStaleVisualAiGenerationJobs(database);

  assert.equal(summary.recovered, 1);
  assert.equal(summary.failed, 1);
  assert.match(calls[0].sql, /locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP/);
});

test('getVisualAiGenerationJob strictly prevents cross-tenant access', async () => {
  const calls = [];
  const database = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (params[0] === jobId && params[1] === tenantA) {
        return { rows: [{ id: jobId, tenant_id: tenantA }] };
      }
      return { rows: [] };
    },
  };

  const accessible = await getVisualAiGenerationJob({ database, tenantId: tenantA, jobId });
  assert.ok(accessible);
  assert.equal(accessible.tenant_id, tenantA);

  const blocked = await getVisualAiGenerationJob({ database, tenantId: tenantB, jobId });
  assert.equal(blocked, null);
});

test('processVisualAiGenerationJob executes full mock pipeline', async () => {
  const dbCalls = [];
  const storagePuts = [];
  const database = {
    query: async (sql, params = []) => {
      dbCalls.push({ sql, params });
      if (sql.includes('SELECT id, storage_key, mime_type')) {
        return { rowCount: 1, rows: [{ id: targetResourceId, storage_key: 'k1', mime_type: 'image/jpeg' }] };
      }
      if (sql.includes('INSERT INTO conversation_resources')) {
        return { rows: [{ id: 'res-gen-2', source_type: 'VISUAL_AI_GENERATED' }] };
      }
      if (sql.includes('UPDATE visual_ai_generation_jobs')) {
        return { rows: [{ id: jobId, status: 'COMPLETED' }] };
      }
      return { rows: [] };
    },
  };
  const storage = {
    get: async () => [Buffer.from('target-image-bytes')],
    put: async (item) => { storagePuts.push(item); },
  };

  const visualProvider = createDeterministicMockVisualProvider();

  const result = await processVisualAiGenerationJob({
    database,
    storage,
    job: {
      id: jobId,
      tenant_id: tenantA,
      conversation_id: conversationId,
      target_resource_id: targetResourceId,
      prompt_instruction: 'Make Scandinavian',
      grounding_context: {},
      max_attempts: 2,
    },
    visualProvider,
  });

  assert.equal(result.job.status, 'COMPLETED');
  assert.equal(storagePuts.length, 1);
});
