import { randomUUID } from 'crypto';
import pg from 'pg';
import {
  SAMCHEGUIDE_RUNTIME,
  isCompatibleSamcheguideRuntimeAssistant,
} from '../services/samcheguide-runtime.js';
import { ensureManagedGuideDomainForAssistant } from '../services/guide-domain-service.js';

const { Pool } = pg;
const connectionString = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
const tenantId = process.env.SAMCHEGUIDE_TENANT_ID;
const requestedAssistantId = process.env.SAMCHEGUIDE_ASSISTANT_ID || null;
const integrationKey = 'SAMCHEGUIDE:staging';
const externalChannelId = 'samcheguide:staging';

if (!connectionString || !tenantId) {
  console.error('SAMCHEGUIDE_MAPPING: CONFIGURATION_REQUIRED');
  process.exit(1);
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuidPattern.test(tenantId) || (requestedAssistantId && !uuidPattern.test(requestedAssistantId))) {
  console.error('SAMCHEGUIDE_MAPPING: INVALID_CONFIGURATION');
  process.exit(1);
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

async function findAssistantById(client, id) {
  const result = await client.query(
    'SELECT id, name, model, status FROM ai_assistants WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [id, tenantId]
  );
  if (!result.rowCount) fail('ASSISTANT_NOT_FOUND');
  if (!isCompatibleSamcheguideRuntimeAssistant(result.rows[0])) fail('ASSISTANT_RUNTIME_MISMATCH');
  return { assistant: result.rows[0], outcome: 'resolved' };
}

async function resolveRuntimeAssistant(client, mappedAssistantId) {
  if (requestedAssistantId) return findAssistantById(client, requestedAssistantId);
  if (mappedAssistantId) return findAssistantById(client, mappedAssistantId);

  const named = await client.query(
    'SELECT id, name, model, status FROM ai_assistants WHERE tenant_id = $1 AND name = $2 FOR UPDATE',
    [tenantId, SAMCHEGUIDE_RUNTIME.name]
  );
  if (named.rowCount > 1) fail('SAMCHEGUIDE_ASSISTANT_AMBIGUOUS');
  if (named.rowCount === 1) {
    if (!isCompatibleSamcheguideRuntimeAssistant(named.rows[0])) fail('ASSISTANT_RUNTIME_MISMATCH');
    return { assistant: named.rows[0], outcome: 'resolved' };
  }

  const candidates = await client.query(
    `SELECT id, name, model, status
       FROM ai_assistants
      WHERE tenant_id = $1
        AND status = 'active'
        AND model = $2
        AND name ILIKE '%samcheguide%'
      FOR UPDATE`,
    [tenantId, SAMCHEGUIDE_RUNTIME.model]
  );
  if (candidates.rowCount > 1) fail('SAMCHEGUIDE_ASSISTANT_AMBIGUOUS');
  if (candidates.rowCount === 1) {
    return { assistant: candidates.rows[0], outcome: 'resolved' };
  }

  // The schema has no provider field. Persist the exact Gemini model and leave
  // system_prompt null because the actual runtime prompt remains in /chat.
  const created = await client.query(
    `INSERT INTO ai_assistants (tenant_id, name, model, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING id, name, model, status`,
    [tenantId, SAMCHEGUIDE_RUNTIME.name, SAMCHEGUIDE_RUNTIME.model]
  );
  return { assistant: created.rows[0], outcome: 'created' };
}

async function resolveChannel(client, assistant) {
  const existing = await client.query(
    `SELECT id, assistant_id, status
       FROM tenant_channels
      WHERE tenant_id = $1
        AND channel_type = 'SAMCHEGUIDE'
        AND external_channel_id = $2
      FOR UPDATE`,
    [tenantId, externalChannelId]
  );
  if (existing.rowCount) {
    const updated = await client.query(
      `UPDATE tenant_channels
          SET assistant_id = $1,
              status = 'active',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND tenant_id = $3
        RETURNING id, assistant_id, status`,
      [assistant.id, existing.rows[0].id, tenantId]
    );
    return { channel: updated.rows[0], outcome: 'resolved' };
  }

  const created = await client.query(
    `INSERT INTO tenant_channels
      (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
     VALUES ($1, $2, 'SAMCHEGUIDE', 'Samcheguide', $3, 'active')
     RETURNING id, assistant_id, status`,
    [tenantId, assistant.id, externalChannelId]
  );
  return { channel: created.rows[0], outcome: 'created' };
}

async function resolveMapping(client, assistant, channel, existingMapping) {
  if (existingMapping?.tenant_id && existingMapping.tenant_id !== tenantId) {
    fail('MAPPING_TENANT_MISMATCH');
  }

  const result = await client.query(
    `INSERT INTO channel_integrations
      (id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
     VALUES ($1, $2, 'SAMCHEGUIDE', $3, $4, $5, TRUE)
     ON CONFLICT (integration_key)
     DO UPDATE SET
       channel_id = EXCLUDED.channel_id,
       assistant_id = EXCLUDED.assistant_id,
       enabled = TRUE,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, tenant_id, channel_id, assistant_id, enabled`,
    [randomUUID(), integrationKey, tenantId, channel.id, assistant.id]
  );
  return { mapping: result.rows[0], outcome: existingMapping ? 'resolved' : 'created' };
}

async function verifyMapping(client, assistant, channel, mapping) {
  const verification = await client.query(
    `SELECT
       ci.tenant_id,
       ci.channel_id,
       ci.assistant_id,
       ci.enabled,
       tc.channel_type,
       tc.status AS channel_status,
       a.model,
       a.status AS assistant_status
     FROM channel_integrations ci
     JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
     JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
    WHERE ci.id = $1
      AND ci.integration_key = $2
    FOR UPDATE`,
    [mapping.id, integrationKey]
  );
  const row = verification.rows[0];
  if (
    !row ||
    row.tenant_id !== tenantId ||
    row.channel_id !== channel.id ||
    row.assistant_id !== assistant.id ||
    row.enabled !== true ||
    row.channel_type !== 'SAMCHEGUIDE' ||
    row.channel_status !== 'active' ||
    row.assistant_status !== 'active' ||
    row.model !== SAMCHEGUIDE_RUNTIME.model
  ) {
    fail('MAPPING_VERIFICATION_FAILED');
  }
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializes concurrent manual workflow dispatches for the same staging tenant.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('samcheguide-bootstrap:' || $1::text))", [tenantId]);

    const tenant = await client.query(
      'SELECT id FROM tenants WHERE id = $1 AND status = $2 FOR UPDATE',
      [tenantId, 'active']
    );
    if (!tenant.rowCount) fail('TENANT_NOT_FOUND');

    const mappingLookup = await client.query(
      'SELECT id, tenant_id, assistant_id FROM channel_integrations WHERE integration_key = $1 FOR UPDATE',
      [integrationKey]
    );
    const existingMapping = mappingLookup.rows[0] ?? null;
    if (existingMapping?.tenant_id && existingMapping.tenant_id !== tenantId) fail('MAPPING_TENANT_MISMATCH');

    const assistant = await resolveRuntimeAssistant(client, existingMapping?.assistant_id);
    const channel = await resolveChannel(client, assistant.assistant);
    const mapping = await resolveMapping(client, assistant.assistant, channel.channel, existingMapping);
    await verifyMapping(client, assistant.assistant, channel.channel, mapping.mapping);
    await ensureManagedGuideDomainForAssistant({ database: client, tenantId, assistantId: assistant.assistant.id, channelId: channel.channel.id });

    await client.query('COMMIT');
    console.log(`SAMCHEGUIDE_MAPPING: READY (assistant=${assistant.outcome}; channel=${channel.outcome}; mapping=${mapping.outcome})`);
  } catch (error) {
    await client.query('ROLLBACK');
    const code = typeof error?.code === 'string' ? error.code : 'BOOTSTRAP_FAILED';
    console.error(`SAMCHEGUIDE_MAPPING: ${code}`);
    process.exitCode = 1;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
