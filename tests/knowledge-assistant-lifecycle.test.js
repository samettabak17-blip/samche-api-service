import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAssistantRecommendation,
  generateAssistantConfigurationVersion,
  reviewAssistantRecommendation,
  rejectAssistantConfigurationVersion,
} from '../services/knowledge-assistant-lifecycle.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assistantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function provider(output) {
  return {
    provider: 'GEMINI', model: 'gemini-3-flash-preview',
    generateAssistantRecommendation: async ({ prompt }) => ({ ...output, captured_prompt: prompt }),
    generateAssistantConfiguration: async ({ prompt }) => ({ ...output, captured_prompt: prompt }),
  };
}

test('generates an assistant-scoped review recommendation from the active approved profile', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM ai_assistants assistant/i.test(sql)) return { rows: [{ assistant_name: 'Sales', profile_version_id: '11111111-1111-4111-8111-111111111111', business_identity_id: '55555555-5555-4555-8555-555555555555', source_scope: { source_ids: ['source-meridian'] }, profile_data: { company_summary: 'Facts' } }] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/INSERT INTO assistant_knowledge_recommendations/i.test(sql)) return { rows: [{ id: '33333333-3333-4333-8333-333333333333', status: 'NEEDS_REVIEW' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: 'SUCCEEDED' }] };
    return { rows: [] };
  } };

  const result = await generateAssistantRecommendation({ database, provider: provider({ schema_version: 2, tone: 'Professional' }), tenantId, assistantId, requestedBy: actorId });

  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(calls.some(({ sql }) => /profile\.active_version_id[\s\S]*profile_version\.status = 'APPROVED'/i.test(sql)));
  const insert = calls.find(({ sql }) => /INSERT INTO assistant_knowledge_recommendations/i.test(sql));
  assert.equal(insert.params[2].schema_version, 2);
  assert.match(insert.params[2].captured_prompt, /current tenant/i);
  assert.match(insert.params[2].captured_prompt, /Never use SamChe.*as a default/i);
  assert.equal(insert.params[5], 2);
  assert.equal(insert.params[3].business_identity_id, '55555555-5555-4555-8555-555555555555');
  assert.deepEqual(insert.params[3].source_scope.source_ids, ['source-meridian']);
});

test('generates a review-only configuration from an approved recommendation', async () => {
  const calls = [];
  const recommendationId = '33333333-3333-4333-8333-333333333333';
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM assistant_knowledge_recommendations recommendation/i.test(sql)) return { rows: [{ recommendation_data: { tone: 'Professional' }, profile_version_id: '11111111-1111-4111-8111-111111111111', business_identity_id: '55555555-5555-4555-8555-555555555555', source_scope: { source_ids: ['source-meridian'] }, profile_data: { company_summary: 'Facts' } }] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/INSERT INTO assistant_configuration_versions/i.test(sql)) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', status: 'NEEDS_REVIEW' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: 'SUCCEEDED' }] };
    return { rows: [] };
  } };

  const result = await generateAssistantConfigurationVersion({ database, provider: provider({ schema_version: 2, assistant_instructions: 'Use approved facts.' }), tenantId, assistantId, recommendationId, requestedBy: actorId });

  assert.equal(result.status, 'NEEDS_REVIEW');
  const insert = calls.find(({ sql }) => /INSERT INTO assistant_configuration_versions/i.test(sql));
  assert.equal(insert.params[4], recommendationId);
  assert.equal(insert.params[5], '22222222-2222-4222-8222-222222222222');
  assert.equal(insert.params[6], 2);
  assert.match(insert.params[2].captured_prompt, /factual profile/i);
  assert.match(insert.params[2].captured_prompt, /approved AI recommendation/i);
  const run = calls.find(({ sql }) => /INSERT INTO knowledge_generation_runs/i.test(sql));
  assert.equal(run.params[6].business_identity_id, '55555555-5555-4555-8555-555555555555');
  assert.deepEqual(run.params[6].source_scope.source_ids, ['source-meridian']);
});

test('review transitions remain explicit and tenant scoped', async () => {
  const database = { query: async (sql, params) => ({ rows: [{ id: params[0], status: /assistant_knowledge_recommendations/.test(sql) ? params[4] : 'REJECTED' }] }) };
  const recommendation = await reviewAssistantRecommendation({ database, tenantId, assistantId, recommendationId: '33333333-3333-4333-8333-333333333333', reviewedBy: actorId, decision: 'APPROVED' });
  const configuration = await rejectAssistantConfigurationVersion({ database, tenantId, assistantId, versionId: '44444444-4444-4444-8444-444444444444', reviewedBy: actorId });
  assert.equal(recommendation.status, 'APPROVED');
  assert.equal(configuration.status, 'REJECTED');
});
