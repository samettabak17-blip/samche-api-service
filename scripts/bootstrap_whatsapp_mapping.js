import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.STAGING_DATABASE_URL;
const tenantId = process.env.STAGING_WHATSAPP_TENANT_ID;
const phoneNumberId = process.env.STAGING_WHATSAPP_PHONE_ID;
const tenantDisplayName = process.env.STAGING_WHATSAPP_TENANT_NAME;
const integrationKey = phoneNumberId ? 'WHATSAPP:' + phoneNumberId : null;
const runtimeAssistant = { name: 'SamChe AI', model: 'gemini-2.5-pro' };
const legacyRuntimeAssistantName = 'SamChe WhatsApp Runtime';
const masterPolicy = readFileSync(new URL('../policies/samche-whatsapp-master-business-policy.tr.txt', import.meta.url), 'utf8');
const deterministicResponseTemplates = JSON.parse(
  readFileSync(new URL('../policies/samche-whatsapp-deterministic-responses.json', import.meta.url), 'utf8')
);
// Only CRLF-to-LF and one terminal LF are canonicalized for policy integrity.
function canonicalizePolicyNewlines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\n$/, '');
}
function policyLineCount(value) {
  return value.length === 0 ? 0 : value.split('\n').length;
}
const masterPolicyCanonical = canonicalizePolicyNewlines(masterPolicy);
const masterPolicyRawSha256 = createHash('sha256').update(masterPolicy, 'utf8').digest('hex');
const masterPolicyCanonicalSha256 = createHash('sha256').update(masterPolicyCanonical, 'utf8').digest('hex');
const expectedMasterPolicyCanonicalSha256 = 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58';

if (!connectionString || !tenantId || !phoneNumberId || !tenantDisplayName) {
  console.error('WHATSAPP_MAPPING: CONFIGURATION_REQUIRED');
  process.exit(1);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
  console.error('WHATSAPP_MAPPING: INVALID_CONFIGURATION');
  process.exit(1);
}
if (masterPolicyCanonicalSha256 !== expectedMasterPolicyCanonicalSha256) {
  console.error('WHATSAPP_MAPPING: MASTER_POLICY_INTEGRITY_FAILED');
  process.exit(1);
}
function hasRequiredDeterministicTemplates(value) {
  return ['tr', 'en', 'ar'].every((language) =>
    typeof value?.first_contact?.[language] === 'string' &&
    typeof value?.social?.greeting?.[language] === 'string' &&
    typeof value?.social?.thanks?.[language] === 'string'
  );
}

function fail(code) { const error = new Error(code); error.code = code; throw error; }
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function resolveAssistant(client) {
  const integrationAssistant = await client.query(
    `SELECT ci.assistant_id, a.status
       FROM channel_integrations ci
       JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
      WHERE ci.integration_key = $1 AND ci.tenant_id = $2
      FOR UPDATE`,
    [integrationKey, tenantId]
  );
  if (integrationAssistant.rowCount > 1) fail('WHATSAPP_ASSISTANT_AMBIGUOUS');

  const candidates = integrationAssistant.rowCount
    ? integrationAssistant
    : await client.query(
      `SELECT id, status
         FROM ai_assistants
        WHERE tenant_id = $1
          AND model = $2
          AND name IN ($3, $4)
        ORDER BY CASE WHEN name = $3 THEN 0 ELSE 1 END
        FOR UPDATE`,
      [tenantId, runtimeAssistant.model, runtimeAssistant.name, legacyRuntimeAssistantName]
    );
  if (candidates.rowCount > 1) fail('WHATSAPP_ASSISTANT_AMBIGUOUS');

  if (candidates.rowCount === 1) {
    if (candidates.rows[0].status !== 'active') fail('WHATSAPP_ASSISTANT_INACTIVE');
    const updated = await client.query(
      `UPDATE ai_assistants
          SET name = $1,
              system_prompt = $2,
              model = $3,
              whatsapp_response_templates = $4::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $5 AND tenant_id = $6
        RETURNING id, status`,
      [runtimeAssistant.name, masterPolicy, runtimeAssistant.model, JSON.stringify(deterministicResponseTemplates), candidates.rows[0].assistant_id ?? candidates.rows[0].id, tenantId]
    );
    return { assistant: updated.rows[0], outcome: 'configured' };
  }

  const created = await client.query(
    `INSERT INTO ai_assistants (tenant_id, name, system_prompt, model, status, whatsapp_response_templates)
     VALUES ($1, $2, $3, $4, 'active', $5::jsonb) RETURNING id, status`,
    [tenantId, runtimeAssistant.name, masterPolicy, runtimeAssistant.model, JSON.stringify(deterministicResponseTemplates)]
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
    const tenant = await client.query('SELECT id, name FROM tenants WHERE id = $1 AND status = $2 FOR UPDATE', [tenantId, 'active']);
    if (tenant.rowCount !== 1) fail('TENANT_NOT_FOUND');
    if (tenant.rows[0].name !== tenantDisplayName) {
      await client.query(
        'UPDATE tenants SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = $3',
        [tenantDisplayName, tenantId, 'active']
      );
    }

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
              tc.channel_type, tc.status channel_status, a.status assistant_status, a.model,
              a.name assistant_name, a.system_prompt, a.whatsapp_response_templates
         FROM channel_integrations ci
         JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
         JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
        WHERE ci.id = $1 AND ci.integration_type = 'WHATSAPP' FOR UPDATE`,
      [mapping.rows[0].id]
    );
    const row = verified.rows[0];
    const verifiedPolicy = String(row?.system_prompt ?? '');
    const verifiedPolicyCanonical = canonicalizePolicyNewlines(verifiedPolicy);
    const verifiedPolicyRawSha256 = row
      ? createHash('sha256').update(verifiedPolicy, 'utf8').digest('hex')
      : null;
    const verifiedPolicyCanonicalSha256 = row
      ? createHash('sha256').update(verifiedPolicyCanonical, 'utf8').digest('hex')
      : null;
    if (!row || tenantDisplayName !== (await client.query('SELECT name FROM tenants WHERE id = $1', [tenantId])).rows[0]?.name || row.tenant_id !== tenantId || row.channel_id !== channel.channel.id ||
        row.assistant_id !== assistant.assistant.id || row.enabled !== true ||
        row.channel_type !== 'WHATSAPP' || row.channel_status !== 'active' ||
        row.assistant_status !== 'active' || row.model !== runtimeAssistant.model ||
        row.assistant_name !== runtimeAssistant.name ||
        !hasRequiredDeterministicTemplates(row.whatsapp_response_templates) ||
        verifiedPolicyCanonicalSha256 !== expectedMasterPolicyCanonicalSha256) fail('MAPPING_VERIFICATION_FAILED');
    await client.query('COMMIT');
    console.log('WHATSAPP_MAPPING: READY (assistant=' + assistant.outcome + '; channel=' + channel.outcome + '; policy_characters=' + verifiedPolicyCanonical.length + '; policy_lines=' + policyLineCount(verifiedPolicyCanonical) + '; policy_raw_sha256=' + verifiedPolicyRawSha256 + '; policy_canonical_sha256=' + verifiedPolicyCanonicalSha256 + ')');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('WHATSAPP_MAPPING: ' + (error?.code || 'BOOTSTRAP_FAILED'));
    process.exitCode = 1;
  } finally { client.release(); }
} finally { await pool.end(); }
