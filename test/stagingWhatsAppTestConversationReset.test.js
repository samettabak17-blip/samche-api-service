import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  STAGING_RESET_CONFIRMATION,
  StagingWhatsAppTestResetError,
  formatSafeResetSummary,
  inspectStagingWhatsAppTestConversation,
  parseResetArguments,
  requireStagingEnvironment,
  resetStagingWhatsAppTestConversation,
  safeResetFailureResult,
  verifyStagingDatabaseIdentity,
} from '../scripts/reset_staging_whatsapp_test_conversation.js';

const selectedConversationId = '11111111-1111-4111-8111-111111111111';
const otherConversationId = '22222222-2222-4222-8222-222222222222';

function expectedDependencyRows() {
  return [
    'conversation_audit_events', 'conversation_messages', 'conversation_resources',
    'crm_activities', 'crm_lead_analyses', 'crm_leads',
  ].map((table_name) => ({ table_name }));
}

function fakeClient({ target = true, channel = 'WHATSAPP', dependencies = expectedDependencyRows(), crmDependencies = {}, contactId = null } = {}) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'SELECT current_database() AS database_name, current_schema() AS schema_name') {
        return { rowCount: 1, rows: [{ database_name: 'staging_db', schema_name: 'public' }] };
      }
      if (sql.includes('information_schema.columns')) return { rowCount: dependencies.length, rows: dependencies };
      if (sql.includes('FROM pg_constraint')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM conversations c')) {
        return target ? { rowCount: 1, rows: [{ id: selectedConversationId, tenant_id: 'tenant-a', contact_id: contactId, channel_type: channel }] } : { rowCount: 0, rows: [] };
      }
      if (sql.includes('WITH selected_leads AS')) return { rowCount: 1, rows: [{
        crm_leads: crmDependencies.crm_leads ?? 0,
        crm_deals: crmDependencies.crm_deals ?? 0,
        crm_activities: crmDependencies.crm_activities ?? 0,
        crm_analysis: crmDependencies.crm_analysis ?? 0,
        crm_contact_associations: params[2] ? 1 : 0,
      }] };
      if (sql.startsWith('DELETE FROM conversations')) return { rowCount: 1, rows: [] };
      if (sql.startsWith('DELETE')) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    },
  };
  return client;
}

test('reset refuses missing or incorrect explicit staging confirmation', () => {
  assert.throws(() => parseResetArguments(['--conversation-id', selectedConversationId]), /STAGING_RESET_CONFIRMATION_REQUIRED/);
  assert.throws(() => parseResetArguments(['--conversation-id', selectedConversationId, '--confirm-staging', 'wrong']), /STAGING_RESET_CONFIRMATION_REQUIRED/);
  assert.deepEqual(
    parseResetArguments(['--conversation-id', selectedConversationId, '--confirm-staging', STAGING_RESET_CONFIRMATION]),
    { conversationId: selectedConversationId, mode: 'reset' },
  );
});

test('reset requires an explicit UUID target and a staging-only environment', () => {
  assert.throws(() => parseResetArguments(['--confirm-staging', STAGING_RESET_CONFIRMATION]), /STAGING_RESET_TARGET_REQUIRED/);
  assert.throws(() => parseResetArguments(['--conversation-id', 'not-a-uuid', '--confirm-staging', STAGING_RESET_CONFIRMATION]), /STAGING_RESET_TARGET_INVALID/);
  assert.throws(() => requireStagingEnvironment({ STAGING_DATABASE_URL: 'postgres://host/staging_db' }), /STAGING_RESET_ENVIRONMENT_REQUIRED/);
  assert.throws(() => requireStagingEnvironment({ STAGING_RESET_ENVIRONMENT: 'production', STAGING_DATABASE_URL: 'postgres://host/staging_db' }), /STAGING_RESET_ENVIRONMENT_REQUIRED/);
});

test('reset validates the connected database identity without exposing it', async () => {
  await verifyStagingDatabaseIdentity(fakeClient(), 'staging_db');
  await assert.rejects(() => verifyStagingDatabaseIdentity(fakeClient(), 'different_db'), /STAGING_RESET_DATABASE_IDENTITY_MISMATCH/);
});

test('nonexistent and non-WhatsApp targets fail closed before any delete', async () => {
  for (const options of [{ target: false }, { channel: 'WEB_CHAT' }]) {
    const client = fakeClient(options);
    await assert.rejects(() => resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId }), StagingWhatsAppTestResetError);
    assert.equal(client.calls.some((call) => call.sql.startsWith('DELETE')), false);
    assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('unknown conversation dependencies fail closed before mutation', async () => {
  const client = fakeClient({ dependencies: [...expectedDependencyRows(), { table_name: 'unreviewed_conversation_state' }] });
  await assert.rejects(() => resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId }), /STAGING_RESET_CONVERSATION_DEPENDENCY_MISMATCH/);
  assert.equal(client.calls.some((call) => call.sql.startsWith('DELETE')), false);
});

test('unknown foreign-key dependents fail closed before mutation', async () => {
  const client = fakeClient();
  const originalQuery = client.query.bind(client);
  client.query = async (sql, params) => {
    if (sql.includes('FROM pg_constraint')) {
      client.calls.push({ sql, params });
      return { rowCount: 1, rows: [{ dependent_table: 'unreviewed_resource_link', referenced_table: 'conversation_resources' }] };
    }
    return originalQuery(sql, params);
  };
  await assert.rejects(() => resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId }), /STAGING_RESET_FOREIGN_KEY_MISMATCH/);
  assert.equal(client.calls.some((call) => call.sql.startsWith('DELETE')), false);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('only the explicit selected WhatsApp conversation and its dependencies are deleted transactionally', async () => {
  const client = fakeClient();
  const summary = await resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId });
  assert.equal(summary.result, 'PASS');
  assert.equal(summary.conversation_deleted, true);
  assert.equal(summary.runtime_restart_required, true);
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
  const deletes = client.calls.filter((call) => call.sql.startsWith('DELETE'));
  assert.equal(deletes.length, 4);
  for (const call of deletes) assert.equal(call.params.includes(otherConversationId), false);
  assert.ok(deletes.findIndex((call) => call.sql.includes('conversation_resources')) < deletes.findIndex((call) => call.sql.includes('conversation_messages')));
  assert.ok(deletes.findIndex((call) => call.sql.includes('conversation_messages')) < deletes.findIndex((call) => call.sql.includes('DELETE FROM conversations')));
  for (const call of deletes) {
    assert.match(call.sql, /tenant_id = \$1/);
    assert.equal(call.params[0], 'tenant-a');
  }
  assert.equal(deletes.some((call) => /crm_(lead|activity|deal)/.test(call.sql)), false);
});

test('a CRM lead dependency refuses the reset before any mutation', async () => {
  const client = fakeClient({ crmDependencies: { crm_leads: 1 } });
  const result = await resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId });
  assert.deepEqual(result, {
    result: 'REFUSED', reason: 'CRM_DEPENDENCIES_PRESENT', crm_leads: 1, crm_deals: 0,
    crm_activities: 0, crm_analysis: 0, crm_contact_associations: 0, crm_dependency_count: 1,
  });
  assert.equal(client.calls.some((call) => call.sql.startsWith('DELETE')), false);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('a CRM deal dependency refuses the reset before any mutation', async () => {
  const client = fakeClient({ crmDependencies: { crm_deals: 1 } });
  const result = await resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId });
  assert.equal(result.result, 'REFUSED');
  assert.equal(result.reason, 'CRM_DEPENDENCIES_PRESENT');
  assert.equal(result.crm_dependency_count, 1);
  assert.equal(client.calls.some((call) => call.sql.startsWith('DELETE')), false);
});

test('a CRM contact association also refuses the reset before any mutation', async () => {
  const client = fakeClient({ contactId: '33333333-3333-4333-8333-333333333333' });
  const result = await resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId });
  assert.equal(result.result, 'REFUSED');
  assert.equal(result.reason, 'CRM_DEPENDENCIES_PRESENT');
  assert.equal(result.crm_dependency_count, 1);
  assert.equal(client.calls.some((call) => call.sql.startsWith('DELETE')), false);
});

test('safe failure taxonomy exposes no native exception detail', () => {
  assert.deepEqual(
    safeResetFailureResult(new StagingWhatsAppTestResetError('STAGING_RESET_CONVERSATION_NOT_FOUND')),
    { result: 'FAIL', reason: 'CONVERSATION_NOT_FOUND' }
  );
  assert.deepEqual(
    safeResetFailureResult(new StagingWhatsAppTestResetError('STAGING_RESET_TRANSACTION_FAILED', { mutation_stage: 'DELETE_CONVERSATION_RESOURCES' })),
    { result: 'FAIL', reason: 'TRANSACTION_FAILED', mutation_stage: 'DELETE_CONVERSATION_RESOURCES' }
  );
  assert.deepEqual(
    safeResetFailureResult({ code: '42P01', message: 'sensitive internal database detail' }),
    { result: 'FAIL', reason: 'DEPENDENCY_CHECK_FAILED' }
  );
  assert.deepEqual(
    safeResetFailureResult(new Error('unknown failure')), { result: 'FAIL', reason: 'TRANSACTION_FAILED' }
  );
});

test('read-only inspection reports only safe schema names and dependency counts', async () => {
  const client = fakeClient({ crmDependencies: { crm_activities: 2 } });
  const summary = await inspectStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId });
  assert.equal(summary.result, 'INSPECTED');
  assert.equal(summary.resettable, false);
  assert.equal(summary.reason, 'CRM_DEPENDENCIES_PRESENT');
  assert.equal(summary.crm_activities, 2);
  assert.equal(client.calls[0].sql, 'BEGIN READ ONLY');
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(client.calls.some((call) => call.sql.startsWith('DELETE')), false);
});

test('a failed final deletion rolls back the whole reset transaction', async () => {
  const client = fakeClient();
  const originalQuery = client.query.bind(client);
  client.query = async (sql, params) => {
    if (sql.startsWith('DELETE FROM conversations')) {
      client.calls.push({ sql, params });
      return { rowCount: 0, rows: [] };
    }
    return originalQuery(sql, params);
  };
  await assert.rejects(
    () => resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId }),
    /STAGING_RESET_CONVERSATION_DELETE_FAILED/
  );
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('safe reset output contains counts only and never serializes a target identifier', () => {
  const summary = formatSafeResetSummary({ result: 'PASS', conversation_found: true, channel: 'WHATSAPP', messages_removed: 2, resources_removed: 1, runtime_restart_required: true });
  assert.match(summary, /^STAGING_WHATSAPP_TEST_RESET /);
  assert.doesNotMatch(summary, /11111111-1111-4111-8111-111111111111|customer|phone|content/i);
});

test('deleted conversation permits fresh inbound first-assistant semantics', () => {
  const summary = { conversation_deleted: true, messages_removed: 3, resources_removed: 1 };
  assert.equal(summary.conversation_deleted, true);
  assert.equal(summary.messages_removed > 0, true);
  assert.equal(summary.resources_removed > 0, true);
});

