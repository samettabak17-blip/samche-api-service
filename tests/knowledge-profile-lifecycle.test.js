import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeBusinessProfileSourceScope, generateBusinessProfileVersion, rejectBusinessProfileVersion, updateBusinessProfileReview } from '../services/knowledge-profile-lifecycle.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('identity provenance follows approved candidate evidence when the original source is selected', async () => {
  const source = await readFile(new URL('../services/knowledge-profile-lifecycle.js', import.meta.url), 'utf8');
  assert.match(source, /candidate\.approved_source_id\s*=\s*source\.id\s+OR\s+image_evidence\.source_id\s*=\s*source\.id/i);
});

test('resolves a canonical fact through its trusted source identity even when its text omits the company name', async () => {
  let providerCalls = 0;
  const businessIdentityId = '55555555-5555-4555-8555-555555555555';
  const candidateSourceId = '11111111-1111-4111-8111-111111111111';
  const database = { query: async (sql) => {
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: businessIdentityId, display_name: 'Meridian Arc Technologies LLC', normalized_identity: 'meridian arc technologies' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: candidateSourceId, title: 'Approved event services fact', content: 'Corporate events and gala dinners are available.', content_hash: 'a'.repeat(64), trusted_identity_ids: [businessIdentityId] }] };
    if (/FROM business_identity_source_evidence/i.test(sql)) return { rows: [] };
    throw new Error(`unexpected SQL ${sql}`);
  } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => { providerCalls += 1; return { detected_identity: 'unknown', confidence: 0, evidence: '' }; } };

  const result = await analyzeBusinessProfileSourceScope({ database, provider, tenantId, businessIdentityId, sourceIds: [candidateSourceId] });

  assert.equal(result.status, 'RESOLVED');
  assert.equal(providerCalls, 0);
  assert.equal(result.evidence[0].resolution_origin, 'PROVENANCE_INHERITED');
  assert.equal(result.evidence[0].detected_identity, 'Meridian Arc Technologies LLC');
});

test('does not inherit a Business Identity from tenant scope when canonical provenance is absent or conflicts', async () => {
  const businessIdentityId = '55555555-5555-4555-8555-555555555555';
  const otherIdentityId = '66666666-6666-4666-8666-666666666666';
  let providerCalls = 0;
  const database = { query: async (sql) => {
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: businessIdentityId, display_name: 'Meridian Arc Technologies LLC', normalized_identity: 'meridian arc technologies' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Ambiguous fact', content: 'Service information.', content_hash: 'a'.repeat(64), trusted_identity_ids: [otherIdentityId] }] };
    throw new Error(`unexpected SQL ${sql}`);
  } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => { providerCalls += 1; return { detected_identity: 'Meridian Arc Technologies LLC', confidence: 0.99, evidence: 'text only' }; } };

  const result = await analyzeBusinessProfileSourceScope({ database, provider, tenantId, businessIdentityId, sourceIds: ['11111111-1111-4111-8111-111111111111'] });

  assert.equal(result.status, 'IDENTITY_RESOLUTION_REQUIRED');
  assert.equal(providerCalls, 0);
  assert.equal(result.evidence[0].resolution_origin, 'CONFLICTING_PROVENANCE');
});

test('reports a missing explicit source assignment for canonical image facts instead of weakening provenance with text inference', async () => {
  const businessIdentityId = '55555555-5555-4555-8555-555555555555';
  let providerCalls = 0;
  const database = { query: async (sql) => {
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: businessIdentityId, display_name: 'Meridian Arc Technologies LLC', normalized_identity: 'meridian arc technologies' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Canonical image fact', content: 'Corporate events are available.', content_hash: 'a'.repeat(64), source_type: 'CONVERSATION_CANDIDATE', mime_type: 'text/plain', trusted_identity_ids: [] }] };
    throw new Error(`unexpected SQL ${sql}`);
  } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => { providerCalls += 1; return { detected_identity: 'Meridian Arc Technologies LLC', confidence: 1, evidence: 'text only' }; } };
  const result = await analyzeBusinessProfileSourceScope({ database, provider, tenantId, businessIdentityId, sourceIds: ['11111111-1111-4111-8111-111111111111'] });
  assert.equal(result.status, 'IDENTITY_RESOLUTION_REQUIRED');
  assert.equal(providerCalls, 0);
  assert.equal(result.evidence[0].resolution_origin, 'MISSING_SOURCE_ASSIGNMENT');
  assert.match(result.evidence[0].safe_evidence, /has not been assigned/i);
});

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
  const result = await generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId, sourceIds });
  assert.match(calls.find(({ sql }) => /FROM knowledge_base_documents/.test(sql)).sql, /ANY\(\$2::uuid\[\]\)/);

  assert.equal(result.reused, false);
  assert.equal(result.run_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.profile.status, 'NEEDS_REVIEW');
  assert.notEqual(result.profile.active_version_id, result.profile.id);
  assert.match(prompts[0], /Approved company facts/);
  assert.match(prompts[0], /current tenant approved knowledge only/i);
  assert.match(prompts[0], /Never use SamChe.*as a default/i);
  assert.match(prompts[0], /unknown/i);
  assert.ok(calls.some(({ sql }) => /id = ANY\(\$2::uuid\[\]\)[\s\S]*enabled = TRUE[\s\S]*processing_status = 'READY'/i.test(sql)));
  const insert = calls.find(({ sql }) => /INSERT INTO business_profile_versions/i.test(sql));
  assert.equal(insert.params[4], '22222222-2222-4222-8222-222222222222');
  assert.equal(insert.params[5], 2);
  assert.equal(insert.params[6], 'RESOLVED');
  assert.deepEqual(insert.params[7].source_ids, sourceIds);
});

test('returns the exact successful generation as a reused result with its run id', async () => {
  const database = { query: async (sql) => {
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Meridian Arc Technologies LLC', normalized_identity: 'meridian arc technologies' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Company', content: 'Approved company facts', content_hash: 'a'.repeat(64) }] };
    if (/FROM knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', profile_id: '33333333-3333-4333-8333-333333333333', status: 'NEEDS_REVIEW', active_version_id: null, created_at: '2026-08-29T00:00:00.000Z', run_id: '22222222-2222-4222-8222-222222222222' }] };
    assert.fail(`unexpected SQL ${sql}`);
  } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => assert.fail('must reuse'), generateBusinessProfile: async () => assert.fail('must reuse') };
  const result = await generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId: '55555555-5555-4555-8555-555555555555', sourceIds: ['11111111-1111-4111-8111-111111111111'] });
  assert.equal(result.reused, true);
  assert.equal(result.run_id, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.profile.id, '44444444-4444-4444-8444-444444444444');
  assert.equal(result.profile.status, 'NEEDS_REVIEW');
  assert.equal(result.profile.active_version_id, null);
  assert.equal(result.profile.run_id, undefined);
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
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'FAILED' }] };
    if (/FROM knowledge_generation_runs/i.test(sql)) return { rows: [] };
    assert.fail(`unexpected SQL ${sql}`);
  } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async ({ source }) => ({ detected_identity: source.title, confidence: '0.99', evidence: 'Legal name' }), generateBusinessProfile: async () => assert.fail('must not generate') };
  await assert.rejects(generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId: '55555555-5555-4555-8555-555555555555', sourceIds: ['11111111-1111-4111-8111-111111111111', '66666666-6666-4666-8666-666666666666'] }), (error) => error.code === 'IDENTITY_RESOLUTION_REQUIRED' && error.details.identities.length === 2);
});

test('a selected source identity must match the chosen Business Identity', async () => {
  const database = { query: async (sql) => {
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Meridian Arc Technologies LLC', normalized_identity: 'meridian arc technologies' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '66666666-6666-4666-8666-666666666666', title: 'Nova', content: 'Nova Crest Business Services LLC', content_hash: 'b'.repeat(64) }] };
    if (/business_identity_source_evidence/i.test(sql)) return { rows: [] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'FAILED' }] };
    if (/FROM knowledge_generation_runs/i.test(sql)) return { rows: [] };
    assert.fail(`unexpected SQL ${sql}`);
  } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => ({ detected_identity: 'Nova Crest Business Services LLC', confidence: '0.99', evidence: 'Legal name' }), generateBusinessProfile: async () => assert.fail('must not generate') };
  await assert.rejects(generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId: '55555555-5555-4555-8555-555555555555', sourceIds: ['66666666-6666-4666-8666-666666666666'] }), (error) => error.code === 'IDENTITY_RESOLUTION_REQUIRED');
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

test('reuses exact RESOLVED identity evidence and does not call the identity provider twice', async () => {
  const calls = [];
  let identityCalls = 0;
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Meridian Arc Technologies LLC', normalized_identity: 'meridian arc technologies' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Company', content: 'Approved company facts', content_hash: 'a'.repeat(64) }] };
    if (/FROM business_identity_source_evidence/i.test(sql)) return { rows: [{ source_id: '11111111-1111-4111-8111-111111111111', source_title: 'Company', content_hash: 'a'.repeat(64), detected_identity: 'Meridian Arc Technologies LLC', normalized_identity: 'meridian arc technologies', confidence: '0.990', safe_evidence: 'Legal name' }] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/UPDATE knowledge_generation_runs[\s\S]*stage =/i.test(sql)) return { rows: [{ id: params[0], status: 'RUNNING' }] };
    if (/INSERT INTO business_profiles/i.test(sql)) return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] };
    if (/INSERT INTO knowledge_source_business_identities/i.test(sql)) return { rows: [] };
    if (/INSERT INTO business_profile_versions/i.test(sql)) return { rows: [{ id: '44444444-4444-4444-8444-444444444444', status: 'NEEDS_REVIEW' }] };
    if (/UPDATE knowledge_generation_runs[\s\S]*SUCCEEDED/i.test(sql)) return { rows: [{ id: params[0], status: 'SUCCEEDED', target_id: params[2] }] };
    return { rows: [] };
  } };
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => { identityCalls += 1; return {}; }, generateBusinessProfile: async () => ({ schema_version: 2, company_identity: 'Meridian Arc Technologies LLC' }) };
  await generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId: '55555555-5555-4555-8555-555555555555', sourceIds: ['11111111-1111-4111-8111-111111111111'] });
  assert.equal(identityCalls, 0);
  assert.ok(calls.some(({ sql }) => /analysis_schema_version/i.test(sql) && /content_hash/i.test(sql)));
});

test('identity analysis timeout is classified before profile generation and persists no profile artifact', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Meridian', normalized_identity: 'meridian' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Company', content: 'Facts', content_hash: 'a'.repeat(64) }] };
    if (/FROM business_identity_source_evidence/i.test(sql)) return { rows: [] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: 'FAILED' }] };
    return { rows: [] };
  } };
  const timeout = Object.assign(new Error('Knowledge generation timed out'), { code: 'KNOWLEDGE_GENERATION_TIMEOUT' });
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => { throw timeout; }, generateBusinessProfile: async () => assert.fail('profile generation must not start') };
  await assert.rejects(generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId: '55555555-5555-4555-8555-555555555555', sourceIds: ['11111111-1111-4111-8111-111111111111'] }), (error) => error.code === 'KNOWLEDGE_GENERATION_TIMEOUT');
  assert.ok(calls.some(({ sql, params }) => /status = 'FAILED'/i.test(sql) && params.includes('IDENTITY_ANALYSIS')));
  assert.ok(!calls.some(({ sql }) => /INSERT INTO business_profiles|INSERT INTO business_profile_versions/i.test(sql)));
});

test('profile generation timeout records PROFILE_GENERATION and leaves no profile artifact', async () => {
  const calls = [];
  const database = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM business_identities/i.test(sql)) return { rows: [{ id: '55555555-5555-4555-8555-555555555555', display_name: 'Meridian', normalized_identity: 'meridian' }] };
    if (/FROM knowledge_base_documents/i.test(sql)) return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Company', content: 'Facts', content_hash: 'a'.repeat(64) }] };
    if (/FROM business_identity_source_evidence/i.test(sql)) return { rows: [{ source_id: '11111111-1111-4111-8111-111111111111', source_title: 'Company', content_hash: 'a'.repeat(64), detected_identity: 'Meridian', normalized_identity: 'meridian', confidence: '0.99', safe_evidence: 'Legal name' }] };
    if (/INSERT INTO knowledge_generation_runs/i.test(sql)) return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'RUNNING' }] };
    if (/UPDATE knowledge_generation_runs/i.test(sql)) return { rows: [{ id: params[0], status: /FAILED/.test(sql) ? 'FAILED' : 'RUNNING' }] };
    return { rows: [] };
  } };
  const timeout = Object.assign(new Error('Knowledge generation timed out'), { code: 'KNOWLEDGE_GENERATION_TIMEOUT' });
  const provider = { provider: 'GEMINI', model: 'gemini-3-flash-preview', generateBusinessIdentityAnalysis: async () => assert.fail('exact evidence must be reused'), generateBusinessProfile: async () => { throw timeout; } };
  await assert.rejects(generateBusinessProfileVersion({ database, provider, tenantId, requestedBy: actorId, businessIdentityId: '55555555-5555-4555-8555-555555555555', sourceIds: ['11111111-1111-4111-8111-111111111111'] }), (error) => error.code === 'KNOWLEDGE_GENERATION_TIMEOUT');
  assert.ok(calls.some(({ sql, params }) => /status = 'FAILED'/i.test(sql) && params.includes('PROFILE_GENERATION')));
  assert.ok(!calls.some(({ sql }) => /INSERT INTO business_profiles|INSERT INTO business_profile_versions/i.test(sql)));
});
