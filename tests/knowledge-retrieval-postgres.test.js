import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, test } from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import { retrieveApprovedKnowledge } from '../services/knowledge-intelligence-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('KNOWLEDGE_RETRIEVAL_POSTGRES_REQUIRES_TEST_DATABASE_URL');
if (!isSafeTestDatabaseUrl(connectionString)) throw new Error('KNOWLEDGE_RETRIEVAL_POSTGRES_REFUSES_NON_ISOLATED_TEST_DATABASE');

const { Pool } = pg;
const database = new Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: 'strict', nodeEnv: 'test' }),
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
