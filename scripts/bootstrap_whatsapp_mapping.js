import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.STAGING_DATABASE_URL;
const tenantId = process.env.STAGING_WHATSAPP_TENANT_ID;

if (!connectionString || !tenantId) {
  console.error('WHATSAPP_MAPPING: CONFIGURATION_REQUIRED');
  process.exit(1);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
  console.error('WHATSAPP_MAPPING: INVALID_CONFIGURATION');
  process.exit(1);
}
function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('whatsapp-bootstrap:' || $1::text))", [tenantId]);

    const tenant = await client.query(
      'SELECT id FROM tenants WHERE id = $1 AND status = $2 FOR UPDATE',
      [tenantId, 'active']
    );
    if (tenant.rowCount !== 1) fail('TENANT_NOT_FOUND');

    const channels = await client.query(
      `SELECT tc.id, tc.external_channel_id, tc.assistant_id, tc.status,
              a.id AS resolved_assistant_id, a.status AS assistant_status
         FROM tenant_channels tc
         LEFT JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
        WHERE tc.tenant_id = $1
          AND tc.channel_type = 'WHATSAPP'
          AND tc.external_channel_id IS NOT NULL
        FOR UPDATE OF tc`,
      [tenantId]
    );
    if (channels.rowCount === 0) fail('WHATSAPP_CHANNEL_NOT_FOUND');
    if (channels.rowCount > 1) fail('WHATSAPP_CHANNEL_AMBIGUOUS');
    const channel = channels.rows[0];
    if (channel.status !== 'active') fail('WHATSAPP_CHANNEL_INACTIVE');
    if (!channel.resolved_assistant_id || channel.assistant_status !== 'active') fail('WHATSAPP_ASSISTANT_NOT_READY');

    const integrationKey = 'WHATSAPP:' + channel.external_channel_id;
    const existing = await client.query(
      'SELECT id, tenant_id FROM channel_integrations WHERE integration_key = $1 FOR UPDATE',
      [integrationKey]
    );
    if (existing.rowCount && existing.rows[0].tenant_id !== tenantId) fail('MAPPING_TENANT_MISMATCH');

    const mapping = await client.query(
      `INSERT INTO channel_integrations
        (id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
       VALUES ($1, $2, 'WHATSAPP', $3, $4, $5, TRUE)
       ON CONFLICT (integration_key)
       DO UPDATE SET channel_id = EXCLUDED.channel_id,
                     assistant_id = EXCLUDED.assistant_id,
                     enabled = TRUE,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING id, tenant_id, channel_id, assistant_id, enabled`,
      [randomUUID(), integrationKey, tenantId, channel.id, channel.resolved_assistant_id]
    );

    const verified = await client.query(
      `SELECT ci.tenant_id, ci.channel_id, ci.assistant_id, ci.enabled,
              tc.channel_type, tc.status AS channel_status, a.status AS assistant_status
         FROM channel_integrations ci
         JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
         JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
        WHERE ci.id = $1 AND ci.integration_type = 'WHATSAPP'
        FOR UPDATE`,
      [mapping.rows[0].id]
    );
    const row = verified.rows[0];
    if (!row || row.tenant_id !== tenantId || row.channel_id !== channel.id ||
        row.assistant_id !== channel.resolved_assistant_id || row.enabled !== true ||
        row.channel_type !== 'WHATSAPP' || row.channel_status !== 'active' ||
        row.assistant_status !== 'active') fail('MAPPING_VERIFICATION_FAILED');

    await client.query('COMMIT');
    console.log('WHATSAPP_MAPPING: READY');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('WHATSAPP_MAPPING: ' + (error?.code || 'BOOTSTRAP_FAILED'));
    process.exitCode = 1;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
