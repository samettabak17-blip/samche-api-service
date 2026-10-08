import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { generateAssistantConfigurationVersion, generateAssistantRecommendation, reviewAssistantRecommendation } from '../services/knowledge-assistant-lifecycle.js';

const { Pool } = pg;
const HASH = 'b'.repeat(64);

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; this PostgreSQL contract must not be skipped');
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: resolvePostgresSsl({ connectionString: process.env.DATABASE_URL }),
  });
}

async function fixture(pool) {
  const tenantId = randomUUID(); const userId = randomUUID(); const identityId = randomUUID(); const assistantId = randomUUID(); const profileId = randomUUID(); const versionId = randomUUID(); const sourceId = randomUUID();
  await pool.query(`INSERT INTO tenants (id,name,plan_code) VALUES ($1,'Assistant generation contract','STARTER')`, [tenantId]);
  await pool.query(`INSERT INTO users (id,email,email_normalized,password_hash,system_role) VALUES ($1,$2,$2,'test-only','CUSTOMER')`, [userId, `assistant-generation-${randomUUID()}@example.test`]);
  await pool.query(`INSERT INTO business_identities (id,tenant_id,display_name,normalized_identity) VALUES ($1,$2,'Scope Test LLC','scope test')`, [identityId, tenantId]);
  await pool.query(`INSERT INTO ai_assistants (id,tenant_id,name,status) VALUES ($1,$2,'Scope Assistant','active')`, [assistantId, tenantId]);
  await pool.query(`INSERT INTO business_profiles (id,tenant_id,business_identity_id) VALUES ($1,$2,$3)`, [profileId, tenantId, identityId]);
  await pool.query(`INSERT INTO business_profile_versions
    (id,tenant_id,profile_id,profile_data,evidence,status,schema_version,identity_resolution_status,source_scope)
    VALUES ($1,$2,$3,$4,$5,'APPROVED',2,'RESOLVED',$6)`, [versionId, tenantId, profileId, { company_identity: 'Scope Test LLC' }, { source_hashes: [{ id: sourceId, content_hash: HASH }] }, { business_identity_id: identityId, source_ids: [sourceId] }]);
  await pool.query(`UPDATE business_profiles SET active_version_id=$1 WHERE id=$2 AND tenant_id=$3`, [versionId, profileId, tenantId]);
  return { tenantId, userId, identityId, assistantId, versionId };
}

const provider = {
  provider: 'GEMINI', model: 'gemini-3-flash-preview',
  generateAssistantRecommendation: async () => ({ schema_version: 2, tone: 'Professional' }),
  generateAssistantConfiguration: async () => ({ schema_version: 2, assistant_identity: 'Scope Assistant' }),
};

test('real PostgreSQL atomically reuses exact Recommendation and Configuration generations', async () => {
  const pool = database();
  try {
    const f = await fixture(pool);
    const recommendation = await generateAssistantRecommendation({ database: pool, provider, tenantId: f.tenantId, assistantId: f.assistantId, businessProfileVersionId: f.versionId, requestedBy: f.userId });
    const recommendationRetry = await generateAssistantRecommendation({ database: pool, provider, tenantId: f.tenantId, assistantId: f.assistantId, businessProfileVersionId: f.versionId, requestedBy: f.userId });
    assert.equal(recommendation.reused, false); assert.equal(recommendationRetry.reused, true); assert.equal(recommendationRetry.recommendation.id, recommendation.recommendation.id);
    assert.equal(recommendation.recommendation.status, 'NEEDS_REVIEW');
    await reviewAssistantRecommendation({ database: pool, tenantId: f.tenantId, assistantId: f.assistantId, recommendationId: recommendation.recommendation.id, reviewedBy: f.userId, decision: 'APPROVED' });
    const configuration = await generateAssistantConfigurationVersion({ database: pool, provider, tenantId: f.tenantId, assistantId: f.assistantId, recommendationId: recommendation.recommendation.id, requestedBy: f.userId });
    const configurationRetry = await generateAssistantConfigurationVersion({ database: pool, provider, tenantId: f.tenantId, assistantId: f.assistantId, recommendationId: recommendation.recommendation.id, requestedBy: f.userId });
    assert.equal(configuration.reused, false); assert.equal(configurationRetry.reused, true); assert.equal(configurationRetry.configuration.id, configuration.configuration.id);
    assert.equal(configuration.configuration.status, 'NEEDS_REVIEW');
    const persisted = await pool.query(`SELECT target_type,status,stage,target_id,request_fingerprint FROM knowledge_generation_runs WHERE tenant_id=$1 ORDER BY target_type`, [f.tenantId]);
    assert.equal(persisted.rowCount, 2);
    assert.deepEqual(persisted.rows.map((row) => row.status), ['SUCCEEDED', 'SUCCEEDED']);
    assert.deepEqual(persisted.rows.map((row) => row.stage), ['PERSISTENCE', 'PERSISTENCE']);
    persisted.rows.forEach((row) => { assert.ok(row.target_id); assert.match(row.request_fingerprint, /^[a-f0-9]{64}$/); });
  } finally { await pool.end(); }
});

test('preserves rejected recommendation as rejected and allows generating and approving a fresh recommendation', async () => {
  const pool = database();
  try {
    const f = await fixture(pool);
    let genCount = 0;
    const testProvider = {
      provider: 'GEMINI',
      model: 'gemini-3-flash-preview',
      generateAssistantRecommendation: async () => {
        genCount++;
        return { schema_version: 2, tone: genCount === 1 ? 'First Tone' : 'Second Tone' };
      },
      generateAssistantConfiguration: async () => ({ schema_version: 2, assistant_identity: 'Scope Assistant' }),
    };

    // 1. Initial recommendation generation
    const rec1 = await generateAssistantRecommendation({ database: pool, provider: testProvider, tenantId: f.tenantId, assistantId: f.assistantId, businessProfileVersionId: f.versionId, requestedBy: f.userId });
    assert.equal(rec1.reused, false);
    assert.equal(rec1.recommendation.status, 'NEEDS_REVIEW');

    // 2. Reject recommendation 1
    const rej1 = await reviewAssistantRecommendation({ database: pool, tenantId: f.tenantId, assistantId: f.assistantId, recommendationId: rec1.recommendation.id, reviewedBy: f.userId, decision: 'REJECTED' });
    assert.equal(rej1.status, 'REJECTED');

    // 3. Generate recommendation 2: must NOT reuse the rejected recommendation!
    const rec2 = await generateAssistantRecommendation({ database: pool, provider: testProvider, tenantId: f.tenantId, assistantId: f.assistantId, businessProfileVersionId: f.versionId, requestedBy: f.userId });
    assert.equal(rec2.reused, false);
    assert.notEqual(rec2.recommendation.id, rec1.recommendation.id);
    assert.equal(rec2.recommendation.status, 'NEEDS_REVIEW');

    // 4. Verify DB state: both exist, rec1 is REJECTED, rec2 is NEEDS_REVIEW
    const recsInDb = await pool.query(`SELECT id, status, recommendation_data->>'tone' AS tone FROM assistant_knowledge_recommendations WHERE tenant_id=$1 AND assistant_id=$2 ORDER BY created_at ASC`, [f.tenantId, f.assistantId]);
    assert.equal(recsInDb.rowCount, 2);
    assert.equal(recsInDb.rows[0].id, rec1.recommendation.id);
    assert.equal(recsInDb.rows[0].status, 'REJECTED');
    assert.equal(recsInDb.rows[0].tone, 'First Tone');
    assert.equal(recsInDb.rows[1].id, rec2.recommendation.id);
    assert.equal(recsInDb.rows[1].status, 'NEEDS_REVIEW');
    assert.equal(recsInDb.rows[1].tone, 'Second Tone');

    // 5. Explicitly approve recommendation 2
    const app2 = await reviewAssistantRecommendation({ database: pool, tenantId: f.tenantId, assistantId: f.assistantId, recommendationId: rec2.recommendation.id, reviewedBy: f.userId, decision: 'APPROVED' });
    assert.equal(app2.status, 'APPROVED');

    // 6. Generate configuration from approved recommendation 2
    const config = await generateAssistantConfigurationVersion({ database: pool, provider: testProvider, tenantId: f.tenantId, assistantId: f.assistantId, recommendationId: rec2.recommendation.id, requestedBy: f.userId });
    assert.equal(config.reused, false);
    assert.equal(config.configuration.status, 'NEEDS_REVIEW');
    assert.equal(config.configuration.source_recommendation_id, rec2.recommendation.id);
  } finally { await pool.end(); }
});

