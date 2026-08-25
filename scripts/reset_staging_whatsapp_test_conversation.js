import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const STAGING_RESET_CONFIRMATION = 'RESET-STAGING-TEST-CONVERSATION';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_CONVERSATION_ID_TABLES = new Set([
  'conversation_audit_events',
  'conversation_messages',
  'conversation_resources',
  'crm_activities',
  'crm_lead_analyses',
  'crm_leads',
]);

export class StagingWhatsAppTestResetError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new StagingWhatsAppTestResetError(code);
}

export function parseResetArguments(argv = process.argv.slice(2)) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--conversation-id', '--confirm-staging'].includes(flag) || !value || values.has(flag)) {
      fail('STAGING_RESET_ARGUMENTS_INVALID');
    }
    values.set(flag, value);
  }
  const conversationId = values.get('--conversation-id');
  if (!conversationId) fail('STAGING_RESET_TARGET_REQUIRED');
  if (!UUID_PATTERN.test(conversationId)) fail('STAGING_RESET_TARGET_INVALID');
  if (values.get('--confirm-staging') !== STAGING_RESET_CONFIRMATION) fail('STAGING_RESET_CONFIRMATION_REQUIRED');
  return { conversationId };
}

export function requireStagingEnvironment(env = process.env) {
  if (env.STAGING_RESET_ENVIRONMENT !== 'staging') fail('STAGING_RESET_ENVIRONMENT_REQUIRED');
  if (!env.STAGING_DATABASE_URL) fail('STAGING_RESET_DATABASE_REQUIRED');
  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(env.STAGING_DATABASE_URL).pathname.replace(/^\//, ''));
  } catch {
    fail('STAGING_RESET_DATABASE_INVALID');
  }
  if (!databaseName) fail('STAGING_RESET_DATABASE_INVALID');
  return { connectionString: env.STAGING_DATABASE_URL, databaseName };
}

export async function verifyStagingDatabaseIdentity(client, expectedDatabaseName) {
  const identity = await client.query('SELECT current_database() AS database_name, current_schema() AS schema_name');
  if (identity.rowCount !== 1 || identity.rows[0].database_name !== expectedDatabaseName || identity.rows[0].schema_name !== 'public') {
    fail('STAGING_RESET_DATABASE_IDENTITY_MISMATCH');
  }
}

async function assertKnownConversationDependencies(client) {
  const columns = await client.query(
    `SELECT table_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND column_name = 'conversation_id'
      ORDER BY table_name`
  );
  const discovered = new Set(columns.rows.map((row) => row.table_name));
  const unknown = [...discovered].filter((tableName) => !EXPECTED_CONVERSATION_ID_TABLES.has(tableName));
  const missing = [...EXPECTED_CONVERSATION_ID_TABLES].filter((tableName) => !discovered.has(tableName));
  if (unknown.length || missing.length) fail('STAGING_RESET_CONVERSATION_DEPENDENCY_MISMATCH');

  const foreignKeys = await client.query(
    `SELECT child.relname AS table_name
       FROM pg_constraint constraint
       JOIN pg_class child ON child.oid = constraint.conrelid
       JOIN pg_namespace namespace ON namespace.oid = child.relnamespace
      WHERE constraint.contype = 'f'
        AND namespace.nspname = current_schema()
        AND constraint.confrelid IN ('conversations'::regclass, 'conversation_messages'::regclass)
      ORDER BY child.relname`
  );
  const unsupported = foreignKeys.rows
    .map((row) => row.table_name)
    .filter((tableName) => !EXPECTED_CONVERSATION_ID_TABLES.has(tableName));
  if (unsupported.length) fail('STAGING_RESET_FOREIGN_KEY_MISMATCH');
}

async function resolveTargetConversation(client, conversationId) {
  const result = await client.query(
    `SELECT c.id, c.tenant_id, c.contact_id, channel.channel_type
       FROM conversations c
       JOIN tenant_channels channel ON channel.id = c.channel_id AND channel.tenant_id = c.tenant_id
      WHERE c.id = $1
      FOR UPDATE`,
    [conversationId]
  );
  if (result.rowCount === 0) fail('STAGING_RESET_CONVERSATION_NOT_FOUND');
  if (result.rowCount !== 1) fail('STAGING_RESET_CONVERSATION_AMBIGUOUS');
  if (result.rows[0].channel_type !== 'WHATSAPP') fail('STAGING_RESET_CHANNEL_REQUIRED');
  return result.rows[0];
}

async function countCrmDependencies(client, tenantId, conversationId, contactId) {
  try {
    const result = await client.query(
      `WITH selected_leads AS (
         SELECT id
           FROM crm_leads
          WHERE tenant_id = $1 AND conversation_id = $2
       )
       SELECT
         (SELECT COUNT(*)::integer FROM selected_leads) AS crm_leads,
         (SELECT COUNT(*)::integer FROM crm_activities
           WHERE tenant_id = $1 AND (conversation_id = $2 OR lead_id IN (SELECT id FROM selected_leads))) AS crm_activities,
         (SELECT COUNT(*)::integer FROM crm_lead_analyses
           WHERE tenant_id = $1 AND (conversation_id = $2 OR lead_id IN (SELECT id FROM selected_leads))) AS crm_analysis,
         (SELECT COUNT(*)::integer FROM crm_deals
           WHERE tenant_id = $1 AND lead_id IN (SELECT id FROM selected_leads)) AS crm_deals,
         (CASE WHEN $3::uuid IS NULL THEN 0 ELSE 1 END)::integer AS crm_contact_associations`,
      [tenantId, conversationId, contactId]
    );
    if (result.rowCount !== 1) fail('STAGING_RESET_CRM_DEPENDENCY_CHECK_FAILED');
    const row = result.rows[0];
    const counts = {
      crm_leads: Number(row.crm_leads ?? 0),
      crm_deals: Number(row.crm_deals ?? 0),
      crm_activities: Number(row.crm_activities ?? 0),
      crm_analysis: Number(row.crm_analysis ?? 0),
      crm_contact_associations: Number(row.crm_contact_associations ?? 0),
    };
    return { ...counts, crm_dependency_count: Object.values(counts).reduce((total, value) => total + value, 0) };
  } catch (error) {
    if (error instanceof StagingWhatsAppTestResetError) throw error;
    fail('STAGING_RESET_CRM_DEPENDENCY_CHECK_FAILED');
  }
}

function count(result) {
  return Number(result?.rowCount ?? 0);
}

export async function resetStagingWhatsAppTestConversation({ client, conversationId }) {
  if (!client?.query) fail('STAGING_RESET_CLIENT_REQUIRED');
  if (!UUID_PATTERN.test(conversationId ?? '')) fail('STAGING_RESET_TARGET_INVALID');

  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('staging-whatsapp-test-conversation-reset:' || $1::text))", [conversationId]);
    await assertKnownConversationDependencies(client);
    const target = await resolveTargetConversation(client, conversationId);
    const tenantId = target.tenant_id;
    const crmDependencies = await countCrmDependencies(client, tenantId, conversationId, target.contact_id);
    if (crmDependencies.crm_dependency_count > 0) {
      await client.query('ROLLBACK');
      return {
        result: 'REFUSED',
        reason: 'CRM_DEPENDENCIES_PRESENT',
        ...crmDependencies,
      };
    }
    const audits = await client.query(
      'DELETE FROM conversation_audit_events WHERE tenant_id = $1 AND conversation_id = $2',
      [tenantId, conversationId]
    );
    const resources = await client.query(
      'DELETE FROM conversation_resources WHERE tenant_id = $1 AND conversation_id = $2',
      [tenantId, conversationId]
    );
    const messages = await client.query(
      'DELETE FROM conversation_messages WHERE tenant_id = $1 AND conversation_id = $2',
      [tenantId, conversationId]
    );
    const conversation = await client.query(
      'DELETE FROM conversations WHERE tenant_id = $1 AND id = $2',
      [tenantId, conversationId]
    );
    if (conversation.rowCount !== 1) fail('STAGING_RESET_CONVERSATION_DELETE_FAILED');
    await client.query('COMMIT');
    return {
      result: 'PASS',
      conversation_found: true,
      channel: 'WHATSAPP',
      conversation_deleted: true,
      messages_removed: count(messages),
      resources_removed: count(resources),
      audit_events_removed: count(audits),
      runtime_restart_required: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export function formatSafeResetSummary(summary) {
  return 'STAGING_WHATSAPP_TEST_RESET ' + JSON.stringify(summary);
}

export function safeResetFailureResult(error) {
  const code = error instanceof StagingWhatsAppTestResetError ? error.code : error?.code;
  const reasonByCode = {
    STAGING_RESET_CRM_DEPENDENCY_CHECK_FAILED: 'DEPENDENCY_CHECK_FAILED',
    STAGING_RESET_CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
    STAGING_RESET_CHANNEL_REQUIRED: 'NON_WHATSAPP_CONVERSATION',
    STAGING_RESET_DATABASE_IDENTITY_MISMATCH: 'DATABASE_IDENTITY_MISMATCH',
    STAGING_RESET_ENVIRONMENT_REQUIRED: 'INVALID_STAGING_ENVIRONMENT',
    STAGING_RESET_DATABASE_REQUIRED: 'INVALID_STAGING_ENVIRONMENT',
    STAGING_RESET_DATABASE_INVALID: 'INVALID_STAGING_ENVIRONMENT',
    STAGING_RESET_CONVERSATION_DEPENDENCY_MISMATCH: 'UNEXPECTED_SCHEMA_DEPENDENCY',
    STAGING_RESET_FOREIGN_KEY_MISMATCH: 'UNEXPECTED_SCHEMA_DEPENDENCY',
  };
  const databaseDependencyCodes = new Set(['42P01', '42703', '42883']);
  return {
    result: 'FAIL',
    reason: reasonByCode[code] ?? (databaseDependencyCodes.has(code) ? 'DEPENDENCY_CHECK_FAILED' : 'TRANSACTION_FAILED'),
  };
}

export async function main({ env = process.env, argv = process.argv.slice(2), Pool = null } = {}) {
  const { conversationId } = parseResetArguments(argv);
  const { connectionString, databaseName } = requireStagingEnvironment(env);
  const PoolConstructor = Pool ?? (await import('pg')).default.Pool;
  const pool = new PoolConstructor({ connectionString, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await verifyStagingDatabaseIdentity(client, databaseName);
    const summary = await resetStagingWhatsAppTestConversation({ client, conversationId });
    console.log(formatSafeResetSummary(summary));
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(formatSafeResetSummary(safeResetFailureResult(error)));
    process.exitCode = 1;
  });
}

