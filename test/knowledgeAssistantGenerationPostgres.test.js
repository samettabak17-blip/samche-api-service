import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generateAssistantConfigurationVersion, generateAssistantRecommendation, reviewAssistantRecommendation } from '../services/knowledge-assistant-lifecycle.js';

const { Pool } = pg;
const HASH = 'b'.repeat(64);

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; this PostgreSQL contract must not be skipped');
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : undefined });
}

async function fixture(pool) {
  const tenantId = randomUUID(); const userId = randomUUID(); const identityId = randomUUID(); const assistantId = randomUUID(); const profileId = randomUUID(); const versionId = randomUUID(); const sourceId = randomUUID();
  await pool.query(`INSERT INTO tenants (id,name) VALUES ($1,'Assistant generation contract')`, [tenantId]);
  await pool.query(`INSERT INTO users (id,email,password_hash,system_role) VALUES ($1,$2,'test-only','CUSTOMER')`, [userId, `assistant-generation-${randomUUID()}@example.test`]);
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
