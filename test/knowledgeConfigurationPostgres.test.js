import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  activateAssistantConfigurationVersion,
  activateBusinessProfileVersion,
  approveBusinessProfileVersion,
} from '../services/knowledge-configuration-service.js';

const { Pool } = pg;

function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required; this PostgreSQL contract must not be skipped');
  return new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : undefined });
}

async function createFixture(pool, {
  identityStatus = 'ACTIVE',
  resolutionStatus = 'RESOLVED',
  profileStatus = 'NEEDS_REVIEW',
  includeIdentity = true,
} = {}) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const assistantId = randomUUID();
  const identityId = randomUUID();
  const profileId = randomUUID();
  const versionId = randomUUID();
  const sourceId = randomUUID();

  await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Knowledge locking test')`, [tenantId]);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, system_role)
     VALUES ($1, $2, 'test-only', 'CUSTOMER')`,
    [userId, `locking-${userId}@example.test`],
  );
  await pool.query(`INSERT INTO ai_assistants (id, tenant_id, name) VALUES ($1, $2, 'Locking test assistant')`, [assistantId, tenantId]);
  if (includeIdentity) {
    await pool.query(
      `INSERT INTO business_identities (id, tenant_id, display_name, normalized_identity, status)
       VALUES ($1, $2, 'Locking Test LLC', 'locking test', $3)`,
      [identityId, tenantId, identityStatus],
    );
  }
  await pool.query(
    `INSERT INTO business_profiles (id, tenant_id, business_identity_id)
     VALUES ($1, $2, $3)`,
    [profileId, tenantId, includeIdentity ? identityId : null],
  );
  await pool.query(
    `INSERT INTO business_profile_versions
       (id, tenant_id, profile_id, profile_data, status, generated_by, schema_version,
        identity_resolution_status, source_scope)
     VALUES ($1, $2, $3, '{}'::jsonb, $4, 'AI', 2, $5, $6::jsonb)`,
    [
      versionId,
      tenantId,
      profileId,
      profileStatus,
      resolutionStatus,
      JSON.stringify({ business_identity_id: identityId, source_ids: [sourceId] }),
    ],
  );
  return { tenantId, userId, assistantId, identityId, profileId, versionId, sourceId };
}

test('real PostgreSQL approves and activates a RESOLVED scoped V2 Business Profile without SQLSTATE 0A000', async () => {
  const pool = database();
  try {
    const fixture = await createFixture(pool);
    const approved = await approveBusinessProfileVersion({
      database: pool,
      tenantId: fixture.tenantId,
      versionId: fixture.versionId,
      approvedBy: fixture.userId,
    });
    assert.equal(approved.status, 'APPROVED');
    let pointers = await pool.query(
      `SELECT approved_version_id, active_version_id FROM business_profiles WHERE id = $1 AND tenant_id = $2`,
      [fixture.profileId, fixture.tenantId],
    );
    assert.equal(pointers.rows[0].approved_version_id, fixture.versionId);
    assert.equal(pointers.rows[0].active_version_id, null, 'APPROVED must not implicitly become ACTIVE');

    const activated = await activateBusinessProfileVersion({
      database: pool,
      tenantId: fixture.tenantId,
      versionId: fixture.versionId,
      activatedBy: fixture.userId,
    });
    assert.equal(activated.status, 'ACTIVE');
    pointers = await pool.query(
      `SELECT active_version_id FROM business_profiles WHERE id = $1 AND tenant_id = $2`,
      [fixture.profileId, fixture.tenantId],
    );
    assert.equal(pointers.rows[0].active_version_id, fixture.versionId);
  } finally {
    await pool.end();
  }
});

test('real PostgreSQL keeps unresolved, missing-identity, and cross-tenant profile lifecycle fail-closed', async () => {
  const pool = database();
  try {
    const unresolvedApproval = await createFixture(pool, { resolutionStatus: 'IDENTITY_RESOLUTION_REQUIRED' });
    await assert.rejects(
      approveBusinessProfileVersion({ database: pool, tenantId: unresolvedApproval.tenantId, versionId: unresolvedApproval.versionId, approvedBy: unresolvedApproval.userId }),
      (error) => error.code === 'KNOWLEDGE_PROFILE_IDENTITY_UNRESOLVED',
    );

    const unresolvedActivation = await createFixture(pool, { resolutionStatus: 'IDENTITY_RESOLUTION_REQUIRED', profileStatus: 'APPROVED' });
    await assert.rejects(
      activateBusinessProfileVersion({ database: pool, tenantId: unresolvedActivation.tenantId, versionId: unresolvedActivation.versionId, activatedBy: unresolvedActivation.userId }),
      (error) => error.code === 'KNOWLEDGE_PROFILE_IDENTITY_UNRESOLVED',
    );

    const missingIdentity = await createFixture(pool, { includeIdentity: false });
    await assert.rejects(
      approveBusinessProfileVersion({ database: pool, tenantId: missingIdentity.tenantId, versionId: missingIdentity.versionId, approvedBy: missingIdentity.userId }),
      (error) => error.code === 'KNOWLEDGE_PROFILE_IDENTITY_UNRESOLVED',
    );

    const tenantA = await createFixture(pool);
    const tenantB = await createFixture(pool);
    await assert.rejects(
      approveBusinessProfileVersion({ database: pool, tenantId: tenantB.tenantId, versionId: tenantA.versionId, approvedBy: tenantB.userId }),
      (error) => error.code === 'KNOWLEDGE_PROFILE_NOT_REVIEWABLE',
    );
  } finally {
    await pool.end();
  }
});

test('real PostgreSQL activates an Assistant Configuration whose source profile is currently ACTIVE', async () => {
  const pool = database();
  try {
    const fixture = await createFixture(pool, { profileStatus: 'APPROVED' });
    await pool.query(
      `UPDATE business_profiles
          SET approved_version_id = $1, active_version_id = $1
        WHERE id = $2 AND tenant_id = $3`,
      [fixture.versionId, fixture.profileId, fixture.tenantId],
    );
    const configurationId = randomUUID();
    await pool.query(
      `INSERT INTO assistant_configuration_versions
         (id, tenant_id, assistant_id, configuration_data, source_profile_version_id, generated_by, status)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, 'AI', 'APPROVED')`,
      [configurationId, fixture.tenantId, fixture.assistantId, fixture.versionId],
    );

    const activated = await activateAssistantConfigurationVersion({
      database: pool,
      tenantId: fixture.tenantId,
      assistantId: fixture.assistantId,
      versionId: configurationId,
      activatedBy: fixture.userId,
    });
    assert.equal(activated.status, 'ACTIVE');
    const pointer = await pool.query(
      `SELECT active_configuration_version_id FROM ai_assistants WHERE id = $1 AND tenant_id = $2`,
      [fixture.assistantId, fixture.tenantId],
    );
    assert.equal(pointer.rows[0].active_configuration_version_id, configurationId);
  } finally {
    await pool.end();
  }
});
