import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

const { Client } = pg;

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required; this PostgreSQL contract must not be skipped');
  }

  return new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : undefined,
  });
}

async function authorityVersion(client, tenantId, assistantId) {
  const result = await client.query(
    `SELECT knowledge_authority_version::bigint AS version
       FROM ai_assistants
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, assistantId],
  );
  assert.equal(result.rowCount, 1);
  return BigInt(result.rows[0].version);
}

test('knowledge authority epoch is atomic, monotonic, scoped, and activation-aware', async () => {
  const client = createClient();
  await client.connect();
  await client.query('BEGIN');

  try {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const assistantA = randomUUID();
    const assistantB = randomUUID();
    const assistantOtherTenant = randomUUID();
    const source = randomUUID();

    await client.query(
      `INSERT INTO tenants (id, name)
       VALUES ($1, 'Authority Test A'), ($2, 'Authority Test B')`,
      [tenantA, tenantB],
    );
    await client.query(
      `INSERT INTO ai_assistants (id, tenant_id, name)
       VALUES
         ($1, $2, 'Assistant A'),
         ($3, $2, 'Assistant B'),
         ($4, $5, 'Other Tenant Assistant')`,
      [assistantA, tenantA, assistantB, assistantOtherTenant, tenantB],
    );

    assert.equal(await authorityVersion(client, tenantA, assistantA), 1n);
    assert.equal(await authorityVersion(client, tenantA, assistantB), 1n);
    assert.equal(await authorityVersion(client, tenantB, assistantOtherTenant), 1n);

    await client.query(
      `INSERT INTO knowledge_base_documents (
         id, tenant_id, title, content, status, source_type, content_hash,
         processing_status, indexing_status, enabled
       ) VALUES ($1, $2, 'Epoch source', 'marker', 'active', 'DOCUMENT', $3, 'READY', 'READY', TRUE)`,
      [source, tenantA, 'a'.repeat(64)],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 1n);

    await client.query(
      `INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
       VALUES ($1, $2, $3)`,
      [tenantA, source, assistantA],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 2n, 'assignment bumps once');

    await client.query(
      `INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, source_id, assistant_id) DO NOTHING`,
      [tenantA, source, assistantA],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 2n, 'idempotent assignment does not bump');

    await client.query('SAVEPOINT unassign_rollback');
    await client.query(
      `DELETE FROM knowledge_source_assistants
       WHERE tenant_id = $1 AND source_id = $2 AND assistant_id = $3`,
      [tenantA, source, assistantA],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 3n);
    await client.query('ROLLBACK TO SAVEPOINT unassign_rollback');
    assert.equal(await authorityVersion(client, tenantA, assistantA), 2n, 'epoch bump rolls back atomically');

    await client.query(
      `DELETE FROM knowledge_source_assistants
       WHERE tenant_id = $1 AND source_id = $2 AND assistant_id = $3`,
      [tenantA, source, assistantA],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 3n);

    await client.query(
      `INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
       VALUES ($1, $2, $3)`,
      [tenantA, source, assistantA],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 4n, 'reassignment creates a new epoch');

    await client.query(
      `UPDATE knowledge_base_documents
          SET processing_status = 'PROCESSING', indexing_status = 'PENDING'
        WHERE tenant_id = $1 AND id = $2`,
      [tenantA, source],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 5n, 'one logical readiness update bumps once');

    await client.query(
      `UPDATE knowledge_base_documents
          SET processing_status = 'READY', indexing_status = 'READY'
        WHERE tenant_id = $1 AND id = $2`,
      [tenantA, source],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 6n);

    await client.query(
      `UPDATE knowledge_base_documents
          SET processing_status = 'ARCHIVED', indexing_status = 'ARCHIVED', enabled = FALSE
        WHERE tenant_id = $1 AND id = $2`,
      [tenantA, source],
    );
    assert.equal(await authorityVersion(client, tenantA, assistantA), 7n, 'archive bumps once');
    assert.equal(await authorityVersion(client, tenantA, assistantB), 1n, 'different Assistant remains isolated');
    assert.equal(await authorityVersion(client, tenantB, assistantOtherTenant), 1n, 'different tenant remains isolated');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

test('only ACTIVE profile and configuration pointer changes bump authority', async () => {
  const client = createClient();
  await client.connect();
  await client.query('BEGIN');

  try {
    const tenantId = randomUUID();
    const assistantId = randomUUID();
    const profileId = randomUUID();
    const profileVersionId = randomUUID();
    const configurationVersionId = randomUUID();

    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Activation Test')`, [tenantId]);
    await client.query(
      `INSERT INTO ai_assistants (id, tenant_id, name) VALUES ($1, $2, 'Activation Assistant')`,
      [assistantId, tenantId],
    );
    await client.query(
      `INSERT INTO business_profiles (id, tenant_id) VALUES ($1, $2)`,
      [profileId, tenantId],
    );
    await client.query(
      `INSERT INTO business_profile_versions (
         id, tenant_id, profile_id, profile_data, status, generated_by
       ) VALUES ($1, $2, $3, '{}'::jsonb, 'APPROVED', 'HUMAN')`,
      [profileVersionId, tenantId, profileId],
    );
    await client.query(
      `UPDATE business_profiles SET approved_version_id = $1 WHERE id = $2 AND tenant_id = $3`,
      [profileVersionId, profileId, tenantId],
    );
    assert.equal(await authorityVersion(client, tenantId, assistantId), 1n, 'APPROVED profile is not runtime authority');

    await client.query(
      `UPDATE business_profiles SET active_version_id = $1 WHERE id = $2 AND tenant_id = $3`,
      [profileVersionId, profileId, tenantId],
    );
    assert.equal(await authorityVersion(client, tenantId, assistantId), 2n, 'ACTIVE profile pointer bumps');

    await client.query(
      `INSERT INTO assistant_configuration_versions (
         id, tenant_id, assistant_id, configuration_data, status, generated_by
       ) VALUES ($1, $2, $3, '{}'::jsonb, 'APPROVED', 'HUMAN')`,
      [configurationVersionId, tenantId, assistantId],
    );
    assert.equal(await authorityVersion(client, tenantId, assistantId), 2n, 'APPROVED configuration is not runtime authority');

    await client.query(
      `UPDATE ai_assistants SET active_configuration_version_id = $1 WHERE id = $2 AND tenant_id = $3`,
      [configurationVersionId, assistantId, tenantId],
    );
    assert.equal(await authorityVersion(client, tenantId, assistantId), 3n, 'ACTIVE configuration pointer bumps');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

test('legacy knowledge changes preserve scoped compatibility while bumping authority', async () => {
  const client = createClient();
  await client.connect();
  await client.query('BEGIN');

  try {
    const tenantId = randomUUID();
    const assistantA = randomUUID();
    const assistantB = randomUUID();
    const scopedLegacyId = randomUUID();
    const globalLegacyId = randomUUID();

    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Legacy Test')`, [tenantId]);
    await client.query(
      `INSERT INTO ai_assistants (id, tenant_id, name)
       VALUES ($1, $2, 'Legacy A'), ($3, $2, 'Legacy B')`,
      [assistantA, tenantId, assistantB],
    );

    await client.query(
      `INSERT INTO knowledge_base_documents (id, tenant_id, assistant_id, title, content)
       VALUES ($1, $2, $3, 'Scoped legacy', 'legacy marker')`,
      [scopedLegacyId, tenantId, assistantA],
    );
    assert.equal(await authorityVersion(client, tenantId, assistantA), 2n);
    assert.equal(await authorityVersion(client, tenantId, assistantB), 1n);

    await client.query(
      `INSERT INTO knowledge_base_documents (id, tenant_id, title, content)
       VALUES ($1, $2, 'Global legacy', 'global marker')`,
      [globalLegacyId, tenantId],
    );
    assert.equal(await authorityVersion(client, tenantId, assistantA), 3n);
    assert.equal(await authorityVersion(client, tenantId, assistantB), 2n);

    await client.query(
      `UPDATE knowledge_base_documents SET content = 'updated marker'
       WHERE id = $1 AND tenant_id = $2`,
      [scopedLegacyId, tenantId],
    );
    assert.equal(await authorityVersion(client, tenantId, assistantA), 4n);
    assert.equal(await authorityVersion(client, tenantId, assistantB), 2n);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
