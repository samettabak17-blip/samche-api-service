import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generateBusinessProfileVersion } from '../services/knowledge-profile-lifecycle.js';

const { Pool } = pg;
const HASH_A = 'a'.repeat(64);

function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required; this PostgreSQL contract must not be skipped');
  return new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : undefined });
}

async function fixture(pool, suffix = randomUUID()) {
  const tenantId = randomUUID(); const userId = randomUUID(); const identityId = randomUUID(); const sourceId = randomUUID();
  await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, $2)`, [tenantId, `Generation test ${suffix}`]);
  await pool.query(`INSERT INTO users (id, email, password_hash, system_role) VALUES ($1, $2, 'test-only', 'CUSTOMER')`, [userId, `generation-${suffix}@example.test`]);
  await pool.query(`INSERT INTO business_identities (id, tenant_id, display_name, normalized_identity) VALUES ($1,$2,'Scope Test LLC','scope test')`, [identityId, tenantId]);
  await pool.query(`INSERT INTO knowledge_base_documents (id, tenant_id, title, content, status, content_hash, processing_status, indexing_status, enabled)
    VALUES ($1,$2,'Scope document','Scope Test LLC provides approved support services.','active',$3,'READY','READY',TRUE)`, [sourceId, tenantId, HASH_A]);
  return { tenantId, userId, identityId, sourceId };
}

function provider({ failIdentity = false, failProfileOnce = false, delayProfile = null } = {}) {
  let identityCalls = 0; let profileCalls = 0;
  return {
    provider: 'GEMINI', model: 'gemini-3-flash-preview', counts: () => ({ identityCalls, profileCalls }),
    generateBusinessIdentityAnalysis: async () => {
      identityCalls += 1;
      if (failIdentity) throw Object.assign(new Error('timeout'), { code: 'KNOWLEDGE_GENERATION_TIMEOUT' });
      return { detected_identity: 'Scope Test LLC', confidence: '0.99', evidence: 'Source legal name' };
    },
    generateBusinessProfile: async () => {
      profileCalls += 1;
      if (delayProfile) await delayProfile();
      if (failProfileOnce && profileCalls === 1) throw Object.assign(new Error('timeout'), { code: 'KNOWLEDGE_GENERATION_TIMEOUT' });
      return { schema_version: 2, company_identity: 'Scope Test LLC', company_summary: 'Approved support services.' };
    },
  };
}

const request = (pool, f, generationProvider) => generateBusinessProfileVersion({ database: pool, provider: generationProvider, tenantId: f.tenantId, requestedBy: f.userId, businessIdentityId: f.identityId, sourceIds: [f.sourceId] });

test('real PostgreSQL persists one atomic scoped profile and reuses exact successful retries', async () => {
  const pool = database();
  try {
    const f = await fixture(pool); const generationProvider = provider();
    const first = await request(pool, f, generationProvider); const retry = await request(pool, f, generationProvider);
    assert.equal(first.reused, false); assert.equal(retry.reused, true); assert.equal(retry.profile.id, first.profile.id); assert.equal(retry.run_id, first.run_id); assert.deepEqual(generationProvider.counts(), { identityCalls: 1, profileCalls: 1 });
    const evidence = await pool.query(`SELECT status, stage, source_count, prompt_character_count, elapsed_ms, input_provenance, request_fingerprint FROM knowledge_generation_runs WHERE tenant_id=$1 ORDER BY created_at`, [f.tenantId]);
    assert.equal(evidence.rowCount, 1); assert.equal(evidence.rows[0].status, 'SUCCEEDED'); assert.equal(evidence.rows[0].stage, 'PERSISTENCE');
    assert.equal(evidence.rows[0].source_count, 1); assert.ok(evidence.rows[0].prompt_character_count > 0); assert.ok(evidence.rows[0].elapsed_ms >= 0);
    assert.deepEqual(evidence.rows[0].input_provenance.source_ids, [f.sourceId]);
    assert.deepEqual(evidence.rows[0].input_provenance.source_hashes, [{ id: f.sourceId, content_hash: HASH_A }]);
    assert.match(evidence.rows[0].request_fingerprint, /^[a-f0-9]{64}$/);
  } finally { await pool.end(); }
});

test('real PostgreSQL serializes parallel exact requests without duplicate versions', async () => {
  const pool = database();
  try {
    const f = await fixture(pool); let release; const barrier = new Promise((resolve) => { release = resolve; });
    const generationProvider = provider({ delayProfile: () => barrier });
    const first = request(pool, f, generationProvider); await new Promise((resolve) => setTimeout(resolve, 100)); const second = request(pool, f, generationProvider); release();
    const [a, b] = await Promise.all([first, second]); assert.equal(a.profile.id, b.profile.id); assert.equal(Number(a.reused) + Number(b.reused), 1); assert.equal(generationProvider.counts().profileCalls, 1);
    const versions = await pool.query(`SELECT count(*)::integer AS count FROM business_profile_versions WHERE tenant_id=$1`, [f.tenantId]); assert.equal(versions.rows[0].count, 1);
  } finally { await pool.end(); }
});

test('real PostgreSQL classifies identity and profile timeouts without partial artifacts and permits failed retry', async () => {
  const pool = database();
  try {
    const identityFixture = await fixture(pool);
    await assert.rejects(request(pool, identityFixture, provider({ failIdentity: true })), (error) => error.code === 'KNOWLEDGE_GENERATION_TIMEOUT');
    let run = await pool.query(`SELECT status, stage, error_code FROM knowledge_generation_runs WHERE tenant_id=$1`, [identityFixture.tenantId]);
    assert.deepEqual(run.rows[0], { status: 'FAILED', stage: 'IDENTITY_ANALYSIS', error_code: 'KNOWLEDGE_GENERATION_TIMEOUT' });
    const profileFixture = await fixture(pool); const retryProvider = provider({ failProfileOnce: true });
    await assert.rejects(request(pool, profileFixture, retryProvider), (error) => error.code === 'KNOWLEDGE_GENERATION_TIMEOUT');
    let artifacts = await pool.query(`SELECT count(*)::integer AS count FROM business_profile_versions WHERE tenant_id=$1`, [profileFixture.tenantId]); assert.equal(artifacts.rows[0].count, 0);
    run = await pool.query(`SELECT status, stage, error_code FROM knowledge_generation_runs WHERE tenant_id=$1 ORDER BY created_at`, [profileFixture.tenantId]);
    assert.deepEqual(run.rows[0], { status: 'FAILED', stage: 'PROFILE_GENERATION', error_code: 'KNOWLEDGE_GENERATION_TIMEOUT' });
    const recovered = await request(pool, profileFixture, retryProvider); assert.equal(recovered.profile.status, 'NEEDS_REVIEW'); assert.equal(recovered.reused, false);
    artifacts = await pool.query(`SELECT count(*)::integer AS count FROM business_profile_versions WHERE tenant_id=$1`, [profileFixture.tenantId]); assert.equal(artifacts.rows[0].count, 1);
  } finally { await pool.end(); }
});

test('real PostgreSQL rolls back profile persistence as one unit and leaves the attempt FAILED', async () => {
  const pool = database();
  try {
    const f = await fixture(pool);
    const wrapped = { query: pool.query.bind(pool), connect: async () => { const client = await pool.connect(); return { query: async (sql, params) => {
      if (/INSERT INTO business_profile_versions/i.test(sql)) throw Object.assign(new Error('injected persistence failure'), { code: 'TEST_PERSISTENCE_FAILURE' });
      return client.query(sql, params);
    }, release: () => client.release() }; } };
    await assert.rejects(generateBusinessProfileVersion({ database: wrapped, provider: provider(), tenantId: f.tenantId, requestedBy: f.userId, businessIdentityId: f.identityId, sourceIds: [f.sourceId] }));
    const profiles = await pool.query(`SELECT count(*)::integer AS count FROM business_profiles WHERE tenant_id=$1`, [f.tenantId]);
    const links = await pool.query(`SELECT count(*)::integer AS count FROM knowledge_source_business_identities WHERE tenant_id=$1`, [f.tenantId]);
    const versions = await pool.query(`SELECT count(*)::integer AS count FROM business_profile_versions WHERE tenant_id=$1`, [f.tenantId]);
    assert.equal(profiles.rows[0].count, 0); assert.equal(links.rows[0].count, 0); assert.equal(versions.rows[0].count, 0);
    const run = await pool.query(`SELECT status, stage, error_code FROM knowledge_generation_runs WHERE tenant_id=$1`, [f.tenantId]);
    assert.deepEqual(run.rows[0], { status: 'FAILED', stage: 'PERSISTENCE', error_code: 'TEST_PERSISTENCE_FAILURE' });
  } finally { await pool.end(); }
});

test('real PostgreSQL rejects a selected source from another tenant before creating an attempt', async () => {
  const pool = database();
  try {
    const tenantA = await fixture(pool); const tenantB = await fixture(pool);
    await assert.rejects(generateBusinessProfileVersion({ database: pool, provider: provider(), tenantId: tenantA.tenantId, requestedBy: tenantA.userId, businessIdentityId: tenantA.identityId, sourceIds: [tenantB.sourceId] }), (error) => error.code === 'KNOWLEDGE_PROFILE_SOURCE_SCOPE_INVALID');
    const runs = await pool.query(`SELECT count(*)::integer AS count FROM knowledge_generation_runs WHERE tenant_id=$1`, [tenantA.tenantId]); assert.equal(runs.rows[0].count, 0);
  } finally { await pool.end(); }
});
