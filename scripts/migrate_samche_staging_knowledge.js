import { createHash, randomUUID } from 'node:crypto';
import {
  SAMCHE_CANONICAL_MASTER_POLICY_HASH,
  SAMCHE_BUSINESS_IDENTITY,
  SAMCHE_KNOWLEDGE_SOURCES,
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';
import { chunkKnowledgeText } from '../services/knowledge-intelligence-service.js';

export async function executeSamcheStagingKnowledgeMigration({
  database,
  tenantId,
  actorUserId = null,
  embedder = null,
}) {
  if (!database || typeof database.query !== 'function') {
    throw new Error('MIGRATION_DATABASE_REQUIRED');
  }
  if (!tenantId) {
    throw new Error('MIGRATION_TENANT_ID_REQUIRED');
  }

  const client = database.connect ? await database.connect() : database;
  const shouldRelease = Boolean(database.connect);

  try {
    if (client.query) await client.query('BEGIN');

    // 1. Resolve or create Business Identity
    const identityRes = await client.query(
      `INSERT INTO business_identities (id, tenant_id, display_name, normalized_identity, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       ON CONFLICT (tenant_id, normalized_identity)
       DO UPDATE SET display_name = EXCLUDED.display_name, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
       RETURNING id, display_name, normalized_identity, status`,
      [randomUUID(), tenantId, SAMCHE_BUSINESS_IDENTITY.displayName, SAMCHE_BUSINESS_IDENTITY.normalizedIdentity]
    );
    const businessIdentity = identityRes.rows[0];

    // 2. Ingest 7 Knowledge Sources
    const createdSources = [];
    const sourceIds = [];

    for (const src of SAMCHE_KNOWLEDGE_SOURCES) {
      const contentHash = createHash('sha256').update(src.content, 'utf8').digest('hex');
      const docRes = await client.query(
        `INSERT INTO knowledge_base_documents (
           id, tenant_id, title, content, status, source_type,
           mime_type, content_hash, processing_status, indexing_status, enabled, uploaded_by
         ) VALUES (
           $1, $2, $3, $4, 'active', 'MANUAL',
           'text/plain', $5, 'READY', 'READY', TRUE, $6
         )
         RETURNING id, title, content_hash, source_type, processing_status`,
        [randomUUID(), tenantId, src.title, src.content, contentHash, actorUserId]
      );
      const sourceRow = docRes.rows[0];
      createdSources.push(sourceRow);
      sourceIds.push(sourceRow.id);

      await client.query(
        `INSERT INTO knowledge_source_business_identities (tenant_id, source_id, business_identity_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, source_id, business_identity_id) DO NOTHING`,
        [tenantId, sourceRow.id, businessIdentity.id]
      );

      const chunks = chunkKnowledgeText(src.content, { maxCharacters: 1400, overlapCharacters: 180 });
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO knowledge_chunks (
             tenant_id, source_id, chunk_index, section_title, normalized_text,
             text_hash, token_estimate, embedding_model, embedding_version,
             embedding_dimensions, index_status, is_active, indexed_at
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, 'text-embedding-3-small', '2026-08-27',
             1536, 'READY', TRUE, CURRENT_TIMESTAMP
           )
           ON CONFLICT (tenant_id, source_id, embedding_model, embedding_version, chunk_index, text_hash)
           DO UPDATE SET normalized_text = EXCLUDED.normalized_text,
                         index_status = 'READY', is_active = TRUE, updated_at = CURRENT_TIMESTAMP`,
          [tenantId, sourceRow.id, chunk.chunkIndex, src.title, chunk.text, chunk.textHash, chunk.tokenEstimate]
        );
      }
    }

    // 3. Upsert Business Profile and approved Business Profile Version
    const profileRes = await client.query(
      `INSERT INTO business_profiles (id, tenant_id, business_identity_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, business_identity_id)
       DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id, tenant_id, active_version_id`,
      [randomUUID(), tenantId, businessIdentity.id]
    );
    const profile = profileRes.rows[0];

    const sourceScope = {
      business_identity_id: businessIdentity.id,
      source_ids: sourceIds,
    };

    const bpVersionRes = await client.query(
      `INSERT INTO business_profile_versions (
         id, tenant_id, profile_id, schema_version, profile_data, evidence,
         source_scope, identity_resolution_status, generated_by, status,
         reviewed_by, reviewed_at
       ) VALUES (
         $1, $2, $3, 2, $4::jsonb, $5::jsonb,
         $6::jsonb, 'RESOLVED', 'HUMAN', 'APPROVED',
         $7, CURRENT_TIMESTAMP
       )
       RETURNING id, schema_version, status, identity_resolution_status`,
      [
        randomUUID(),
        tenantId,
        profile.id,
        JSON.stringify(SAMCHE_STAGING_BUSINESS_PROFILE),
        JSON.stringify(createdSources.map((s) => ({ source_id: s.id, title: s.title }))),
        JSON.stringify(sourceScope),
        actorUserId,
      ]
    );
    const bpVersion = bpVersionRes.rows[0];

    await client.query(
      `UPDATE business_profiles
          SET active_version_id = $1, activated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND tenant_id = $3`,
      [bpVersion.id, profile.id, tenantId]
    );

    // 4. Staging Candidate Assistant (independent testable candidate)
    const assistantRes = await client.query(
      `INSERT INTO ai_assistants (id, tenant_id, name, model, status)
       VALUES ($1, $2, 'SamChe AI Staging Candidate', 'gemini-2.5-pro', 'active')
       ON CONFLICT (tenant_id, name)
       DO UPDATE SET model = 'gemini-2.5-pro', status = 'active', updated_at = CURRENT_TIMESTAMP
       RETURNING id, name, model, status, active_configuration_version_id`,
      [randomUUID(), tenantId]
    );
    const stagingAssistant = assistantRes.rows[0];

    // 5. Assistant Configuration Version for staging candidate
    const configRes = await client.query(
      `INSERT INTO assistant_configuration_versions (
         id, tenant_id, assistant_id, schema_version, configuration_data,
         source_profile_version_id, generated_by, status, approved_by, approved_at,
         activated_by, activated_at
       ) VALUES (
         $1, $2, $3, 2, $4::jsonb,
         $5, 'HUMAN', 'ACTIVE', $6, CURRENT_TIMESTAMP,
         $6, CURRENT_TIMESTAMP
       )
       RETURNING id, schema_version, status, activated_at`,
      [
        randomUUID(),
        tenantId,
        stagingAssistant.id,
        JSON.stringify(SAMCHE_STAGING_ASSISTANT_CONFIG),
        bpVersion.id,
        actorUserId,
      ]
    );
    const configVersion = configRes.rows[0];

    await client.query(
      `UPDATE ai_assistants
          SET active_configuration_version_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND tenant_id = $3`,
      [configVersion.id, stagingAssistant.id, tenantId]
    );

    for (const sId of sourceIds) {
      await client.query(
        `INSERT INTO knowledge_source_assistants (tenant_id, source_id, assistant_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, source_id, assistant_id) DO NOTHING`,
        [tenantId, sId, stagingAssistant.id]
      );
    }

    if (client.query) await client.query('COMMIT');

    return {
      success: true,
      masterPolicyCanonicalHash: SAMCHE_CANONICAL_MASTER_POLICY_HASH,
      businessIdentity,
      knowledgeSourcesCount: createdSources.length,
      createdSources,
      businessProfileId: profile.id,
      businessProfileVersionId: bpVersion.id,
      stagingAssistantId: stagingAssistant.id,
      assistantConfigurationVersionId: configVersion.id,
      status: 'ACTIVE_FOR_STAGING_CANDIDATE',
    };
  } catch (err) {
    if (client.query) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (shouldRelease && client.release) client.release();
  }
}
