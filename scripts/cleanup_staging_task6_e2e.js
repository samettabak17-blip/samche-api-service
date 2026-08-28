import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { createConversationResourceStorage } from '../services/conversation-resource-storage.js';
import { assertVerifiedTls, readFixtureState, safeResultLine, strictTlsConfig } from './staging-task6-e2e-support.js';

const DELETE_TABLES = [
  'knowledge_candidate_evidence', 'knowledge_gap_signals', 'knowledge_gaps',
  'assistant_configuration_versions', 'assistant_knowledge_recommendations',
  'business_profile_versions', 'business_profiles', 'knowledge_generation_runs',
  'business_identity_source_evidence', 'knowledge_source_business_identities', 'business_identities',
  'knowledge_candidates', 'knowledge_source_assistants', 'knowledge_chunks',
  'knowledge_processing_jobs', 'knowledge_base_documents',
  'crm_lead_analyses', 'crm_activities', 'crm_deals', 'crm_leads',
  'conversation_resources', 'conversation_audit_events', 'conversation_messages', 'conversations',
  'crm_pipeline_stages', 'crm_companies', 'crm_contacts', 'channel_integrations',
  'tenant_channels', 'ai_assistants', 'tenant_users',
];

function uniqueIds(values = []) {
  return [...new Set(values.map(String))];
}

function validateState(state) {
  if (!/^TASK6_E2E_\d{1,20}_\d{1,6}$/.test(String(state?.marker ?? ''))) throw new Error('TASK6_E2E_STATE_INVALID');
  const tenantIds = uniqueIds(state.tenantIds);
  if (tenantIds.length < 1 || tenantIds.length > 3) throw new Error('TASK6_E2E_STATE_INVALID');
  return tenantIds;
}

async function verifyOwnership(client, state, tenantIds) {
  const result = await client.query('SELECT id, name FROM tenants WHERE id = ANY($1::uuid[]) ORDER BY id', [tenantIds]);
  if (result.rows.length !== tenantIds.length || result.rows.some((row) => !String(row.name).startsWith(state.marker))) {
    throw new Error('TASK6_E2E_OWNERSHIP_MISMATCH');
  }
  const scopedTenantIds = uniqueIds(state.scopedTenantIds);
  if (scopedTenantIds.length) {
    const sources = await client.query(
      'SELECT id, tenant_id, title FROM knowledge_base_documents WHERE id = ANY($1::uuid[]) AND tenant_id = ANY($2::uuid[])',
      [uniqueIds(state.scopedSourceIds), scopedTenantIds],
    );
    if (sources.rows.length !== uniqueIds(state.scopedSourceIds).length || sources.rows.some((row) => !String(row.title).startsWith(state.marker))) {
      throw new Error('TASK6_E2E_SCOPED_SOURCE_OWNERSHIP_MISMATCH');
    }
  }
  if (uniqueIds(state.scopedConversationIds).length) {
    const conversations = await client.query(
      `SELECT DISTINCT c.id
         FROM conversations c
         JOIN conversation_messages m ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id
        WHERE c.id = ANY($1::uuid[]) AND c.tenant_id = ANY($2::uuid[]) AND m.content LIKE $3`,
      [uniqueIds(state.scopedConversationIds), scopedTenantIds, `%${state.marker}%`],
    );
    if (conversations.rows.length !== uniqueIds(state.scopedConversationIds).length) throw new Error('TASK6_E2E_SCOPED_CONVERSATION_OWNERSHIP_MISMATCH');
  }
  if (uniqueIds(state.scopedMessageIds).length) {
    const messages = await client.query(
      `SELECT message.id
         FROM conversation_messages message
        WHERE message.id = ANY($1::uuid[]) AND message.tenant_id = ANY($2::uuid[])
          AND EXISTS (
            SELECT 1 FROM conversation_messages anchor
             WHERE anchor.tenant_id = message.tenant_id AND anchor.conversation_id = message.conversation_id
               AND anchor.external_message_id LIKE $3
          )`,
      [uniqueIds(state.scopedMessageIds), scopedTenantIds, `%${state.marker}%`],
    );
    if (messages.rows.length !== uniqueIds(state.scopedMessageIds).length) throw new Error('TASK6_E2E_SCOPED_MESSAGE_OWNERSHIP_MISMATCH');
  }
  const scopedIntegrationIds = uniqueIds(state.scopedIntegrationIds);
  const scopedChannelIds = uniqueIds(state.scopedChannelIds);
  if (scopedIntegrationIds.length || scopedChannelIds.length) {
    const mappings = await client.query(
      `SELECT ci.id AS integration_id, ci.integration_key, tc.id AS channel_id, tc.display_name
         FROM channel_integrations ci
         JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
        WHERE ci.tenant_id = ANY($1::uuid[])
          AND ci.id = ANY($2::uuid[])
          AND tc.id = ANY($3::uuid[])`,
      [scopedTenantIds, scopedIntegrationIds, scopedChannelIds],
    );
    if (mappings.rows.length !== scopedIntegrationIds.length
      || mappings.rows.length !== scopedChannelIds.length
      || mappings.rows.some((row) => !String(row.integration_key).startsWith(state.marker) || !String(row.display_name).startsWith(state.marker))) {
      throw new Error('TASK6_E2E_SCOPED_CHANNEL_OWNERSHIP_MISMATCH');
    }
  }
  for (const object of state.storageObjects ?? []) {
    const expectedPrefix = `knowledge/${object.tenantId}/${object.sourceId}/`;
    const allowedTenants = new Set([...tenantIds, ...scopedTenantIds]);
    const allowedSources = new Set([...uniqueIds(state.sourceIds), ...uniqueIds(state.scopedSourceIds)]);
    if (!allowedTenants.has(String(object.tenantId)) || !allowedSources.has(String(object.sourceId)) || !String(object.key).startsWith(expectedPrefix)) {
      throw new Error('TASK6_E2E_STORAGE_OWNERSHIP_MISMATCH');
    }
  }
}

export async function cleanupFixture({ database, storage, state }) {
  const tenantIds = validateState(state);
  const scopedIntegrationIds = uniqueIds(state.scopedIntegrationIds);
  const scopedChannelIds = uniqueIds(state.scopedChannelIds);
  const client = await database.connect();
  try {
    await verifyOwnership(client, state, tenantIds);
    await client.query('BEGIN');
    await client.query('UPDATE ai_assistants SET active_configuration_version_id = NULL WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
    await client.query('UPDATE business_profiles SET active_version_id = NULL, approved_version_id = NULL WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
    await client.query('UPDATE business_profile_versions SET superseded_by_version_id = NULL WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
    await client.query('UPDATE knowledge_gaps SET suggested_candidate_id = NULL WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
    await client.query('UPDATE knowledge_candidates SET approved_source_id = NULL WHERE tenant_id = ANY($1::uuid[])', [tenantIds]);
    for (const object of state.storageObjects ?? []) await storage.remove({ key: object.key });
    const scopedConversationIds = uniqueIds(state.scopedConversationIds);
    if (scopedConversationIds.length) {
      const scopedContacts = await client.query('SELECT DISTINCT contact_id FROM conversations WHERE tenant_id = ANY($1::uuid[]) AND id = ANY($2::uuid[]) AND contact_id IS NOT NULL', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      await client.query('DELETE FROM crm_lead_analyses WHERE tenant_id = ANY($1::uuid[]) AND conversation_id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      await client.query('DELETE FROM crm_activities WHERE tenant_id = ANY($1::uuid[]) AND conversation_id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      await client.query('DELETE FROM crm_deals WHERE tenant_id = ANY($1::uuid[]) AND lead_id IN (SELECT id FROM crm_leads WHERE conversation_id = ANY($2::uuid[]))', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      await client.query('DELETE FROM crm_leads WHERE tenant_id = ANY($1::uuid[]) AND conversation_id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      await client.query('DELETE FROM conversation_resources WHERE tenant_id = ANY($1::uuid[]) AND conversation_id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      await client.query('DELETE FROM conversation_audit_events WHERE tenant_id = ANY($1::uuid[]) AND conversation_id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      await client.query('DELETE FROM conversation_messages WHERE tenant_id = ANY($1::uuid[]) AND conversation_id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      await client.query('DELETE FROM conversations WHERE tenant_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedConversationIds]);
      for (const { contact_id: contactId } of scopedContacts.rows) {
        await client.query('DELETE FROM crm_contacts WHERE id = $1 AND tenant_id = ANY($2::uuid[]) AND NOT EXISTS (SELECT 1 FROM conversations WHERE contact_id = $1) AND NOT EXISTS (SELECT 1 FROM crm_leads WHERE contact_id = $1)', [contactId, uniqueIds(state.scopedTenantIds)]);
      }
    }
    const scopedMessageIds = uniqueIds(state.scopedMessageIds);
    if (scopedMessageIds.length) {
      await client.query('DELETE FROM conversation_resources WHERE tenant_id = ANY($1::uuid[]) AND message_id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedMessageIds]);
      for (const auditId of uniqueIds(state.scopedAuditIds)) await client.query('DELETE FROM conversation_audit_events WHERE id = $1', [auditId]);
      await client.query('DELETE FROM conversation_messages WHERE tenant_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedMessageIds]);
    }
    if (scopedIntegrationIds.length) await client.query('DELETE FROM channel_integrations WHERE tenant_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedIntegrationIds]);
    if (scopedChannelIds.length) await client.query('DELETE FROM tenant_channels WHERE tenant_id = ANY($1::uuid[]) AND id = ANY($2::uuid[])', [uniqueIds(state.scopedTenantIds), scopedChannelIds]);
    for (const scopedTenantId of uniqueIds(state.scopedTenantIds)) {
      const scopedSourceIds = uniqueIds(state.scopedSourceIds);
      if (scopedSourceIds.length) {
        await client.query('DELETE FROM knowledge_base_documents WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [scopedTenantId, scopedSourceIds]);
      }
    }
    for (const table of DELETE_TABLES) await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
    await client.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
    for (const userId of uniqueIds(state.userIds)) await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId]]);
    await client.query('COMMIT');
    const remaining = await client.query('SELECT id FROM tenants WHERE id = ANY($1::uuid[])', [tenantIds]);
    if (remaining.rowCount) throw new Error('TASK6_E2E_CLEANUP_REMAINS');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original safe failure */ }
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const statePath = process.env.TASK6_E2E_STATE_PATH;
  if (!statePath || !process.env.STAGING_DATABASE_URL) throw new Error('TASK6_E2E_CLEANUP_ENV_MISSING');
  const state = await readFixtureState(statePath);
  const database = new pg.Pool(strictTlsConfig(process.env.STAGING_DATABASE_URL));
  const probe = await database.connect();
  try { assertVerifiedTls(probe); } finally { probe.release(); }
  try {
    await cleanupFixture({ database, storage: createConversationResourceStorage(), state });
    console.log(safeResultLine('PASS', 'CLEANUP', { status: 'ZERO_REMNANTS' }));
  } finally {
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safeCode = /^TASK6_E2E_|^TLS_VERIFICATION_FAILED$/.test(String(error?.message)) ? error.message : 'TASK6_E2E_CLEANUP_FAILED';
    console.error(safeResultLine('FAIL', 'CLEANUP', { status: safeCode }));
    process.exitCode = 1;
  });
}
