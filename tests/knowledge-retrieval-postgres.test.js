import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { after, test } from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import { retrieveApprovedKnowledge } from '../services/knowledge-intelligence-service.js';
import { approveConversationKnowledgeCandidate } from '../services/knowledge-candidate-service.js';
import { activateAssistantConfigurationVersion } from '../services/knowledge-configuration-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('KNOWLEDGE_RETRIEVAL_POSTGRES_REQUIRES_TEST_DATABASE_URL');
if (!isSafeTestDatabaseUrl(connectionString)) throw new Error('KNOWLEDGE_RETRIEVAL_POSTGRES_REFUSES_NON_ISOLATED_TEST_DATABASE');

const { Pool } = pg;
const database = new Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }),
  max: 1,
});

after(async () => database.end());

function vector(value = 1) {
  return `[${[String(value), ...Array(1535).fill('0')].join(',')}]`;
}

test('real PostgreSQL retrieves canonical indexed knowledge and preserves tenant/source scope', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Retrieval PostgreSQL fixture', 'STARTER') RETURNING id`);
    const otherTenant = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Retrieval isolation PostgreSQL fixture', 'STARTER') RETURNING id`);
    const assistant = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Retrieval Fixture Assistant', 'active') RETURNING id`, [tenant.rows[0].id]);
    const otherAssistant = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Other Retrieval Assistant', 'active') RETURNING id`, [otherTenant.rows[0].id]);

    const original = await client.query(
      `INSERT INTO knowledge_base_documents (tenant_id, title, content, source_type, processing_status, indexing_status, enabled)
       VALUES ($1, 'Original image source', 'image evidence', 'DOCUMENT', 'READY', 'DISABLED', TRUE) RETURNING id`,
      [tenant.rows[0].id],
    );
    await client.query(
      `INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id) VALUES ($1, $2, $3)`,
      [tenant.rows[0].id, original.rows[0].id, assistant.rows[0].id],
    );
    const candidate = await client.query(
      `INSERT INTO knowledge_candidates (tenant_id, assistant_id, candidate_type, proposed_title, proposed_content, status, pii_redaction_status)
       VALUES ($1, $2, 'PRICING', 'Canonical pricing fact', '200 m² bahçe fiyatı 150.000–250.000 TL', 'APPROVED', 'PASSED') RETURNING id`,
      [tenant.rows[0].id, assistant.rows[0].id],
    );
    const materialized = await client.query(
      `INSERT INTO knowledge_base_documents (tenant_id, title, content, source_type, processing_status, indexing_status, enabled)
       VALUES ($1, 'Canonical pricing fact', '200 m² bahçe fiyatı 150.000–250.000 TL', 'CONVERSATION_CANDIDATE', 'READY', 'READY', TRUE) RETURNING id`,
      [tenant.rows[0].id],
    );
    await client.query(
      `INSERT INTO knowledge_materialized_source_provenance (tenant_id, materialized_source_id, candidate_id, original_source_id)
       VALUES ($1, $2, $3, $4)`,
      [tenant.rows[0].id, materialized.rows[0].id, candidate.rows[0].id, original.rows[0].id],
    );
    await client.query(
      `INSERT INTO knowledge_chunks (tenant_id, source_id, chunk_index, normalized_text, text_hash, token_estimate,
         embedding, embedding_provider, embedding_model, embedding_version, embedding_dimensions, index_status, is_active, indexed_at)
       VALUES ($1, $2, 0, '200 m² bahçe fiyatı 150.000–250.000 TL', repeat('a', 64), 8, $3::vector,
               'FIXTURE', 'fixture', 'v1', 1536, 'READY', TRUE, CURRENT_TIMESTAMP)`,
      [tenant.rows[0].id, materialized.rows[0].id, vector()],
    );

    const rawImage = await client.query(
      `INSERT INTO knowledge_base_documents (tenant_id, title, content, source_type, mime_type, processing_status, indexing_status, enabled)
       VALUES ($1, 'Raw image', 'raw extraction', 'DOCUMENT', 'image/png', 'READY', 'DISABLED', TRUE) RETURNING id`,
      [tenant.rows[0].id],
    );
    await client.query(`INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id) VALUES ($1, $2, $3)`, [tenant.rows[0].id, rawImage.rows[0].id, assistant.rows[0].id]);
    const archived = await client.query(
      `INSERT INTO knowledge_base_documents (tenant_id, title, content, source_type, processing_status, indexing_status, enabled, status)
       VALUES ($1, 'Disabled historical source', 'archived', 'MANUAL', 'READY', 'READY', FALSE, 'inactive') RETURNING id`,
      [tenant.rows[0].id],
    );
    await client.query(`INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id) VALUES ($1, $2, $3)`, [tenant.rows[0].id, archived.rows[0].id, assistant.rows[0].id]);
    for (const sourceId of [rawImage.rows[0].id, archived.rows[0].id]) {
      await client.query(
        `INSERT INTO knowledge_chunks (tenant_id, source_id, chunk_index, normalized_text, text_hash, token_estimate,
           embedding, embedding_provider, embedding_model, embedding_version, embedding_dimensions, index_status, is_active)
         VALUES ($1, $2, 0, '200 m² bahçe fiyatı 150.000–250.000 TL', $3, 8, $4::vector,
                 'FIXTURE', 'fixture', 'v1', 1536, 'READY', TRUE)`,
        [tenant.rows[0].id, sourceId, `${sourceId}`.replace(/-/g, '').padEnd(64, 'a').slice(0, 64), vector()],
      );
    }

    // Execute the production migration statement against real PostgreSQL so
    // historical materialized sources regain only their explicit source scope.
    const assistantScopeMigration = fs.readFileSync(new URL('../migrations/067_retain_materialized_source_assistant_scope.sql', import.meta.url), 'utf8');
    await client.query(assistantScopeMigration);
    await client.query(assistantScopeMigration);
    const scope = await client.query(`SELECT assistant_id FROM knowledge_source_assistants WHERE tenant_id = $1 AND source_id = $2`, [tenant.rows[0].id, materialized.rows[0].id]);
    assert.deepEqual(scope.rows.map((row) => row.assistant_id), [assistant.rows[0].id]);

    const embed = async () => Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
    const matches = await retrieveApprovedKnowledge({
      database: client,
      embed,
      tenantId: tenant.rows[0].id,
      assistantId: assistant.rows[0].id,
      query: '200 m² bahçe için peyzaj ve sulama yaklaşık ne kadar tutar?',
      limit: 6,
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceId, materialized.rows[0].id);
    assert.equal(matches[0].similarity, 1);

    const otherMatches = await retrieveApprovedKnowledge({
      database: client,
      embed,
      tenantId: otherTenant.rows[0].id,
      assistantId: otherAssistant.rows[0].id,
      query: '200 m² bahçe için peyzaj ve sulama yaklaşık ne kadar tutar?',
      limit: 6,
    });
    assert.deepEqual(otherMatches, []);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});


test('real PostgreSQL retrieves canonical pricing knowledge across active profile scope and isolates tenants', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Yeşil Vadi Acceptance Tenant', 'STARTER') RETURNING id`);
    const otherTenant = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Yeşil Vadi Isolation Tenant', 'STARTER') RETURNING id`);
    const assistant = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Yesil Vadi', 'active') RETURNING id`, [tenant.rows[0].id]);
    const siblingAssistant = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Other Identity Assistant', 'active') RETURNING id`, [tenant.rows[0].id]);
    const otherAssistant = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'External Assistant', 'active') RETURNING id`, [otherTenant.rows[0].id]);

    const identity = await client.query(
      `INSERT INTO business_identities (tenant_id, display_name, normalized_identity, status)
       VALUES ($1, 'Yeşil Vadi Peyzaj', 'yesil vadi peyzaj', 'ACTIVE') RETURNING id`,
      [tenant.rows[0].id],
    );
    const otherIdentity = await client.query(
      `INSERT INTO business_identities (tenant_id, display_name, normalized_identity, status)
       VALUES ($1, 'Başka Şirket', 'baska sirket', 'ACTIVE') RETURNING id`,
      [tenant.rows[0].id],
    );

    // Raw image: READY, Index DISABLED, NOT assigned to any assistant
    const rawImage = await client.query(
      `INSERT INTO knowledge_base_documents (tenant_id, title, content, source_type, mime_type, processing_status, indexing_status, enabled)
       VALUES ($1, 'whasatpp.png', 'raw whatsapp screenshot extraction', 'DOCUMENT', 'image/png', 'READY', 'DISABLED', TRUE) RETURNING id`,
      [tenant.rows[0].id],
    );
    await client.query(
      `INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id) VALUES ($1, $2, $3)`,
      [tenant.rows[0].id, rawImage.rows[0].id, identity.rows[0].id],
    );

    const pricingText = '200 m² bahçe için peyzaj tasarımı, bitkilendirme ve otomatik sulama sistemi projeleri genellikle 150.000–250.000 TL aralığındadır.';

    // Canonical materialized source from approved candidate: READY / Index READY / Provenance verified
    const candidate = await client.query(
      `INSERT INTO knowledge_candidates (tenant_id, assistant_id, candidate_type, proposed_title, proposed_content, status, pii_redaction_status, image_semantic_version)
       VALUES ($1, NULL, 'PRICING', 'Canonical image-derived business fact', $2, 'APPROVED', 'PASSED', '1') RETURNING id`,
      [tenant.rows[0].id, pricingText],
    );
    const materialized = await client.query(
      `INSERT INTO knowledge_base_documents (tenant_id, title, content, source_type, processing_status, indexing_status, enabled)
       VALUES ($1, 'Canonical image-derived business fact', $2, 'CONVERSATION_CANDIDATE', 'READY', 'READY', TRUE) RETURNING id`,
      [tenant.rows[0].id, pricingText],
    );
    await client.query(
      `INSERT INTO knowledge_materialized_source_provenance (tenant_id, materialized_source_id, candidate_id, original_source_id)
       VALUES ($1, $2, $3, $4)`,
      [tenant.rows[0].id, materialized.rows[0].id, candidate.rows[0].id, rawImage.rows[0].id],
    );
    await client.query(
      `INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id) VALUES ($1, $2, $3)`,
      [tenant.rows[0].id, materialized.rows[0].id, identity.rows[0].id],
    );

    await client.query(
      `INSERT INTO knowledge_chunks (tenant_id, source_id, chunk_index, normalized_text, text_hash, token_estimate,
         embedding, embedding_provider, embedding_model, embedding_version, embedding_dimensions, index_status, is_active, indexed_at)
       VALUES ($1, $2, 0, $3, repeat('b', 64), 16, $4::vector,
               'FIXTURE', 'fixture', 'v1', 1536, 'READY', TRUE, CURRENT_TIMESTAMP)`,
      [tenant.rows[0].id, materialized.rows[0].id, pricingText, vector(1)],
    );

    // Business Profile: APPROVED, ACTIVE, RESOLVED
    const profile = await client.query(
      `INSERT INTO business_profiles (tenant_id, business_identity_id)
       VALUES ($1, $2) RETURNING id`,
      [tenant.rows[0].id, identity.rows[0].id],
    );
    const profileVersion = await client.query(
      `INSERT INTO business_profile_versions (profile_id, tenant_id, profile_data, evidence, schema_version, status, identity_resolution_status, source_scope)
       VALUES ($1, $2, $3::jsonb, '[]'::jsonb, 2, 'APPROVED', 'RESOLVED', $4::jsonb) RETURNING id`,
      [
        profile.rows[0].id,
        tenant.rows[0].id,
        JSON.stringify({ pricing_information: pricingText }),
        JSON.stringify({ business_identity_id: identity.rows[0].id, source_ids: [materialized.rows[0].id] }),
      ],
    );
    await client.query(
      `UPDATE business_profiles SET active_version_id = $3, approved_version_id = $3 WHERE id = $1 AND tenant_id = $2`,
      [profile.rows[0].id, tenant.rows[0].id, profileVersion.rows[0].id],
    );

    // Assistant Configuration: ACTIVE
    const configVersion = await client.query(
      `INSERT INTO assistant_configuration_versions (tenant_id, assistant_id, configuration_data, source_profile_version_id, schema_version, status)
       VALUES ($1, $2, '{"assistant_identity":"Yesil Vadi"}'::jsonb, $3, 2, 'ACTIVE') RETURNING id`,
      [tenant.rows[0].id, assistant.rows[0].id, profileVersion.rows[0].id],
    );
    await client.query(
      `UPDATE ai_assistants SET active_configuration_version_id = $3 WHERE id = $1 AND tenant_id = $2`,
      [assistant.rows[0].id, tenant.rows[0].id, configVersion.rows[0].id],
    );

    // Sibling assistant has different identity/profile
    const otherProfile = await client.query(
      `INSERT INTO business_profiles (tenant_id, business_identity_id) VALUES ($1, $2) RETURNING id`,
      [tenant.rows[0].id, otherIdentity.rows[0].id],
    );
    const otherProfileVersion = await client.query(
      `INSERT INTO business_profile_versions (profile_id, tenant_id, profile_data, evidence, schema_version, status, identity_resolution_status, source_scope)
       VALUES ($1, $2, '{}'::jsonb, '[]'::jsonb, 2, 'APPROVED', 'RESOLVED', $3::jsonb) RETURNING id`,
      [otherProfile.rows[0].id, tenant.rows[0].id, JSON.stringify({ business_identity_id: otherIdentity.rows[0].id, source_ids: [] })],
    );
    const otherConfigVersion = await client.query(
      `INSERT INTO assistant_configuration_versions (tenant_id, assistant_id, configuration_data, source_profile_version_id, schema_version, status)
       VALUES ($1, $2, '{"assistant_identity":"Baska"}'::jsonb, $3, 2, 'ACTIVE') RETURNING id`,
      [tenant.rows[0].id, siblingAssistant.rows[0].id, otherProfileVersion.rows[0].id],
    );
    await client.query(
      `UPDATE ai_assistants SET active_configuration_version_id = $3 WHERE id = $1 AND tenant_id = $2`,
      [siblingAssistant.rows[0].id, tenant.rows[0].id, otherConfigVersion.rows[0].id],
    );

    // Run migration 069 (historical convergence) twice for idempotency
    const migration069 = fs.readFileSync(new URL('../migrations/069_canonical_assistant_knowledge_retrieval_scope.sql', import.meta.url), 'utf8');
    await client.query(migration069);
    await client.query(migration069);

    const assignments = await client.query(
      `SELECT source_id, assistant_id FROM knowledge_source_assistants WHERE tenant_id = $1 ORDER BY assistant_id`,
      [tenant.rows[0].id],
    );
    assert.deepEqual(assignments.rows, [{ source_id: materialized.rows[0].id, assistant_id: assistant.rows[0].id }]);

    const embed = async () => Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
    const retestQuestion = '200 m² bir bahçenin peyzaj tasarımı, bitkilendirmesi ve otomatik sulama sistemi yaklaşık ne kadar tutar?';

    // 1. Assistant Yesil Vadi retrieves the canonical pricing knowledge
    const matches = await retrieveApprovedKnowledge({
      database: client,
      embed,
      tenantId: tenant.rows[0].id,
      assistantId: assistant.rows[0].id,
      query: retestQuestion,
      limit: 6,
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceId, materialized.rows[0].id);
    assert.equal(matches[0].text, pricingText);

    // 2. Sibling assistant in same tenant with different identity/profile cannot retrieve it
    const siblingMatches = await retrieveApprovedKnowledge({
      database: client,
      embed,
      tenantId: tenant.rows[0].id,
      assistantId: siblingAssistant.rows[0].id,
      query: retestQuestion,
      limit: 6,
    });
    assert.deepEqual(siblingMatches, []);

    // 3. Other tenant assistant cannot retrieve it
    const otherMatches = await retrieveApprovedKnowledge({
      database: client,
      embed,
      tenantId: otherTenant.rows[0].id,
      assistantId: otherAssistant.rows[0].id,
      query: retestQuestion,
      limit: 6,
    });
    assert.deepEqual(otherMatches, []);

    // 4. Raw image is NEVER retrieved
    const allMatches = await retrieveApprovedKnowledge({
      database: client,
      embed,
      tenantId: tenant.rows[0].id,
      assistantId: assistant.rows[0].id,
      query: 'whatsapp screenshot',
      limit: 10,
    });
    assert.ok(allMatches.every((m) => m.sourceId !== rawImage.rows[0].id));

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

test('fresh tenant golden path automatically converges assistant scope across candidate approval and configuration activation', async () => {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ('Fresh Acceptance Tenant', 'STARTER') RETURNING id`);
    const tenantId = tenant.rows[0].id;
    const email = `fresh-${crypto.randomUUID()}@example.test`;
    const user = await client.query(`INSERT INTO users (email, email_normalized, password_hash, system_role) VALUES ($1, $1, 'hash', 'OWNER') RETURNING id`, [email]);
    const reviewerId = user.rows[0].id;

    const identity = await client.query(
      `INSERT INTO business_identities (tenant_id, display_name, normalized_identity, status)
       VALUES ($1, 'Fresh Peyzaj', 'fresh peyzaj', 'ACTIVE') RETURNING id`,
      [tenantId],
    );

    const rawImage = await client.query(
      `INSERT INTO knowledge_base_documents (tenant_id, title, content, content_hash, source_type, mime_type, processing_status, indexing_status, enabled)
       VALUES ($1, 'whatsapp.png', 'evidence text', repeat('c', 64), 'DOCUMENT', 'image/png', 'READY', 'DISABLED', TRUE) RETURNING id`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id) VALUES ($1, $2, $3)`,
      [tenantId, rawImage.rows[0].id, identity.rows[0].id],
    );

    const assistant = await client.query(`INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, 'Fresh Assistant', 'active') RETURNING id`, [tenantId]);
    const assistantId = assistant.rows[0].id;

    const pricingText = '200 m² bahçe için peyzaj tasarımı, bitkilendirme ve otomatik sulama sistemi projeleri genellikle 150.000–250.000 TL aralığındadır.';

    const segment = await client.query(
      `INSERT INTO knowledge_source_extraction_segments (
         tenant_id, source_id, extraction_version, extraction_hash, segment_order,
         role, role_confidence, normalized_text, extraction_method
       ) VALUES ($1, $2, 'fixture-v1', repeat('c', 64), 0, 'BUSINESS', 1, $3, 'FIXTURE')
       RETURNING id`,
      [tenantId, rawImage.rows[0].id, pricingText],
    );

    const candidate = await client.query(
      `INSERT INTO knowledge_candidates (tenant_id, assistant_id, candidate_type, proposed_title, proposed_content, status, pii_redaction_status, image_semantic_version)
       VALUES ($1, NULL, 'PRICING', 'Canonical image-derived business fact', $2, 'NEEDS_REVIEW', 'PASSED', '1') RETURNING id`,
      [tenantId, pricingText],
    );
    const candidateId = candidate.rows[0].id;
    await client.query(
      `INSERT INTO knowledge_candidate_image_evidence (tenant_id, candidate_id, source_id, segment_id, extraction_version, extraction_hash, segment_order, role, role_confidence, normalized_text, evidence_kind, business_identity_id)
       VALUES ($1, $2, $3, $4, 'fixture-v1', repeat('c', 64), 0, 'BUSINESS', 1, $5, 'PRIMARY', $6)`,
      [tenantId, candidateId, rawImage.rows[0].id, segment.rows[0].id, pricingText, identity.rows[0].id],
    );

    // Business Profile created and activated
    const profile = await client.query(`INSERT INTO business_profiles (tenant_id, business_identity_id) VALUES ($1, $2) RETURNING id`, [tenantId, identity.rows[0].id]);
    const profileVersion = await client.query(
      `INSERT INTO business_profile_versions (profile_id, tenant_id, profile_data, evidence, schema_version, status, identity_resolution_status, source_scope)
       VALUES ($1, $2, $3::jsonb, '[]'::jsonb, 2, 'APPROVED', 'RESOLVED', $4::jsonb) RETURNING id`,
      [profile.rows[0].id, tenantId, JSON.stringify({ pricing_information: pricingText }), JSON.stringify({ business_identity_id: identity.rows[0].id, source_ids: [] })],
    );
    await client.query(`UPDATE business_profiles SET active_version_id = $3, approved_version_id = $3 WHERE id = $1 AND tenant_id = $2`, [profile.rows[0].id, tenantId, profileVersion.rows[0].id]);

    // Assistant configuration activated
    const configVersion = await client.query(
      `INSERT INTO assistant_configuration_versions (tenant_id, assistant_id, configuration_data, source_profile_version_id, schema_version, status)
       VALUES ($1, $2, '{"assistant_identity":"Fresh Assistant"}'::jsonb, $3, 2, 'APPROVED') RETURNING id`,
      [tenantId, assistantId, profileVersion.rows[0].id],
    );
    await activateAssistantConfigurationVersion({ database: client, tenantId, assistantId, versionId: configVersion.rows[0].id, activatedBy: reviewerId });

    // Canonical candidate approved through the canonical service path
    const materializedSource = await approveConversationKnowledgeCandidate({ database: client, tenantId, candidateId, reviewedBy: reviewerId });
    assert.ok(materializedSource?.id);

    // Index the canonical materialized source
    await client.query(
      `UPDATE knowledge_base_documents SET processing_status = 'READY', indexing_status = 'READY' WHERE id = $1 AND tenant_id = $2`,
      [materializedSource.id, tenantId],
    );
    await client.query(
      `INSERT INTO knowledge_chunks (tenant_id, source_id, chunk_index, normalized_text, text_hash, token_estimate,
         embedding, embedding_provider, embedding_model, embedding_version, embedding_dimensions, index_status, is_active, indexed_at)
       VALUES ($1, $2, 0, $3, repeat('d', 64), 16, $4::vector,
               'FIXTURE', 'fixture', 'v1', 1536, 'READY', TRUE, CURRENT_TIMESTAMP)`,
      [tenantId, materializedSource.id, pricingText, vector(1)],
    );

    // Natural runtime retrieval succeeds without manual database repair
    const embed = async () => Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
    const matches = await retrieveApprovedKnowledge({
      database: client,
      embed,
      tenantId,
      assistantId,
      query: '200 m² bir bahçenin peyzaj tasarımı, bitkilendirmesi ve otomatik sulama sistemi yaklaşık ne kadar tutar?',
      limit: 6,
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceId, materializedSource.id);
    assert.equal(matches[0].text, pricingText);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});
