import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { createConversationResourceStorage } from '../services/conversation-resource-storage.js';
import { assertVerifiedTls, readFixtureState, safeResultLine, strictTlsConfig } from './staging-task6-e2e-support.js';

const DELETE_TABLES = [
  'knowledge_candidate_evidence', 'knowledge_gap_signals', 'knowledge_gaps',
  'assistant_configuration_versions', 'assistant_knowledge_recommendations',
  'business_profile_versions', 'business_profiles', 'knowledge_generation_runs',
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
  for (const object of state.storageObjects ?? []) {
    const expectedPrefix = `knowledge/${object.tenantId}/${object.sourceId}/`;
    if (!tenantIds.includes(String(object.tenantId)) || !uniqueIds(state.sourceIds).includes(String(object.sourceId)) || !String(object.key).startsWith(expectedPrefix)) {
      throw new Error('TASK6_E2E_STORAGE_OWNERSHIP_MISMATCH');
    }
  }
}

export async function cleanupFixture({ database, storage, state }) {
  const tenantIds = validateState(state);
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
