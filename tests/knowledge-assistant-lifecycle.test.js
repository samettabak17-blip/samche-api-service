import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAssistantRecommendation,
  prepareAssistantRecommendationGeneration,
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
    if (/FROM ai_assistants assistant/i.test(sql)) return { rows: [{ assistant_name: 'SamChe AI', profile_version_id: '11111111-1111-4111-8111-111111111111', business_identity_id: '55555555-5555-4555-8555-555555555555', source_scope: { source_ids: ['source-meridian'] }, profile_data: { company_summary: 'Facts' } }] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/INSERT INTO assistant_knowledge_recommendations/i.test(sql)) return { rows: [{ id: '33333333-3333-4333-8333-333333333333', status: 'NEEDS_REVIEW' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: 'SUCCEEDED' }] };
    return { rows: [] };
  } };

  const result = await generateAssistantRecommendation({ database, provider: provider({ schema_version: 2, tone: 'Professional' }), tenantId, assistantId, businessProfileVersionId: '11111111-1111-4111-8111-111111111111', requestedBy: actorId });

  assert.equal(result.reused, false);
  assert.equal(result.run_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.recommendation.status, 'NEEDS_REVIEW');
  assert.match(calls.find(({ sql }) => /INSERT INTO knowledge_generation_runs/i.test(sql)).params[8], /^[a-f0-9]{64}$/);
  assert.ok(calls.some(({ sql, params }) => /UPDATE knowledge_generation_runs/i.test(sql) && params.includes('RECOMMENDATION_GENERATION')));
  assert.ok(calls.some(({ sql }) => /^BEGIN$/i.test(sql.trim())));
  assert.ok(calls.some(({ sql }) => /^COMMIT$/i.test(sql.trim())));
  assert.ok(calls.some(({ sql }) => /profile\.active_version_id[\s\S]*profile_version\.status = 'APPROVED'/i.test(sql)));
  assert.ok(calls.some(({ sql }) => /profile_version\.id = \$3/i.test(sql)));
  const insert = calls.find(({ sql }) => /INSERT INTO assistant_knowledge_recommendations/i.test(sql));
  assert.equal(insert.params[2].schema_version, 2);
  assert.match(insert.params[2].captured_prompt, /current tenant/i);
  assert.match(insert.params[2].captured_prompt, /Never use SamChe.*as a default/i);
  assert.doesNotMatch(insert.params[2].captured_prompt, /Assistant display name:\s*SamChe AI/i);
  assert.match(insert.params[2].captured_prompt, /Return only 1 to 4 directly supported recommendation fields; omit every unsupported field/i);
  assert.equal(insert.params[5], 2);
  assert.equal(insert.params[3].business_identity_id, '55555555-5555-4555-8555-555555555555');
  assert.deepEqual(insert.params[3].source_scope.source_ids, ['source-meridian']);
});

test('a queued recommendation retains its approved profile-version snapshot when the active profile changes', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM ai_assistants assistant/i.test(sql)) return { rows: [{ assistant_name: 'Sales', profile_version_id: '11111111-1111-4111-8111-111111111111', business_identity_id: '55555555-5555-4555-8555-555555555555', source_scope: { source_ids: ['source-a'] }, evidence: { source_hashes: ['hash-a'] }, profile_data: { company_identity: 'Tenant Co' } }] };
    return { rows: [] };
  } };
  const prepared = await prepareAssistantRecommendationGeneration({
    database, provider: provider({}), tenantId, assistantId,
    businessProfileVersionId: '11111111-1111-4111-8111-111111111111', requestedBy: actorId,
    allowInactiveProfileSnapshot: true,
  });
  assert.match(prepared.fingerprint, /^[a-f0-9]{64}$/);
  const context = calls.find(({ sql }) => /FROM ai_assistants assistant/i.test(sql));
  assert.doesNotMatch(context.sql, /profile\.active_version_id = \$3/i);
  assert.match(context.sql, /profile_version\.id = \$3/i);
});

test('generates a review-only configuration from an approved recommendation', async () => {
  const calls = [];
  const recommendationId = '33333333-3333-4333-8333-333333333333';
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM assistant_knowledge_recommendations recommendation/i.test(sql)) return { rows: [{ recommendation_data: { assistant_identity: 'SamChe AI', tone: 'Professional' }, assistant_name: 'SamChe AI', profile_version_id: '11111111-1111-4111-8111-111111111111', business_identity_id: '55555555-5555-4555-8555-555555555555', source_scope: { source_ids: ['source-meridian'] }, profile_data: { company_identity: 'Northstar Labs Ltd', company_summary: 'Facts' } }] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/INSERT INTO assistant_configuration_versions/i.test(sql)) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', schema_version: 2, configuration_data: params[2], source_profile_version_id: '11111111-1111-4111-8111-111111111111', source_recommendation_id: recommendationId, status: 'NEEDS_REVIEW' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: 'SUCCEEDED' }] };
    return { rows: [] };
  } };

  const result = await generateAssistantConfigurationVersion({ database, provider: provider({ schema_version: 2, assistant_identity: 'SamChe AI', assistant_instructions: 'Use approved facts.' }), tenantId, assistantId, recommendationId, requestedBy: actorId });

  assert.equal(result.reused, false);
  assert.equal(result.run_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.configuration.status, 'NEEDS_REVIEW');
  assert.equal(result.configuration.configuration_data.assistant_instructions, 'Use approved facts.');
  assert.equal(result.configuration.configuration_data.assistant_identity, 'Northstar Labs Ltd');
  assert.equal(result.configuration.source_profile_version_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(result.configuration.source_recommendation_id, recommendationId);
  assert.ok(calls.some(({ sql, params }) => /UPDATE knowledge_generation_runs/i.test(sql) && params.includes('CONFIGURATION_GENERATION')));
  const insert = calls.find(({ sql }) => /INSERT INTO assistant_configuration_versions/i.test(sql));
  assert.equal(insert.params[4], recommendationId);
  assert.equal(insert.params[5], '22222222-2222-4222-8222-222222222222');
  assert.equal(insert.params[6], 2);
  assert.equal(insert.params[2].assistant_identity, 'Northstar Labs Ltd');
  assert.match(insert.sql, /RETURNING id, schema_version, configuration_data, source_profile_version_id, source_recommendation_id, status, created_at/i);
  assert.match(insert.params[2].captured_prompt, /factual profile/i);
  assert.match(insert.params[2].captured_prompt, /approved AI recommendation/i);
  const run = calls.find(({ sql }) => /INSERT INTO knowledge_generation_runs/i.test(sql));
  assert.equal(run.params[6].business_identity_id, '55555555-5555-4555-8555-555555555555');
  assert.deepEqual(run.params[6].source_scope.source_ids, ['source-meridian']);
  assert.match(calls.find(({ sql }) => /FROM assistant_knowledge_recommendations recommendation/i.test(sql)).sql, /profile\.active_version_id IS NOT NULL/i);
  assert.match(calls.find(({ sql }) => /FROM assistant_knowledge_recommendations recommendation/i.test(sql)).sql, /profile_version\.profile_id = profile\.id/i);
});

test('an approved assistant-scoped behavior recommendation uses the current active profile for configuration generation', async () => {
  const calls = [];
  const recommendationId = '33333333-3333-4333-8333-333333333333';
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM assistant_knowledge_recommendations recommendation/i.test(sql)) {
      if (/recommendation\.evidence->>'profile_version_id'/i.test(sql)) return { rows: [] };
      if (!/profile\.active_version_id IS NOT NULL/i.test(sql)) return { rows: [] };
      return { rows: [{ recommendation_data: { schema_version: 2, qualification_guidance: ['Ask for the budget range.'] }, assistant_name: 'Sales', profile_version_id: '11111111-1111-4111-8111-111111111111', business_identity_id: '55555555-5555-4555-8555-555555555555', source_scope: { source_ids: ['source-a'] }, profile_evidence: { source_hashes: ['hash-a'] }, profile_data: { company_identity: 'Tenant Co' } }] };
    }
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/INSERT INTO assistant_configuration_versions/i.test(sql)) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', status: 'NEEDS_REVIEW', configuration_data: params[2] }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: 'SUCCEEDED' }] };
    return { rows: [] };
  } };

  const result = await generateAssistantConfigurationVersion({ database, provider: provider({ schema_version: 2, assistant_identity: 'Tenant Co', assistant_instructions: 'Use approved qualification guidance.' }), tenantId, assistantId, recommendationId, requestedBy: actorId });

  assert.equal(result.configuration.status, 'NEEDS_REVIEW');
  assert.match(calls.find(({ sql }) => /FROM assistant_knowledge_recommendations recommendation/i.test(sql)).sql, /profile\.active_version_id IS NOT NULL/i);
});

test('review transitions remain explicit and tenant scoped', async () => {
  const database = { query: async (sql, params) => ({ rows: [{ id: params[0], status: /assistant_knowledge_recommendations/.test(sql) ? params[4] : 'REJECTED' }] }) };
  const recommendation = await reviewAssistantRecommendation({ database, tenantId, assistantId, recommendationId: '33333333-3333-4333-8333-333333333333', reviewedBy: actorId, decision: 'APPROVED' });
  const configuration = await rejectAssistantConfigurationVersion({ database, tenantId, assistantId, versionId: '44444444-4444-4444-8444-444444444444', reviewedBy: actorId });
  assert.equal(recommendation.status, 'APPROVED');
  assert.equal(configuration.status, 'REJECTED');
});

test('reuses the exact successful Recommendation without invoking the provider', async () => {
  let providerCalls = 0;
  const exactProvider = provider({ schema_version: 2 });
  exactProvider.generateAssistantRecommendation = async () => { providerCalls += 1; return {}; };
  const database = { query: async (sql) => {
    if (/FROM ai_assistants assistant/i.test(sql)) return { rows: [{ assistant_name: 'Sales', profile_version_id: '11111111-1111-4111-8111-111111111111', business_identity_id: '55555555-5555-4555-8555-555555555555', source_scope: { source_ids: [] }, evidence: { source_hashes: [] }, profile_data: {} }] };
    if (/JOIN assistant_knowledge_recommendations artifact/i.test(sql)) return { rows: [{ id: '33333333-3333-4333-8333-333333333333', status: 'NEEDS_REVIEW', run_id: '22222222-2222-4222-8222-222222222222' }] };
    return { rows: [] };
  } };
  const result = await generateAssistantRecommendation({ database, provider: exactProvider, tenantId, assistantId, businessProfileVersionId: '11111111-1111-4111-8111-111111111111', requestedBy: actorId });
  assert.equal(result.reused, true);
  assert.equal(result.recommendation.id, '33333333-3333-4333-8333-333333333333');
  assert.equal(providerCalls, 0);
});

test('classifies Recommendation timeout at provider stage and leaves no artifact', async () => {
  const calls = [];
  const timeout = Object.assign(new Error('timed out'), { code: 'KNOWLEDGE_GENERATION_TIMEOUT' });
  const timeoutProvider = provider({});
  timeoutProvider.generateAssistantRecommendation = async () => { throw timeout; };
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM ai_assistants assistant/i.test(sql)) return { rows: [{ assistant_name: 'Sales', profile_version_id: '11111111-1111-4111-8111-111111111111', business_identity_id: '55555555-5555-4555-8555-555555555555', source_scope: { source_ids: [] }, evidence: { source_hashes: [] }, profile_data: {} }] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: /FAILED/.test(sql) ? 'FAILED' : 'RUNNING' }] };
    return { rows: [] };
  } };
  await assert.rejects(() => generateAssistantRecommendation({ database, provider: timeoutProvider, tenantId, assistantId, businessProfileVersionId: '11111111-1111-4111-8111-111111111111', requestedBy: actorId }), (error) => error.code === 'KNOWLEDGE_GENERATION_TIMEOUT');
  assert.equal(calls.some(({ sql }) => /INSERT INTO assistant_knowledge_recommendations/i.test(sql)), false);
  const failed = calls.find(({ sql }) => /SET status = 'FAILED'/i.test(sql));
  assert.equal(failed.params[2], 'KNOWLEDGE_GENERATION_TIMEOUT');
  assert.equal(failed.params[3], 'RECOMMENDATION_GENERATION');
});
