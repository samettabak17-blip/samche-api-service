import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBusinessProfileVersion, rejectBusinessProfileVersion, updateBusinessProfileReview } from '../services/knowledge-profile-lifecycle.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('generates a review-only Business Profile from an explicit resolved source scope with exact provenance', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Meridian Arc Technologies LLC' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Company', content: 'Approved company facts', content_hash: 'a'.repeat(64) }] };
    if (/INSERT INTO business_identity_source_evidence/i.test(sql)) return { rows: [] };
    if (/INSERT INTO knowledge_source_business_identities/i.test(sql)) return { rows: [] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/INSERT INTO business_profiles/i.test(sql)) return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] };
    if (/INSERT INTO business_profile_versions/i.test(sql)) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', status: 'NEEDS_REVIEW' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: 'SUCCEEDED', target_id: params[2] }] };
    return { rows: [] };
  } };
  const prompts = [];
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => ({ detected_identity: 'Meridian Arc Technologies LLC', confidence: '0.99', evidence: 'Legal company name' }), generateBusinessProfile: async ({ prompt }) => {
    prompts.push(prompt);
    return { company_summary: 'Approved summary' };
  } };

  const businessIdentityId = '55555555-5555-4555-8555-555555555555';
  const sourceIds = ['11111111-1111-4111-8111-111111111111'];
  const version = await generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId, sourceIds });

  assert.equal(version.status, 'NEEDS_REVIEW');
  assert.match(prompts[0], /Approved company facts/);
  assert.match(prompts[0], /current tenant approved knowledge only/i);
  assert.match(prompts[0], /Never use SamChe.*as a default/i);
  assert.match(prompts[0], /unknown/i);
  assert.ok(calls.some(({ sql }) => /id = ANY\(\$3::uuid\[\]\)[\s\S]*enabled = TRUE[\s\S]*processing_status = 'READY'/i.test(sql)));
  const insert = calls.find(({ sql }) => /INSERT INTO business_profile_versions/i.test(sql));
  assert.equal(insert.params[4], '22222222-2222-4222-8222-222222222222');
  assert.equal(insert.params[5], 2);
  assert.equal(insert.params[6], 'RESOLVED');
  assert.deepEqual(insert.params[7].source_ids, sourceIds);
});

test('rejects cross-tenant or ineligible selected source sets before provider generation', async () => {
  const database = { query: async (sql) => /FROM business_identities/i.test(sql) ? { rows: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Meridian' }] } : { rows: [] } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => assert.fail('must not analyze'), generateBusinessProfile: async () => assert.fail('must not generate') };
  await assert.rejects(generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId: '55555555-5555-4555-8555-555555555555', sourceIds: ['11111111-1111-4111-8111-111111111111'] }), (error) => error.code === 'KNOWLEDGE_PROFILE_SOURCE_SCOPE_INVALID');
});

test('conflicting selected identities block profile generation and expose safe conflict details', async () => {
  const database = { query: async (sql) => {
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Meridian' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [
      { id: '11111111-1111-4111-8111-111111111111', title: 'Meridian', content: 'Meridian', content_hash: 'a'.repeat(64) },
      { id: '66666666-6666-4666-8666-666666666666', title: 'Nova', content: 'Nova', content_hash: 'b'.repeat(64) },
    ] };
    if (/business_identity_source_evidence|knowledge_source_business_identities/i.test(sql)) return { rows: [] };
    assert.fail(`unexpected SQL ${sql}`);
  } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async ({ source }) => ({ detected_identity: source.title, confidence: '0.99', evidence: 'Legal name' }), generateBusinessProfile: async () => assert.fail('must not generate') };
  await assert.rejects(generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId: '55555555-5555-4555-8555-555555555555', sourceIds: ['11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666666'] }), (error) => error.code === 'IDENTITY_RESOLUTION_REQUIRED' && error.details.identities.length === 2);
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
