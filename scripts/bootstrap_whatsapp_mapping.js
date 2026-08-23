import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.STAGING_DATABASE_URL;
const tenantId = process.env.STAGING_WHATSAPP_TENANT_ID;
const phoneNumberId = process.env.STAGING_WHATSAPP_PHONE_ID;
const integrationKey = phoneNumberId ? 'WHATSAPP:' + phoneNumberId : null;
const runtimeAssistant = { name: 'SamChe WhatsApp Runtime', model: 'gemini-2.5-pro' };

if (!connectionString || !tenantId || !phoneNumberId) {
  console.error('WHATSAPP_MAPPING: CONFIGURATION_REQUIRED');
  process.exit(1);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
  console.error('WHATSAPP_MAPPING: INVALID_CONFIGURATION');
  process.exit(1);
}
function fail(code) { const error = new Error(code); error.code = code; throw error; }
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function resolveAssistant(client) {
  const assistants = await client.query(
    `SELECT id, status FROM ai_assistants
      WHERE tenant_id = $1 AND name = $2 AND model = $3 FOR UPDATE`,
    [tenantId, runtimeAssistant.name, runtimeAssistant.model]
  );
  if (assistants.rowCount > 1) fail('WHATSAPP_ASSISTANT_AMBIGUOUS');
  if (assistants.rowCount === 1) {
    if (assistants.rows[0].status !== 'active') fail('WHATSAPP_ASSISTANT_INACTIVE');
    return { assistant: assistants.rows[0], outcome: 'resolved' };
  }
  const created = await client.query(
    `INSERT INTO ai_assistants (tenant_id, name, model, status)
     VALUES ($1, $2, $3, 'active') RETURNING id, status`,
    [tenantId, runtimeAssistant.name, runtimeAssistant.model]
  );
  return { assistant: created.rows[0], outcome: 'created' };
}

async function resolveChannel(client, assistantId) {
  const samePhoneElsewhere = await client.query(
    `SELECT tc.tenant_id FROM tenant_channels tc
      WHERE tc.channel_type = 'WHATSAPP' AND tc.external_channel_id = $1
      FOR UPDATE`,
    [phoneNumberId]
  );
  if (samePhoneElsewhere.rowCount && samePhoneElsewhere.rows.some((row) => row.tenant_id !== tenantId)) {
    fail('WHATSAPP_CHANNEL_TENANT_MISMATCH');
  }

  const channels = await client.query(
    `SELECT id, assistant_id, status FROM tenant_channels
      WHERE tenant_id = $1 AND channel_type = 'WHATSAPP' AND external_channel_id = $2
      FOR UPDATE`,
    [tenantId, phoneNumberId]
  );
  if (channels.rowCount > 1) fail('WHATSAPP_CHANNEL_AMBIGUOUS');
  if (channels.rowCount === 1) {
    const channel = channels.rows[0];
    if (channel.status !== 'active') fail('WHATSAPP_CHANNEL_INACTIVE');
    if (channel.assistant_id !== assistantId) {
      const updated = await client.query(
        `UPDATE tenant_channels SET assistant_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND tenant_id = $3 RETURNING id, assistant_id, status`,
        [assistantId, channel.id, tenantId]
      );
      return { channel: updated.rows[0], outcome: 'resolved' };
    }
    return { channel, outcome: 'resolved' };
  }
  const created = await client.query(
    `INSERT INTO tenant_channels
      (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
     VALUES ($1, $2, 'WHATSAPP', 'SamChe WhatsApp', $3, 'active')
     RETURNING id, assistant_id, status`,
    [tenantId, assistantId, phoneNumberId]
  );
  return { channel: created.rows[0], outcome: 'created' };
}

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('whatsapp-bootstrap:' || $1::text))", [tenantId]);
    const tenant = await client.query('SELECT id FROM tenants WHERE id = $1 AND status = $2 FOR UPDATE', [tenantId, 'active']);
    if (tenant.rowCount !== 1) fail('TENANT_NOT_FOUND');

    const assistant = await resolveAssistant(client);
    const channel = await resolveChannel(client, assistant.assistant.id);
    const existing = await client.query('SELECT id, tenant_id FROM channel_integrations WHERE integration_key = $1 FOR UPDATE', [integrationKey]);
    if (existing.rowCount && existing.rows[0].tenant_id !== tenantId) fail('MAPPING_TENANT_MISMATCH');

    const mapping = await client.query(
      `INSERT INTO channel_integrations
        (id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
       VALUES ($1, $2, 'WHATSAPP', $3, $4, $5, TRUE)
       ON CONFLICT (integration_key)
       DO UPDATE SET channel_id = EXCLUDED.channel_id, assistant_id = EXCLUDED.assistant_id,
                     enabled = TRUE, updated_at = CURRENT_TIMESTAMP
       RETURNING id, tenant_id, channel_id, assistant_id, enabled`,
      [randomUUID(), integrationKey, tenantId, channel.channel.id, assistant.assistant.id]
    );
    const verified = await client.query(
      `SELECT ci.tenant_id, ci.channel_id, ci.assistant_id, ci.enabled,
              tc.channel_type, tc.status channel_status, a.status assistant_status, a.model
         FROM channel_integrations ci
         JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
         JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
        WHERE ci.id = $1 AND ci.integration_type = 'WHATSAPP' FOR UPDATE`,
      [mapping.rows[0].id]
    );
    const row = verified.rows[0];
    if (!row || row.tenant_id !== tenantId || row.channel_id !== channel.channel.id ||
        row.assistant_id !== assistant.assistant.id || row.enabled !== true ||
        row.channel_type !== 'WHATSAPP' || row.channel_status !== 'active' ||
        row.assistant_status !== 'active' || row.model !== runtimeAssistant.model) fail('MAPPING_VERIFICATION_FAILED');
    await client.query('COMMIT');
    console.log('WHATSAPP_MAPPING: READY (assistant=' + assistant.outcome + '; channel=' + channel.outcome + ')');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('WHATSAPP_MAPPING: ' + (error?.code || 'BOOTSTRAP_FAILED'));
    process.exitCode = 1;
  } finally { client.release(); }
} finally { await pool.end(); }
