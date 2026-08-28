import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { whatsappIntegrationKey } from '../services/whatsapp-multimodal-service.js';
import { assertVerifiedTls, safeResultLine, strictTlsConfig } from './staging-task6-e2e-support.js';

const API_ORIGIN = 'https://samche-api-staging.onrender.com';

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error('TASK6_ASSIGNMENT_AUDIT_ENV_MISSING');
  return value;
}

async function main() {
  const sourceTitle = required('TASK6_AUDIT_SOURCE_TITLE');
  const marker = required('TASK6_AUDIT_MARKER');
  const database = new pg.Pool(strictTlsConfig(required('STAGING_DATABASE_URL')));
  const client = await database.connect();
  try {
    assertVerifiedTls(client);
    await client.query('BEGIN');
    await client.query('SET TRANSACTION READ ONLY');
    const sourceResult = await client.query(
      `SELECT id, tenant_id, assistant_id, processing_status, indexing_status, enabled
         FROM knowledge_base_documents
        WHERE lower(title) = lower($1)
        ORDER BY updated_at DESC`,
      [sourceTitle],
    );
    if (sourceResult.rowCount !== 1) throw new Error('TASK6_ASSIGNMENT_AUDIT_SOURCE_NOT_UNIQUE');
    const source = sourceResult.rows[0];
    const mappingResult = await client.query(
      `SELECT tenant_id, assistant_id, channel_id
         FROM channel_integrations
        WHERE integration_type = 'WHATSAPP' AND integration_key = $1 AND enabled = TRUE`,
      [whatsappIntegrationKey(required('STAGING_WHATSAPP_PHONE_ID'))],
    );
    if (mappingResult.rowCount !== 1) throw new Error('TASK6_ASSIGNMENT_AUDIT_MAPPING_INVALID');
    const mapping = mappingResult.rows[0];
    if (mapping.tenant_id !== source.tenant_id) throw new Error('TASK6_ASSIGNMENT_AUDIT_TENANT_MISMATCH');

    const assignments = await client.query(
      `SELECT assistant_id FROM knowledge_source_assistants
        WHERE tenant_id = $1 AND source_id = $2 ORDER BY assistant_id`,
      [source.tenant_id, source.id],
    );
    const legacyRuntime = await client.query(
      `SELECT id FROM knowledge_base_documents
        WHERE id = $3 AND tenant_id = $1 AND status = 'active'
          AND (assistant_id IS NULL OR assistant_id = $2)`,
      [source.tenant_id, mapping.assistant_id, source.id],
    );
    const chunks = await client.query(
      `SELECT count(*)::integer AS count FROM knowledge_chunks
        WHERE tenant_id = $1 AND source_id = $2 AND is_active = TRUE
          AND index_status = 'READY' AND normalized_text ILIKE $3`,
      [source.tenant_id, source.id, `%${marker}%`],
    );
    const history = await client.query(
      `SELECT count(*)::integer AS count
         FROM conversation_messages message
         JOIN conversations conversation
           ON conversation.id = message.conversation_id AND conversation.tenant_id = message.tenant_id
        WHERE message.tenant_id = $1 AND conversation.channel_id = $2 AND message.content ILIKE $3`,
      [source.tenant_id, mapping.channel_id, `%${marker}%`],
    );
    const artifacts = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM business_profile_versions version
           JOIN business_profiles profile ON profile.id = version.profile_id AND profile.tenant_id = version.tenant_id
          WHERE version.tenant_id = $1 AND profile.active_version_id = version.id AND version.profile_data::text ILIKE $3) AS active_profile_count,
         (SELECT count(*)::integer FROM assistant_configuration_versions version
           JOIN ai_assistants assistant ON assistant.id = version.assistant_id AND assistant.tenant_id = version.tenant_id
          WHERE version.tenant_id = $1 AND version.assistant_id = $2
            AND assistant.active_configuration_version_id = version.id AND version.configuration_data::text ILIKE $3) AS active_config_count,
         (SELECT count(*)::integer FROM assistant_knowledge_recommendations
          WHERE tenant_id = $1 AND assistant_id = $2 AND recommendation_data::text ILIKE $3) AS recommendation_count`,
      [source.tenant_id, mapping.assistant_id, `%${marker}%`],
    );

    const response = await fetch(`${API_ORIGIN}/api/v1/tenants/${source.tenant_id}/knowledge-intelligence/assistants/${mapping.assistant_id}/retrieval-preview`, {
      method: 'POST',
      headers: { authorization: `Bearer ${required('STAGING_ADMIN_TOKEN')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'What is the Enterprise Support Verification Code?' }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`TASK6_ASSIGNMENT_AUDIT_PREVIEW_HTTP_${response.status}`);
    const preview = await response.json();
    const previewIncludesSource = (preview?.preview?.matches ?? []).some((match) => match.sourceId === source.id);
    const artifact = artifacts.rows[0];
    console.log(safeResultLine('PASS', 'ASSIGNMENT_AUDIT', {
      assignment_count: assignments.rowCount,
      whatsapp_assignment_present: assignments.rows.some((row) => row.assistant_id === mapping.assistant_id),
      retrieval_preview_includes_source: previewIncludesSource,
      legacy_runtime_includes_source: legacyRuntime.rowCount === 1,
      fresh_history_prompt_would_include_source: legacyRuntime.rowCount === 1,
      marker_chunk_count: chunks.rows[0].count,
      conversation_history_marker_count: history.rows[0].count,
      active_profile_marker_count: artifact.active_profile_count,
      active_config_marker_count: artifact.active_config_count,
      recommendation_marker_count: artifact.recommendation_count,
      source_processing_status: source.processing_status,
      source_indexing_status: source.indexing_status,
      source_enabled: source.enabled,
      legacy_assistant_id_is_null: source.assistant_id === null,
    }));
    await client.query('ROLLBACK');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve safe failure */ }
    const code = /^TASK6_ASSIGNMENT_AUDIT_/.test(String(error?.message)) ? error.message : 'TASK6_ASSIGNMENT_AUDIT_FAILED';
    console.error(safeResultLine('FAIL', 'ASSIGNMENT_AUDIT', { status: code }));
    process.exitCode = 1;
  } finally {
    client.release();
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
