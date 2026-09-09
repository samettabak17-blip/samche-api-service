import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import {
  enqueueAssistantConfigurationGenerationJob,
  getAssistantConfigurationGenerationJob,
  processAssistantConfigurationGenerationJob,
} from '../services/knowledge-semantic-generation-job-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('ASSISTANT_CONFIGURATION_JOB_POSTGRES_REQUIRES_TEST_DATABASE_URL');
if (!isSafeTestDatabaseUrl(connectionString)) throw new Error('ASSISTANT_CONFIGURATION_JOB_POSTGRES_REFUSES_NON_ISOLATED_TEST_DATABASE');

const { Pool } = pg;
const database = new Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }),
  max: 1,
});

after(async () => database.end());

test('real PostgreSQL keeps repeated equivalent configuration enqueue requests on one durable job', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ('Configuration job idempotency PostgreSQL fixture', 'STARTER') RETURNING id`,
    );
    const tenantId = tenant.rows[0].id;
    const ids = {
      assistantId: '11111111-1111-4111-8111-111111111111',
      recommendationId: '22222222-2222-4222-8222-222222222222',
      businessProfileVersionId: '33333333-3333-4333-8333-333333333333',
      requestedBy: '44444444-4444-4444-8444-444444444444',
    };
    await client.query(
      `INSERT INTO ai_assistants (id, tenant_id, name, status) VALUES ($1, $2, 'Fixture Assistant', 'active')`,
      [ids.assistantId, tenantId],
    );
    const fingerprint = 'a'.repeat(64);
    const first = await enqueueAssistantConfigurationGenerationJob({
      database: client,
      tenantId,
      ...ids,
      fingerprint,
      providerPolicy: 'fixture-policy',
    });
    const repeated = await enqueueAssistantConfigurationGenerationJob({
      database: client,
      tenantId,
      ...ids,
      fingerprint,
      providerPolicy: 'fixture-policy',
    });

    assert.equal(first.id, repeated.id);
    assert.equal(repeated.status, 'PENDING');
    const rows = await client.query(
      `SELECT COUNT(*)::integer AS count, MIN(status) AS status
         FROM knowledge_processing_jobs
        WHERE tenant_id = $1 AND job_type = 'GENERATE_ASSISTANT_CONFIGURATION'
          AND content_hash = $2`,
      [tenantId, fingerprint],
    );
    assert.equal(rows.rows[0].count, 1);
    assert.equal(rows.rows[0].status, 'PENDING');

    const persistedJob = await client.query(
      `SELECT id, tenant_id, attempts, metadata FROM knowledge_processing_jobs WHERE id = $1`,
      [first.id],
    );
    let providerAttempts = 0;
    const generateConfiguration = async ({ database: generationDatabase, tenantId: generationTenantId, assistantId }) => {
      providerAttempts += 1;
      if (providerAttempts === 1) throw Object.assign(new Error('transient provider failure'), { code: 'KNOWLEDGE_GENERATION_PROVIDER_FAILED' });
      const configuration = await generationDatabase.query(
        `INSERT INTO assistant_configuration_versions (
           tenant_id, assistant_id, configuration_data, status, generated_by
         ) VALUES ($1, $2, '{"schema_version":2,"assistant_identity":"Fixture Identity"}'::jsonb, 'NEEDS_REVIEW', 'AI')
         RETURNING id, status, configuration_data`,
        [generationTenantId, assistantId],
      );
      return { configuration: configuration.rows[0], reused: false };
    };

    await assert.rejects(
      processAssistantConfigurationGenerationJob({ database: client, job: persistedJob.rows[0], generateConfiguration }),
      (error) => error.code === 'KNOWLEDGE_GENERATION_PROVIDER_FAILED',
    );
    const retryJob = await client.query(
      `SELECT id, tenant_id, attempts, metadata, status FROM knowledge_processing_jobs WHERE id = $1`,
      [first.id],
    );
    assert.equal(retryJob.rows[0].status, 'PENDING');
    await processAssistantConfigurationGenerationJob({ database: client, job: retryJob.rows[0], generateConfiguration });
    assert.equal(providerAttempts, 2);

    const ready = await client.query(
      `SELECT status, metadata->>'configuration_id' AS configuration_id
         FROM knowledge_processing_jobs WHERE id = $1`,
      [first.id],
    );
    assert.equal(ready.rows[0].status, 'READY');
    assert.ok(ready.rows[0].configuration_id);
    const configurations = await client.query(
      `SELECT COUNT(*)::integer AS count FROM assistant_configuration_versions
        WHERE tenant_id = $1 AND assistant_id = $2`,
      [tenantId, ids.assistantId],
    );
    assert.equal(configurations.rows[0].count, 1);

    const repeatedReady = await enqueueAssistantConfigurationGenerationJob({
      database: client,
      tenantId,
      ...ids,
      fingerprint,
      providerPolicy: 'fixture-policy',
    });
    assert.equal(repeatedReady.id, first.id);
    assert.equal(repeatedReady.status, 'READY');

    const otherTenant = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ('Configuration job isolation PostgreSQL fixture', 'STARTER') RETURNING id`,
    );
    const crossTenantJob = await getAssistantConfigurationGenerationJob({
      database: client,
      tenantId: otherTenant.rows[0].id,
      assistantId: ids.assistantId,
      jobId: first.id,
    });
    assert.equal(crossTenantJob, null);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});
