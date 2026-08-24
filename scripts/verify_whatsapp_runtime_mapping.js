import pg from 'pg';
import {
  getWhatsAppRuntimeDatabaseFingerprint,
  resolveWhatsAppIntegration,
} from '../services/whatsapp-live-inbox-service.js';
import { whatsappIntegrationKey } from '../services/whatsapp-multimodal-service.js';

const { Pool } = pg;
const connectionString = process.env.STAGING_DATABASE_URL;
const tenantId = process.env.STAGING_WHATSAPP_TENANT_ID;
const phoneNumberId = process.env.STAGING_WHATSAPP_PHONE_ID;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function shortId(value) {
  return typeof value === 'string' && value.length >= 8 ? value.slice(0, 8) : 'unknown';
}

if (!connectionString || !tenantId || !phoneNumberId) fail('CONFIGURATION_REQUIRED');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) fail('INVALID_TENANT_ID');
if (!/^\d{6,32}$/.test(phoneNumberId)) fail('INVALID_PHONE_NUMBER_ID');

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
const key = whatsappIntegrationKey(phoneNumberId);

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const fingerprint = await getWhatsAppRuntimeDatabaseFingerprint(client);
    if (fingerprint === 'unavailable') fail('DATABASE_IDENTITY_UNAVAILABLE');

    const mapping = await client.query(
      `SELECT ci.tenant_id, ci.channel_id, ci.assistant_id, ci.enabled, ci.integration_type,
              tc.channel_type, tc.external_channel_id, tc.status AS channel_status,
              a.status AS assistant_status
         FROM channel_integrations ci
         JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
         JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
        WHERE ci.integration_key = $1
        LIMIT 2`,
      [key]
    );
    if (mapping.rowCount !== 1) fail('EXACT_MAPPING_NOT_FOUND');
    const row = mapping.rows[0];
    if (
      row.tenant_id !== tenantId ||
      row.integration_type !== 'WHATSAPP' ||
      row.enabled !== true ||
      row.channel_type !== 'WHATSAPP' ||
      row.external_channel_id !== phoneNumberId ||
      row.channel_status !== 'active' ||
      row.assistant_status !== 'active'
    ) fail('EXACT_MAPPING_INVALID');

    const resolved = await resolveWhatsAppIntegration(client, phoneNumberId);
    if (
      !resolved ||
      resolved.tenant_id !== row.tenant_id ||
      resolved.channel_id !== row.channel_id ||
      resolved.assistant_id !== row.assistant_id
    ) fail('RUNTIME_RESOLVER_MISMATCH');

    await client.query('COMMIT');
    console.log(
      'WHATSAPP_RUNTIME_MAPPING: READY ' +
      '(db_identity=' + fingerprint +
      '; tenant=' + shortId(row.tenant_id) +
      '; channel=' + shortId(row.channel_id) +
      '; assistant=' + shortId(row.assistant_id) +
      '; key_exact=1; resolver=READY)'
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('WHATSAPP_RUNTIME_MAPPING: ' + (error?.code || 'VERIFICATION_FAILED'));
    process.exitCode = 1;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
