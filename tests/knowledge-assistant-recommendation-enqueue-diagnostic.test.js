import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAssistantRecommendationEnqueueFailureDiagnostic } from '../services/knowledge-semantic-generation-job-service.js';

test('records only safe metadata when recommendation enqueue fails before a job exists', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[0] }] };
  } };
  await recordAssistantRecommendationEnqueueFailureDiagnostic({
    database,
    requestId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    assistantId: '33333333-3333-4333-8333-333333333333',
    businessProfileVersionId: '44444444-4444-4444-8444-444444444444',
    phase: 'ENQUEUE',
    error: Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'safe_constraint', table: 'knowledge_processing_jobs' }),
  });
  const insert = calls[0];
  assert.match(insert.sql, /knowledge_assistant_recommendation_enqueue_failure_diagnostics/i);
  assert.equal(insert.params.includes('23505'), true);
  assert.equal(insert.params.includes('safe_constraint'), true);
  assert.equal(insert.params.includes('knowledge_processing_jobs'), true);
  assert.equal(insert.params.includes(null), true);
  assert.equal(insert.params.some((value) => String(value).includes('duplicate key')), false);
});

test('keeps a domain code separate from database metadata', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[0] }] };
  } };

  await recordAssistantRecommendationEnqueueFailureDiagnostic({
    database,
    requestId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    assistantId: '33333333-3333-4333-8333-333333333333',
    businessProfileVersionId: '44444444-4444-4444-8444-444444444444',
    phase: 'PREPARE',
    error: Object.assign(new Error('invalid'), { code: 'KNOWLEDGE_PROFILE_NOT_FOUND' }),
  });

  assert.equal(calls[0].params.includes('KNOWLEDGE_PROFILE_NOT_FOUND'), true);
  assert.equal(calls[0].params.includes(null), true);
});
