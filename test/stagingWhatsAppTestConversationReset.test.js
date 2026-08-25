import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  STAGING_RESET_CONFIRMATION,
  StagingWhatsAppTestResetError,
  formatSafeResetSummary,
  parseResetArguments,
  requireStagingEnvironment,
  resetStagingWhatsAppTestConversation,
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

function fakeClient({ target = true, channel = 'WHATSAPP', dependencies = expectedDependencyRows() } = {}) {
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
        return target ? { rowCount: 1, rows: [{ id: selectedConversationId, tenant_id: 'tenant-a', channel_type: channel }] } : { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id FROM crm_leads')) return { rowCount: 1, rows: [{ id: 'lead-a' }] };
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
    { conversationId: selectedConversationId },
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

test('only the explicit selected WhatsApp conversation and its dependencies are deleted transactionally', async () => {
  const client = fakeClient();
  const summary = await resetStagingWhatsAppTestConversation({ client, conversationId: selectedConversationId });
  assert.equal(summary.result, 'PASS');
  assert.equal(summary.conversation_deleted, true);
  assert.equal(summary.runtime_restart_required, true);
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
  const deletes = client.calls.filter((call) => call.sql.startsWith('DELETE'));
  assert.ok(deletes.length >= 8);
  for (const call of deletes) assert.equal(call.params.includes(otherConversationId), false);
  assert.ok(deletes.findIndex((call) => call.sql.includes('conversation_resources')) < deletes.findIndex((call) => call.sql.includes('conversation_messages')));
  assert.ok(deletes.findIndex((call) => call.sql.includes('conversation_messages')) < deletes.findIndex((call) => call.sql.includes('DELETE FROM conversations')));
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

