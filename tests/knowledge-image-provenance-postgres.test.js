import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import {
  approveConversationKnowledgeCandidate,
  convergeImageCandidateIdentityProvenance,
} from '../services/knowledge-candidate-service.js';
import { assignKnowledgeSourceBusinessIdentity } from '../services/knowledge-source-business-identity-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('IMAGE_PROVENANCE_POSTGRES_REQUIRES_TEST_DATABASE_URL');
if (!isSafeTestDatabaseUrl(connectionString)) {
  throw new Error('IMAGE_PROVENANCE_POSTGRES_REFUSES_NON_ISOLATED_TEST_DATABASE');
}

const { Pool } = pg;
const database = new Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: 'strict', nodeEnv: 'test' }),
  max: 1,
});

after(async () => {
  await database.end();
});

async function seedImageCandidate(client, {
  tenantId,
  identityIds = [],
  status = 'NEEDS_REVIEW',
  evidenceIdentityId = null,
  suffix,
}) {
  const source = await client.query(
    `INSERT INTO knowledge_base_documents (
       tenant_id, title, content, source_type, original_filename, mime_type,
       processing_status, indexing_status, enabled
     ) VALUES ($1, $2, 'postgres integration fixture', 'DOCUMENT', $3, 'image/png', 'READY', 'DISABLED', TRUE)
     RETURNING id`,
    [tenantId, `Historical image ${suffix}`, `historical-${suffix}.png`],
  );
  const segment = await client.query(
    `INSERT INTO knowledge_source_extraction_segments (
       tenant_id, source_id, extraction_version, extraction_hash, segment_order,
       role, role_confidence, normalized_text, extraction_method
     ) VALUES ($1, $2, 'fixture-v1', $3, 0, 'BUSINESS', 1, 'trusted business fact', 'FIXTURE')
     RETURNING id`,
    [tenantId, source.rows[0].id, suffix.padEnd(64, 'a').slice(0, 64)],
  );
  const candidate = await client.query(
    `INSERT INTO knowledge_candidates (
       tenant_id, candidate_type, proposed_title, proposed_content, status,
       pii_redaction_status, image_semantic_version
     ) VALUES ($1, 'POLICY', $2, 'trusted business fact', $3, 'PASSED', '1')
     RETURNING id`,
    [tenantId, `Historical candidate ${suffix}`, status],
  );
  for (const identityId of identityIds) {
    await client.query(
      `INSERT INTO knowledge_source_business_identities (
         tenant_id, source_id, business_identity_id, assignment_origin
       ) VALUES ($1, $2, $3, 'POSTGRES_REGRESSION_FIXTURE')`,
      [tenantId, source.rows[0].id, identityId],
    );
  }
  await client.query(
    `INSERT INTO knowledge_candidate_image_evidence (
       tenant_id, candidate_id, source_id, segment_id, extraction_version,
       extraction_hash, segment_order, role, role_confidence, normalized_text,
       evidence_kind, business_identity_id
     ) VALUES ($1, $2, $3, $4, 'fixture-v1', $5, 0, 'BUSINESS', 1,
               'trusted business fact', 'PRIMARY', $6)`,
    [tenantId, candidate.rows[0].id, source.rows[0].id, segment.rows[0].id,
      suffix.padEnd(64, 'a').slice(0, 64), evidenceIdentityId],
  );
  return { candidateId: candidate.rows[0].id, sourceId: source.rows[0].id };
}

async function seedCandidateForSource(client, { tenantId, sourceId, suffix, segmentOrder = 0 }) {
  const segment = await client.query(
    `INSERT INTO knowledge_source_extraction_segments (
       tenant_id, source_id, extraction_version, extraction_hash, segment_order,
       role, role_confidence, normalized_text, extraction_method
     ) VALUES ($1, $2, 'fixture-v1', $3, $4, 'BUSINESS', 1, 'trusted business fact', 'FIXTURE')
     RETURNING id`,
    [tenantId, sourceId, suffix.padEnd(64, 'b').slice(0, 64), segmentOrder],
  );
  const candidate = await client.query(
    `INSERT INTO knowledge_candidates (
       tenant_id, candidate_type, proposed_title, proposed_content, status,
       pii_redaction_status, image_semantic_version
     ) VALUES ($1, 'POLICY', $2, 'trusted business fact', 'NEEDS_REVIEW', 'PASSED', '1')
     RETURNING id`,
    [tenantId, `Durability candidate ${suffix}`],
  );
  await client.query(
    `INSERT INTO knowledge_candidate_image_evidence (
       tenant_id, candidate_id, source_id, segment_id, extraction_version,
       extraction_hash, segment_order, role, role_confidence, normalized_text,
       evidence_kind
     ) VALUES ($1, $2, $3, $4, 'fixture-v1', $5, $6, 'BUSINESS', 1,
               'trusted business fact', 'PRIMARY')`,
    [tenantId, candidate.rows[0].id, sourceId, segment.rows[0].id,
      suffix.padEnd(64, 'b').slice(0, 64), segmentOrder],
  );
  return candidate.rows[0].id;
}

test('real PostgreSQL handles the historical missing-link shape and converges only one UUID identity', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ('Image provenance PostgreSQL fixture', 'STARTER') RETURNING id`,
    );
    const identities = await client.query(
      `INSERT INTO business_identities (tenant_id, display_name, normalized_identity)
       VALUES ($1, 'Fixture Identity A', 'fixture-identity-a'),
              ($1, 'Fixture Identity B', 'fixture-identity-b')
       RETURNING id`,
      [tenant.rows[0].id],
    );

    const historical = await seedImageCandidate(client, {
      tenantId: tenant.rows[0].id,
      identityIds: [identities.rows[0].id],
      suffix: 'one',
    });
    const zero = await seedImageCandidate(client, {
      tenantId: tenant.rows[0].id,
      suffix: 'zero',
    });
    const conflicting = await seedImageCandidate(client, {
      tenantId: tenant.rows[0].id,
      identityIds: identities.rows.map((row) => row.id),
      suffix: 'conflict',
    });
    const approved = await seedImageCandidate(client, {
      tenantId: tenant.rows[0].id,
      identityIds: [identities.rows[0].id],
      status: 'APPROVED',
      suffix: 'approved',
    });

    // This is the exact historical staging topology: PRIMARY BUSINESS evidence
    // has no identity snapshot and its source has no explicit identity link.
    // PostgreSQL must fail closed with zero updates, not fail while resolving
    // an unsupported UUID aggregate.
    const missingLink = await convergeImageCandidateIdentityProvenance({
      database: client,
      tenantId: tenant.rows[0].id,
      candidateId: zero.candidateId,
    });
    assert.equal(missingLink.rows.length, 0);

    const first = await convergeImageCandidateIdentityProvenance({
      database: client,
      tenantId: tenant.rows[0].id,
      candidateId: historical.candidateId,
    });
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].business_identity_id, identities.rows[0].id);

    const repeated = await convergeImageCandidateIdentityProvenance({
      database: client,
      tenantId: tenant.rows[0].id,
      candidateId: historical.candidateId,
    });
    assert.equal(repeated.rows.length, 0);

    for (const fixture of [conflicting, approved]) {
      const result = await convergeImageCandidateIdentityProvenance({
        database: client,
        tenantId: tenant.rows[0].id,
        candidateId: fixture.candidateId,
      });
      assert.equal(result.rows.length, 0);
    }

    const persisted = await client.query(
      `SELECT candidate_id, business_identity_id
         FROM knowledge_candidate_image_evidence
        WHERE tenant_id = $1 AND candidate_id = ANY($2::uuid[])
        ORDER BY candidate_id`,
      [tenant.rows[0].id, [historical.candidateId, zero.candidateId, conflicting.candidateId, approved.candidateId]],
    );
    assert.equal(persisted.rows.filter((row) => row.business_identity_id !== null).length, 1);
    assert.equal(persisted.rows.find((row) => row.candidate_id === historical.candidateId).business_identity_id, identities.rows[0].id);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('real PostgreSQL restores a missing canonical link only from one unambiguous assignment audit identity', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ('Audited identity PostgreSQL fixture', 'STARTER') RETURNING id`,
    );
    const identities = await client.query(
      `INSERT INTO business_identities (tenant_id, display_name, normalized_identity)
       VALUES ($1, 'Audited Identity A', 'audited-identity-a'),
              ($1, 'Audited Identity B', 'audited-identity-b')
       RETURNING id`,
      [tenant.rows[0].id],
    );
    const audited = await seedImageCandidate(client, {
      tenantId: tenant.rows[0].id,
      suffix: 'audited-one',
    });
    await client.query(
      `INSERT INTO knowledge_source_business_identity_assignment_events (
         id, tenant_id, source_id, previous_business_identity_id,
         new_business_identity_id, changed_by_user_id, change_origin
       ) VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, 'HUMAN_CONFIRMED_SOURCE_IDENTITY')`,
      [tenant.rows[0].id, audited.sourceId, identities.rows[0].id, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
    );

    const repaired = await convergeImageCandidateIdentityProvenance({
      database: client,
      tenantId: tenant.rows[0].id,
      candidateId: audited.candidateId,
    });
    assert.equal(repaired.rows.length, 1);
    const restored = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_source_business_identities
           WHERE tenant_id=$1 AND source_id=$2 AND business_identity_id=$3)::int AS links,
         (SELECT COUNT(*) FROM knowledge_candidate_image_evidence
           WHERE tenant_id=$1 AND candidate_id=$4 AND business_identity_id=$3)::int AS evidence_rows`,
      [tenant.rows[0].id, audited.sourceId, identities.rows[0].id, audited.candidateId],
    );
    assert.deepEqual(restored.rows[0], { links: 1, evidence_rows: 1 });

    const ambiguous = await seedImageCandidate(client, {
      tenantId: tenant.rows[0].id,
      suffix: 'audited-conflict',
    });
    await client.query(
      `INSERT INTO knowledge_source_business_identity_assignment_events (
         id, tenant_id, source_id, previous_business_identity_id,
         new_business_identity_id, changed_by_user_id, change_origin
       ) VALUES (gen_random_uuid(), $1, $2, NULL, $3, $5, 'HUMAN_CONFIRMED_SOURCE_IDENTITY'),
                (gen_random_uuid(), $1, $2, $3, $4, $5, 'HUMAN_CONFIRMED_SOURCE_IDENTITY')`,
      [tenant.rows[0].id, ambiguous.sourceId, identities.rows[0].id, identities.rows[1].id,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
    );
    const rejected = await convergeImageCandidateIdentityProvenance({
      database: client,
      tenantId: tenant.rows[0].id,
      candidateId: ambiguous.candidateId,
    });
    assert.equal(rejected.rows.length, 0);
    const conflictState = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_source_business_identities
           WHERE tenant_id=$1 AND source_id=$2)::int AS links,
         (SELECT COUNT(*) FROM knowledge_candidate_image_evidence
           WHERE tenant_id=$1 AND candidate_id=$3 AND business_identity_id IS NOT NULL)::int AS evidence_rows`,
      [tenant.rows[0].id, ambiguous.sourceId, ambiguous.candidateId],
    );
    assert.deepEqual(conflictState.rows[0], { links: 0, evidence_rows: 0 });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('real PostgreSQL keeps explicit assignment durable and restores only unambiguous audited history', async () => {
  const created = { tenants: [], sources: [], users: [] };
  try {
    const actor = await database.query(
      `WITH generated_email AS (
         SELECT concat('postgres-fixture-', gen_random_uuid(), '@example.test') AS value
       )
       INSERT INTO users (email, email_normalized, password_hash, system_role)
       SELECT value, value, 'fixture', 'OWNER' FROM generated_email
       RETURNING id`,
    );
    const actorId = actor.rows[0].id;
    created.users.push(actorId);
    const tenant = await database.query(
      `INSERT INTO tenants (name, plan_code) VALUES ('Identity durability PostgreSQL fixture', 'STARTER') RETURNING id`,
    );
    const otherTenant = await database.query(
      `INSERT INTO tenants (name, plan_code) VALUES ('Identity isolation PostgreSQL fixture', 'STARTER') RETURNING id`,
    );
    created.tenants.push(tenant.rows[0].id, otherTenant.rows[0].id);
    const identities = await database.query(
      `INSERT INTO business_identities (tenant_id, display_name, normalized_identity)
       VALUES ($1, 'Durable Identity A', 'durable-identity-a'),
              ($1, 'Durable Identity B', 'durable-identity-b'),
              ($2, 'Other Tenant Identity', 'other-tenant-identity')
       RETURNING id, tenant_id`,
      [tenant.rows[0].id, otherTenant.rows[0].id],
    );
    const ownIdentities = identities.rows.filter((row) => row.tenant_id === tenant.rows[0].id);
    const otherIdentity = identities.rows.find((row) => row.tenant_id === otherTenant.rows[0].id);

    const source = await database.query(
      `INSERT INTO knowledge_base_documents (
         tenant_id, title, content, source_type, original_filename, mime_type,
         processing_status, indexing_status, enabled
       ) VALUES ($1, 'Durable source', 'fixture', 'DOCUMENT', 'durable.png',
                 'image/png', 'READY', 'DISABLED', TRUE)
       RETURNING id`,
      [tenant.rows[0].id],
    );
    created.sources.push(source.rows[0].id);
    const beforeAssignmentCandidate = await seedCandidateForSource(database, {
      tenantId: tenant.rows[0].id,
      sourceId: source.rows[0].id,
      suffix: 'before-assignment',
    });

    const assigned = await assignKnowledgeSourceBusinessIdentity({
      database,
      tenantId: tenant.rows[0].id,
      sourceId: source.rows[0].id,
      businessIdentityId: ownIdentities[0].id,
      assignedBy: actorId,
    });
    assert.equal(assigned.changed, true);

    const durableReload = await database.query(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_source_business_identities
           WHERE tenant_id=$1 AND source_id=$2 AND business_identity_id=$3)::int AS links,
         (SELECT COUNT(*) FROM knowledge_source_business_identity_assignment_events
           WHERE tenant_id=$1 AND source_id=$2 AND new_business_identity_id=$3)::int AS events,
         (SELECT COUNT(*) FROM knowledge_candidate_image_evidence
           WHERE tenant_id=$1 AND candidate_id=$4 AND business_identity_id=$3)::int AS evidence_rows`,
      [tenant.rows[0].id, source.rows[0].id, ownIdentities[0].id, beforeAssignmentCandidate],
    );
    assert.deepEqual(durableReload.rows[0], { links: 1, events: 1, evidence_rows: 1 });

    const approvedSource = await approveConversationKnowledgeCandidate({
      database,
      tenantId: tenant.rows[0].id,
      candidateId: beforeAssignmentCandidate,
      reviewedBy: actorId,
    });
    const approvalReload = await database.query(
      `SELECT candidate.status, candidate.approved_source_id,
              (SELECT COUNT(*) FROM knowledge_source_business_identities
                WHERE tenant_id = $1 AND source_id = candidate.approved_source_id
                  AND business_identity_id = $2)::int AS canonical_identity_links
         FROM knowledge_candidates candidate
        WHERE candidate.tenant_id = $1 AND candidate.id = $3`,
      [tenant.rows[0].id, ownIdentities[0].id, beforeAssignmentCandidate],
    );
    assert.deepEqual(approvalReload.rows[0], {
      status: 'APPROVED',
      approved_source_id: approvedSource.id,
      canonical_identity_links: 1,
    });

    const afterAssignmentCandidate = await seedCandidateForSource(database, {
      tenantId: tenant.rows[0].id,
      sourceId: source.rows[0].id,
      suffix: 'after-assignment',
      segmentOrder: 1,
    });
    const repeated = await assignKnowledgeSourceBusinessIdentity({
      database,
      tenantId: tenant.rows[0].id,
      sourceId: source.rows[0].id,
      businessIdentityId: ownIdentities[0].id,
      assignedBy: actorId,
    });
    assert.equal(repeated.changed, false);
    const repeatedReload = await database.query(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_source_business_identity_assignment_events
           WHERE tenant_id=$1 AND source_id=$2)::int AS events,
         (SELECT COUNT(*) FROM knowledge_candidate_image_evidence
           WHERE tenant_id=$1 AND candidate_id=$3 AND business_identity_id=$4)::int AS evidence_rows`,
      [tenant.rows[0].id, source.rows[0].id, afterAssignmentCandidate, ownIdentities[0].id],
    );
    assert.deepEqual(repeatedReload.rows[0], { events: 1, evidence_rows: 1 });

    const auditedSource = await database.query(
      `INSERT INTO knowledge_base_documents (
         tenant_id, title, content, source_type, original_filename, mime_type,
         processing_status, indexing_status, enabled
       ) VALUES ($1, 'Audited historical source', 'fixture', 'DOCUMENT', 'audited.png',
                 'image/png', 'READY', 'DISABLED', TRUE)
       RETURNING id`,
      [tenant.rows[0].id],
    );
    created.sources.push(auditedSource.rows[0].id);
    const auditedCandidate = await seedCandidateForSource(database, {
      tenantId: tenant.rows[0].id,
      sourceId: auditedSource.rows[0].id,
      suffix: 'audited-history',
    });
    await database.query(
      `INSERT INTO knowledge_source_business_identity_assignment_events (
         id, tenant_id, source_id, previous_business_identity_id,
         new_business_identity_id, changed_by_user_id, change_origin
       ) VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, 'HUMAN_CONFIRMED_SOURCE_IDENTITY')`,
      [tenant.rows[0].id, auditedSource.rows[0].id, ownIdentities[0].id, actorId],
    );
    const auditedRepair = await convergeImageCandidateIdentityProvenance({
      database,
      tenantId: tenant.rows[0].id,
      candidateId: auditedCandidate,
    });
    assert.equal(auditedRepair.rows.length, 1);
    const auditedReload = await database.query(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_source_business_identities
           WHERE tenant_id=$1 AND source_id=$2 AND business_identity_id=$3)::int AS links,
         (SELECT COUNT(*) FROM knowledge_candidate_image_evidence
           WHERE tenant_id=$1 AND candidate_id=$4 AND business_identity_id=$3)::int AS evidence_rows`,
      [tenant.rows[0].id, auditedSource.rows[0].id, ownIdentities[0].id, auditedCandidate],
    );
    assert.deepEqual(auditedReload.rows[0], { links: 1, evidence_rows: 1 });

    await assert.rejects(
      assignKnowledgeSourceBusinessIdentity({
        database,
        tenantId: tenant.rows[0].id,
        sourceId: source.rows[0].id,
        businessIdentityId: otherIdentity.id,
        assignedBy: actorId,
      }),
      (error) => error?.code === 'KNOWLEDGE_BUSINESS_IDENTITY_NOT_FOUND',
    );
  } finally {
    if (created.tenants.length) {
      await database.query(`DELETE FROM knowledge_candidates WHERE tenant_id = ANY($1::uuid[])`, [created.tenants]).catch(() => {});
      await database.query(`DELETE FROM knowledge_source_extraction_segments WHERE tenant_id = ANY($1::uuid[])`, [created.tenants]).catch(() => {});
      await database.query(`DELETE FROM knowledge_source_business_identity_assignment_events WHERE tenant_id = ANY($1::uuid[])`, [created.tenants]).catch(() => {});
      await database.query(`DELETE FROM knowledge_source_business_identities WHERE tenant_id = ANY($1::uuid[])`, [created.tenants]).catch(() => {});
      await database.query(`DELETE FROM knowledge_base_documents WHERE tenant_id = ANY($1::uuid[])`, [created.tenants]).catch(() => {});
      await database.query(`DELETE FROM business_identities WHERE tenant_id = ANY($1::uuid[])`, [created.tenants]).catch(() => {});
      await database.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [created.tenants]).catch(() => {});
    }
    if (created.users.length) {
      await database.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users]).catch(() => {});
    }
  }
});

test('real PostgreSQL rolls back a failed assignment after the canonical-link boundary', async () => {
  const actorId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const tenant = await database.query(
    `INSERT INTO tenants (name, plan_code) VALUES ('Rollback identity fixture', 'STARTER') RETURNING id`,
  );
  const identity = await database.query(
    `INSERT INTO business_identities (tenant_id, display_name, normalized_identity)
     VALUES ($1, 'Rollback Identity', 'rollback-identity') RETURNING id`,
    [tenant.rows[0].id],
  );
  const source = await database.query(
    `INSERT INTO knowledge_base_documents (
       tenant_id, title, content, source_type, original_filename, mime_type,
       processing_status, indexing_status, enabled
     ) VALUES ($1, 'Rollback source', 'fixture', 'DOCUMENT', 'rollback.png',
               'image/png', 'READY', 'DISABLED', TRUE)
     RETURNING id`,
    [tenant.rows[0].id],
  );
  const failingDatabase = {
    connect: async () => {
      const client = await database.connect();
      return {
        ...client,
        query: async (sql, params) => {
          if (/INSERT INTO knowledge_source_business_identity_assignment_events/i.test(sql)) {
            const error = new Error('forced assignment audit failure');
            error.code = 'TEST_ASSIGNMENT_AUDIT_FAILURE';
            throw error;
          }
          return client.query(sql, params);
        },
      };
    },
  };
  try {
    await assert.rejects(
      assignKnowledgeSourceBusinessIdentity({
        database: failingDatabase,
        tenantId: tenant.rows[0].id,
        sourceId: source.rows[0].id,
        businessIdentityId: identity.rows[0].id,
        assignedBy: actorId,
        onDiagnostic: () => {},
      }),
      (error) => error?.code === 'TEST_ASSIGNMENT_AUDIT_FAILURE',
    );
    const state = await database.query(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_source_business_identities
           WHERE tenant_id = $1 AND source_id = $2)::int AS links,
         (SELECT COUNT(*) FROM knowledge_source_business_identity_assignment_events
           WHERE tenant_id = $1 AND source_id = $2)::int AS events`,
      [tenant.rows[0].id, source.rows[0].id],
    );
    assert.deepEqual(state.rows[0], { links: 0, events: 0 });
  } finally {
    await database.query('DELETE FROM knowledge_source_business_identity_assignment_events WHERE tenant_id = $1', [tenant.rows[0].id]).catch(() => {});
    await database.query('DELETE FROM knowledge_source_business_identities WHERE tenant_id = $1', [tenant.rows[0].id]).catch(() => {});
    await database.query('DELETE FROM knowledge_base_documents WHERE tenant_id = $1', [tenant.rows[0].id]).catch(() => {});
    await database.query('DELETE FROM business_identities WHERE tenant_id = $1', [tenant.rows[0].id]).catch(() => {});
    await database.query('DELETE FROM tenants WHERE id = $1', [tenant.rows[0].id]).catch(() => {});
  }
});
