import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { normalizeWhatsAppExternalId } from '../services/whatsapp-channel-ownership-service.js';

const { Pool } = pg;
const connectionString = process.env.STAGING_DATABASE_URL;
const tenantId = process.env.STAGING_WHATSAPP_TENANT_ID;
const phoneNumberId = process.env.STAGING_WHATSAPP_PHONE_ID;
const tenantDisplayName = process.env.STAGING_WHATSAPP_TENANT_NAME;
const canonicalPhoneNumberId = phoneNumberId ? normalizeWhatsAppExternalId(phoneNumberId) : null;
const integrationKey = canonicalPhoneNumberId ? `whatsapp:${canonicalPhoneNumberId}` : null;
const defaultRuntimeAssistant = { name: 'SamChe AI', model: 'gemini-2.5-pro' };
const defaultAssistantName = tenantDisplayName ? `${tenantDisplayName} AI` : defaultRuntimeAssistant.name;
const runtimeAssistant = {
  name: process.env.STAGING_WHATSAPP_ASSISTANT_NAME || defaultAssistantName,
  model: process.env.STAGING_WHATSAPP_ASSISTANT_MODEL || defaultRuntimeAssistant.model,
};
const legacyRuntimeAssistantName = process.env.STAGING_WHATSAPP_LEGACY_ASSISTANT_NAME || 'SamChe WhatsApp Runtime';
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

const enforceMasterPolicy = process.env.STAGING_WHATSAPP_ENFORCE_MASTER_POLICY
  ? process.env.STAGING_WHATSAPP_ENFORCE_MASTER_POLICY === 'true'
  : (!process.env.STAGING_WHATSAPP_SYSTEM_PROMPT && !process.env.STAGING_WHATSAPP_ASSISTANT_NAME);

if (!connectionString || !tenantId || !phoneNumberId || !tenantDisplayName) {
  console.error('WHATSAPP_MAPPING: CONFIGURATION_REQUIRED');
  process.exit(1);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
  console.error('WHATSAPP_MAPPING: INVALID_CONFIGURATION');
  process.exit(1);
}
if (enforceMasterPolicy && masterPolicyCanonicalSha256 !== expectedMasterPolicyCanonicalSha256) {
  console.error('WHATSAPP_MAPPING: MASTER_POLICY_INTEGRITY_FAILED');
  process.exit(1);
}
function hasRequiredDeterministicTemplates(value) {
  return ['tr', 'en', 'ar'].every((language) =>
    typeof value?.first_contact?.[language] === 'string' &&
    typeof value?.social?.greeting?.[language] === 'string' &&
    typeof value?.social?.thanks?.[language] === 'string' &&
    typeof value?.human_support?.general_topic?.[language] === 'string' &&
    typeof value?.human_support?.transfer?.[language] === 'string' &&
    typeof value?.human_support?.manual_takeover?.[language] === 'string' &&
    typeof value?.human_support?.warning_5m?.[language] === 'string' &&
    typeof value?.human_support?.timeout_close?.[language] === 'string' &&
    typeof value?.human_support?.return_to_ai?.[language] === 'string'
  );
}

function buildGenericDeterministicTemplates() {
  return {
    first_contact: {
      tr: 'Merhaba, ben {{assistantName}}.\n\n{{companyName}} yapay zeka asistanıyım ve size yardımcı olmak için buradayım. Size nasıl yardımcı olabilirim?',
      en: "Hello, I'm {{assistantName}}.\n\nI'm the AI assistant for {{companyName}}, and I'm here to assist you. How can I help you today?",
      ar: 'مرحبًا، أنا {{assistantName}}.\n\nأنا المساعد الذكي لشركة {{companyName}}، وأنا هنا لمساعدتك. كيف يمكنني مساعدتك اليوم؟',
    },
    social: deterministicResponseTemplates.social,
    human_support: deterministicResponseTemplates.human_support,
  };
}

function fail(code) { const error = new Error(code); error.code = code; throw error; }
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

async function resolveAssistant(client) {
  const integrationAssistant = await client.query(
    `SELECT ci.assistant_id, a.id, a.status, a.name, a.system_prompt, a.whatsapp_response_templates
       FROM channel_integrations ci
       JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
      WHERE ci.integration_key = $1 AND ci.tenant_id = $2
      FOR UPDATE`,
    [integrationKey, tenantId]
  );
  if (integrationAssistant.rowCount > 1) fail('WHATSAPP_ASSISTANT_AMBIGUOUS');

  let assistantRow = null;
  if (integrationAssistant.rowCount === 1) {
    assistantRow = integrationAssistant.rows[0];
  } else {
    const candidates = await client.query(
      `SELECT id, status, name, system_prompt, whatsapp_response_templates
         FROM ai_assistants
        WHERE tenant_id = $1
          AND (name = $2 OR ($3::text IS NOT NULL AND name = $3))
        ORDER BY CASE WHEN name = $2 THEN 0 ELSE 1 END
        FOR UPDATE`,
      [tenantId, runtimeAssistant.name, legacyRuntimeAssistantName]
    );
    if (candidates.rowCount > 1) fail('WHATSAPP_ASSISTANT_AMBIGUOUS');
    if (candidates.rowCount === 1) {
      assistantRow = candidates.rows[0];
    } else {
      const anyActive = await client.query(
        `SELECT id, status, name, system_prompt, whatsapp_response_templates
           FROM ai_assistants
          WHERE tenant_id = $1 AND status = 'active'
          LIMIT 2
          FOR UPDATE`,
        [tenantId]
      );
      if (anyActive.rowCount === 1) {
        assistantRow = anyActive.rows[0];
      }
    }
  }

  const effectivePolicy = enforceMasterPolicy
    ? masterPolicy
    : (process.env.STAGING_WHATSAPP_SYSTEM_PROMPT || assistantRow?.system_prompt || `You are an AI assistant for ${tenantDisplayName}. Provide helpful, concise, and professional concierge support.`);

  const effectiveTemplates = hasRequiredDeterministicTemplates(assistantRow?.whatsapp_response_templates)
    ? assistantRow.whatsapp_response_templates
    : (enforceMasterPolicy ? deterministicResponseTemplates : buildGenericDeterministicTemplates());

  if (assistantRow) {
    if (assistantRow.status !== 'active') fail('WHATSAPP_ASSISTANT_INACTIVE');
    const targetAssistantId = assistantRow.assistant_id ?? assistantRow.id;
    const updated = await client.query(
      `UPDATE ai_assistants
          SET name = $1,
              system_prompt = $2,
              model = $3,
              whatsapp_response_templates = $4::jsonb,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $5 AND tenant_id = $6
        RETURNING id, status`,
      [runtimeAssistant.name, effectivePolicy, runtimeAssistant.model, JSON.stringify(effectiveTemplates), targetAssistantId, tenantId]
    );
    return { assistant: updated.rows[0], outcome: 'configured' };
  }

  const created = await client.query(
    `INSERT INTO ai_assistants (tenant_id, name, system_prompt, model, status, whatsapp_response_templates)
     VALUES ($1, $2, $3, $4, 'active', $5::jsonb) RETURNING id, status`,
    [tenantId, runtimeAssistant.name, effectivePolicy, runtimeAssistant.model, JSON.stringify(effectiveTemplates)]
  );
  return { assistant: created.rows[0], outcome: 'created' };
}

async function resolveChannel(client, assistantId) {
  const activeOwners = await client.query(
    `SELECT tc.id, tc.tenant_id FROM tenant_channels tc
      WHERE tc.channel_type = 'WHATSAPP'
        AND tc.status = 'active'
        AND regexp_replace(regexp_replace(lower(trim(tc.external_channel_id)), '^whatsapp:\\s*', ''), '[^0-9]', '', 'g') = $1
      FOR UPDATE`,
    [canonicalPhoneNumberId]
  );
  if (activeOwners.rowCount > 1) fail('WHATSAPP_CHANNEL_OWNERSHIP_AMBIGUOUS');
  if (activeOwners.rowCount === 1 && activeOwners.rows[0].tenant_id !== tenantId) {
    fail('WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT_PLATFORM_TRANSFER_REQUIRED');
  }

  const channels = await client.query(
    `SELECT id, assistant_id, status FROM tenant_channels
      WHERE tenant_id = $1 AND channel_type = 'WHATSAPP'
        AND regexp_replace(regexp_replace(lower(trim(external_channel_id)), '^whatsapp:\\s*', ''), '[^0-9]', '', 'g') = $2
      FOR UPDATE`,
    [tenantId, canonicalPhoneNumberId]
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
  const channelDisplayName = process.env.STAGING_WHATSAPP_CHANNEL_NAME || `${tenantDisplayName} WhatsApp`;
  const created = await client.query(
    `INSERT INTO tenant_channels
      (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
     VALUES ($1, $2, 'WHATSAPP', $3, $4, 'active')
     RETURNING id, assistant_id, status`,
    [tenantId, assistantId, channelDisplayName, canonicalPhoneNumberId]
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
    const existing = await client.query('SELECT id, tenant_id FROM channel_integrations WHERE (integration_key = $1 OR LOWER(integration_key) = LOWER($1)) FOR UPDATE', [integrationKey]);
    if (existing.rowCount && existing.rows.some((row) => row.tenant_id !== tenantId)) {
      fail('WHATSAPP_INTEGRATION_OWNERSHIP_CONFLICT_PLATFORM_TRANSFER_REQUIRED');
    }

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
    const isPolicyValid = enforceMasterPolicy
      ? verifiedPolicyCanonicalSha256 === expectedMasterPolicyCanonicalSha256
      : verifiedPolicyCanonical.length > 0;
    if (!row || tenantDisplayName !== (await client.query('SELECT name FROM tenants WHERE id = $1', [tenantId])).rows[0]?.name || row.tenant_id !== tenantId || row.channel_id !== channel.channel.id ||
        row.assistant_id !== assistant.assistant.id || row.enabled !== true ||
        row.channel_type !== 'WHATSAPP' || row.channel_status !== 'active' ||
        row.assistant_status !== 'active' || row.model !== runtimeAssistant.model ||
        row.assistant_name !== runtimeAssistant.name ||
        !hasRequiredDeterministicTemplates(row.whatsapp_response_templates) ||
        (enforceMasterPolicy && verifiedPolicyCanonicalSha256 !== expectedMasterPolicyCanonicalSha256) ||
        !isPolicyValid) fail('MAPPING_VERIFICATION_FAILED');
    await client.query('COMMIT');
    console.log('WHATSAPP_MAPPING: READY (assistant=' + assistant.outcome + '; channel=' + channel.outcome + '; policy_characters=' + verifiedPolicyCanonical.length + '; policy_lines=' + policyLineCount(verifiedPolicyCanonical) + '; policy_raw_sha256=' + verifiedPolicyRawSha256 + '; policy_canonical_sha256=' + verifiedPolicyCanonicalSha256 + ')');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('WHATSAPP_MAPPING: ' + (error?.code || 'BOOTSTRAP_FAILED'));
    process.exitCode = 1;
  } finally { client.release(); }
} finally { await pool.end(); }
