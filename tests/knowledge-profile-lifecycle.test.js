import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBusinessProfileVersion, rejectBusinessProfileVersion, updateBusinessProfileReview } from '../services/knowledge-profile-lifecycle.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('generates a review-only Business Profile from ready tenant sources with provenance', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Company', content: 'Approved company facts', content_hash: 'a'.repeat(64) }] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/INSERT INTO business_profiles/i.test(sql)) return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] };
    if (/INSERT INTO business_profile_versions/i.test(sql)) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', status: 'NEEDS_REVIEW' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: 'SUCCEEDED', target_id: params[2] }] };
    return { rows: [] };
  } };
  const prompts = [];
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessProfile: async ({ prompt }) => {
    prompts.push(prompt);
    return { company_summary: 'Approved summary' };
  } };

  const version = await generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId });

  assert.equal(version.status, 'NEEDS_REVIEW');
  assert.match(prompts[0], /Approved company facts/);
  assert.ok(calls.some(({ sql }) => /enabled = TRUE[\s\S]*processing_status = 'READY'/i.test(sql)));
  const insert = calls.find(({ sql }) => /INSERT INTO business_profile_versions/i.test(sql));
  assert.equal(insert.params[4], '22222222-2222-4222-8222-222222222222');
});

test('rejects only a reviewable tenant Business Profile version', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[0], status: 'REJECTED' }] };
  } };
  const result = await rejectBusinessProfileVersion({ database, tenantId, versionId: '44444444-4444-4444-8444-444444444444', reviewedBy: actorId });
  assert.equal(result.status, 'REJECTED');
  assert.match(calls[0].sql, /status IN \('DRAFT', 'NEEDS_REVIEW'\)/i);
  assert.deepEqual(calls[0].params, ['44444444-4444-4444-8444-444444444444', tenantId, actorId]);
});

test('edits only NEEDS_REVIEW Business Profile data without changing lifecycle status', async () => {
  const calls = [];
  const database = { query: async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: params[0], status: 'NEEDS_REVIEW', profile_data: params[2] }] };
  } };
  const profileData = { company_summary: 'Reviewed staging summary' };
  const result = await updateBusinessProfileReview({ database, tenantId, versionId: '44444444-4444-4444-8444-444444444444', profileData });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.match(calls[0].sql, /status = 'NEEDS_REVIEW'/i);
  assert.deepEqual(calls[0].params, ['44444444-4444-4444-8444-444444444444', tenantId, profileData]);
});

test('rejects an empty Business Profile review edit before querying', async () => {
  const database = { query: async () => assert.fail('must not query') };
  await assert.rejects(
    updateBusinessProfileReview({ database, tenantId, versionId: '44444444-4444-4444-8444-444444444444', profileData: {} }),
    (error) => error.code === 'KNOWLEDGE_PROFILE_DATA_INVALID',
  );
});
