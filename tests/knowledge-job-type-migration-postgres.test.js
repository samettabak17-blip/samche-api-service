import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) throw new Error('KNOWLEDGE_JOB_TYPE_POSTGRES_REQUIRES_TEST_DATABASE_URL');
const database = new pg.Pool({ connectionString, ssl: resolvePostgresSsl({ connectionString, databaseSsl: 'strict', nodeEnv: 'test' }), max: 1 });
test.after(async () => database.end());

test('rerunnable historical knowledge-job migrations preserve every canonical job type', async () => {
  const client = await database.connect();
  let tenantId;
  try {
    await client.query('BEGIN');
    const tenant = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['job-contract-' + crypto.randomUUID()]);
    tenantId = tenant.rows[0].id;
    await client.query(
      `INSERT INTO knowledge_processing_jobs (tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version, status)
       VALUES ($1, NULL, 'GENERATE_BUSINESS_PROFILE', $2, 'fixture', 'v1', 'PENDING')`,
      [tenantId, crypto.randomBytes(32).toString('hex')],
    );
    for (const file of ['043_image_semantic_generation_jobs.sql', '052_assistant_recommendation_generation_jobs.sql', '055_assistant_configuration_generation_jobs.sql', '066_business_profile_generation_jobs.sql']) {
      await client.query(fs.readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
    }
    const rows = await client.query(`SELECT job_type FROM knowledge_processing_jobs WHERE tenant_id=$1`, [tenantId]);
    assert.deepEqual(rows.rows.map((row) => row.job_type), ['GENERATE_BUSINESS_PROFILE']);
    await assert.rejects(
      () => client.query(`INSERT INTO knowledge_processing_jobs (tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version, status) VALUES ($1,NULL,'UNKNOWN_JOB_TYPE',$2,'fixture','v1','PENDING')`, [tenantId, crypto.randomBytes(32).toString('hex')]),
      (error) => error?.code === '23514',
    );
    await client.query('ROLLBACK');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
});
