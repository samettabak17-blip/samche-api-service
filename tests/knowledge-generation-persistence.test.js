import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceKnowledgeGenerationRun,
  beginKnowledgeGenerationRun,
  completeKnowledgeGenerationRun,
  failKnowledgeGenerationRun,
} from '../services/knowledge-generation-persistence.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('begins a tenant-scoped generation run without persisting prompt or provider secrets', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'RUNNING' }] };
  } };

  const run = await beginKnowledgeGenerationRun({
    database,
    tenantId,
    requestedBy: actorId,
    targetType: 'BUSINESS_PROFILE',
    provider: 'GEMINI',
    model: 'gemini-3-flash-preview',
    prompt: 'Approved tenant facts only',
    provenance: { source_ids: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'] },
  });

  assert.equal(run.status, 'RUNNING');
  assert.match(calls[0].sql, /INSERT INTO knowledge_generation_runs/i);
  assert.deepEqual(calls[0].params.slice(0, 5), [tenantId, actorId, 'BUSINESS_PROFILE', 'GEMINI', 'gemini-3-flash-preview']);
  assert.match(calls[0].params[5], /^[a-f0-9]{64}$/);
  assert.equal(calls[0].params.includes('Approved tenant facts only'), false);
});

test('completion records an output hash and immutable target reference', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[0], status: 'SUCCEEDED', target_id: params[2] }] };
  } };
  const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const targetId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const run = await completeKnowledgeGenerationRun({ database, tenantId, runId, targetId, output: { company_summary: 'Facts' } });

  assert.equal(run.status, 'SUCCEEDED');
  assert.match(calls[0].sql, /status = 'SUCCEEDED'/i);
  assert.match(calls[0].params[3], /^[a-f0-9]{64}$/);
  assert.deepEqual(calls[0].params.slice(0, 3), [runId, tenantId, targetId]);
});

test('failure persists only a safe error code', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[0], status: 'FAILED' }] };
  } };

  await failKnowledgeGenerationRun({
    database,
    tenantId,
    runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    errorCode: 'KNOWLEDGE_GENERATION_TIMEOUT',
  });

  assert.match(calls[0].sql, /status = 'FAILED'/i);
  assert.equal(calls[0].params[2], 'KNOWLEDGE_GENERATION_TIMEOUT');
});

test('records exact fingerprint and bounded stage telemetry without storing prompt content', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'RUNNING' }] };
  } };
  await beginKnowledgeGenerationRun({
    database, tenantId, requestedBy: actorId, targetType: 'BUSINESS_PROFILE', provider: 'GEMINI', model: 'gemini-3-flash-preview',
    prompt: 'sensitive source content', provenance: { source_ids: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'] },
    businessIdentityId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', requestFingerprint: 'a'.repeat(64),
    stage: 'IDENTITY_ANALYSIS', promptCharacterCount: 0, sourceCount: 1,
  });
  assert.match(calls[0].sql, /request_fingerprint/i);
  assert.ok(!calls[0].params.includes('sensitive source content'));

  await advanceKnowledgeGenerationRun({ database, tenantId, runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', stage: 'PROFILE_GENERATION', promptCharacterCount: 8421, sourceCount: 1, elapsedMs: 913 });
  assert.match(calls[1].sql, /stage =/i);
  assert.deepEqual(calls[1].params.slice(2), ['PROFILE_GENERATION', 8421, 1, 913]);
});

test('failed generation run persists stage elapsed time and only a safe error code', async () => {
  const calls = [];
  const database = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: params[0], status: 'FAILED' }] }; } };
  await failKnowledgeGenerationRun({ database, tenantId, runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', errorCode: 'KNOWLEDGE_GENERATION_TIMEOUT', stage: 'PROFILE_GENERATION', elapsedMs: 20004 });
  assert.match(calls[0].sql, /stage =/i);
  assert.deepEqual(calls[0].params.slice(2), ['KNOWLEDGE_GENERATION_TIMEOUT', 'PROFILE_GENERATION', 20004]);
});
