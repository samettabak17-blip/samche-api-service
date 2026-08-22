import { randomUUID } from 'crypto';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
const tenantId = process.env.SAMCHEGUIDE_TENANT_ID;
const assistantId = process.env.SAMCHEGUIDE_ASSISTANT_ID || null;

if (!connectionString || !tenantId) {
  console.error('SAMCHEGUIDE_MAPPING: CONFIGURATION_REQUIRED');
  process.exit(1);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuidPattern.test(tenantId) || (assistantId && !uuidPattern.test(assistantId))) {
  console.error('SAMCHEGUIDE_MAPPING: INVALID_CONFIGURATION');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT id FROM tenants WHERE id = $1 AND status = $2', [tenantId, 'active']);
    if (!tenant.rowCount) throw new Error('TENANT_NOT_FOUND');

    const assistant = assistantId
      ? await client.query('SELECT id FROM ai_assistants WHERE id = $1 AND tenant_id = $2 AND status = $3', [assistantId, tenantId, 'active'])
      : await client.query('SELECT id FROM ai_assistants WHERE tenant_id = $1 AND status = $2 ORDER BY created_at ASC LIMIT 1', [tenantId, 'active']);
    if (!assistant.rowCount) throw new Error('ASSISTANT_NOT_FOUND');

    const channel = await client.query(
      `INSERT INTO tenant_channels
        (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
       VALUES ($1, $2, 'SAMCHEGUIDE', 'Samcheguide', 'samcheguide:staging', 'active')
       ON CONFLICT (tenant_id, channel_type, external_channel_id)
       DO UPDATE SET assistant_id = EXCLUDED.assistant_id, status = 'active', updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [tenantId, assistant.rows[0].id]
    );

    await client.query(
      `INSERT INTO channel_integrations
        (id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
       VALUES ($1, 'SAMCHEGUIDE:staging', 'SAMCHEGUIDE', $2, $3, $4, TRUE)
       ON CONFLICT (integration_key)
       DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         channel_id = EXCLUDED.channel_id,
         assistant_id = EXCLUDED.assistant_id,
         enabled = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [randomUUID(), tenantId, channel.rows[0].id, assistant.rows[0].id]
    );
    await client.query('COMMIT');
    console.log('SAMCHEGUIDE_MAPPING: READY');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`SAMCHEGUIDE_MAPPING: ${error.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
