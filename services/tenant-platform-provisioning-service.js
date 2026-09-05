import { PLAN_CODES } from './tenant-plan-service.js';
import {
  PLATFORM_CAPABILITY_MANIFEST,
  PLATFORM_CAPABILITY_MANIFEST_VERSION,
} from './platform-capability-registry.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TenantPlatformProvisioningError extends Error {
  constructor(code, message = 'Tenant platform provisioning failed') {
    super(message);
    this.code = code;
  }
}

const ENABLEMENT_FIELD = Object.freeze({
  assistant_core: 'assistant_enabled',
  channel_core: 'channel_enabled',
  webchat: 'web_chat_enabled',
  whatsapp: 'whatsapp_enabled',
  contextual_followup: 'contextual_followup_enabled',
  source_processing: 'source_enabled',
  business_identity: 'business_identity_enabled',
  business_profile: 'business_profile_enabled',
  knowledge_candidates: 'source_enabled',
  retrieval: 'retrieval_enabled',
  guide: 'guide_enabled',
  roadmap: 'guide_enabled',
  planning: 'guide_enabled',
  guide_assistant: 'guide_enabled',
  guide_shared_context: 'guide_enabled',
  guide_persistence: 'guide_enabled',
});

function validTenantId(value) {
  if (!UUID.test(String(value ?? ''))) throw new TenantPlatformProvisioningError('TENANT_PLATFORM_TENANT_INVALID');
  return String(value);
}

function capabilityState(featureState) {
  return Object.fromEntries(PLATFORM_CAPABILITY_MANIFEST.map((capability) => {
    const field = ENABLEMENT_FIELD[capability.key];
    const enabled = capability.enablement === 'ALWAYS'
      ? true
      : Boolean(field && featureState[field]);
    return [capability.key, { available: true, enabled }];
  }));
}

async function readFeatureState(client, tenantId) {
  const result = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM ai_assistants a WHERE a.tenant_id=$1 AND a.status='active') AS assistant_enabled,
       EXISTS (SELECT 1 FROM tenant_channels c WHERE c.tenant_id=$1 AND c.status='active') AS channel_enabled,
       EXISTS (SELECT 1 FROM channel_integrations i WHERE i.tenant_id=$1 AND i.enabled=TRUE AND i.integration_type='WEB_CHAT') AS web_chat_enabled,
       EXISTS (SELECT 1 FROM channel_integrations i WHERE i.tenant_id=$1 AND i.enabled=TRUE AND i.integration_type='WHATSAPP') AS whatsapp_enabled,
       EXISTS (SELECT 1 FROM channel_integrations i WHERE i.tenant_id=$1 AND i.enabled=TRUE AND i.integration_type='SAMCHEGUIDE') AS guide_enabled,
       EXISTS (SELECT 1 FROM human_support_escalation_policies p WHERE p.tenant_id=$1 AND p.enabled=TRUE) AS human_support_enabled,
       EXISTS (SELECT 1 FROM conversation_scheduled_jobs j WHERE j.tenant_id=$1 AND j.job_type='CONTEXTUAL_FOLLOW_UP') AS contextual_followup_enabled,
       EXISTS (SELECT 1 FROM knowledge_base_documents s WHERE s.tenant_id=$1 AND s.enabled=TRUE) AS source_enabled,
       EXISTS (SELECT 1 FROM business_identities b WHERE b.tenant_id=$1 AND b.status='ACTIVE') AS business_identity_enabled,
       EXISTS (SELECT 1 FROM business_profiles p WHERE p.tenant_id=$1) AS business_profile_enabled,
       EXISTS (SELECT 1 FROM assistant_configuration_versions c WHERE c.tenant_id=$1 AND c.status='ACTIVE') AS retrieval_enabled`,
    [tenantId],
  );
  return result.rows[0] ?? {};
}

export async function provisionTenantPlatformCapabilities({ client, tenantId }) {
  if (!client?.query) throw new TenantPlatformProvisioningError('TENANT_PLATFORM_DATABASE_INVALID');
  const id = validTenantId(tenantId);
  const tenant = await client.query('SELECT id, plan_code, status FROM tenants WHERE id = $1 FOR UPDATE', [id]);
  if (!tenant.rowCount) throw new TenantPlatformProvisioningError('TENANT_PLATFORM_TENANT_NOT_FOUND');
  await client.query('SELECT ensure_tenant_platform_capabilities($1, $2)', [id, PLATFORM_CAPABILITY_MANIFEST_VERSION]);
  const featureState = await readFeatureState(client, id);
  return {
    tenant_id: id,
    manifest_version: PLATFORM_CAPABILITY_MANIFEST_VERSION,
    plan_code: tenant.rows[0].plan_code,
    capabilities: capabilityState(featureState),
  };
}

export async function createTenantWithPlatformCapabilities({ database, name, planCode }) {
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedPlan = String(planCode ?? '').toUpperCase();
  if (!normalizedName || normalizedName.length > 255 || !PLAN_CODES.includes(normalizedPlan)) {
    throw new TenantPlatformProvisioningError('TENANT_PLATFORM_CREATE_INPUT_INVALID');
  }
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO tenants (name, plan_code)
       VALUES ($1, $2)
       RETURNING id, name, status, plan_code, created_at`,
      [normalizedName, normalizedPlan],
    );
    await provisionTenantPlatformCapabilities({ client, tenantId: inserted.rows[0].id });
    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

async function repairOne(database, tenantId) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await provisionTenantPlatformCapabilities({ client, tenantId });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release?.();
  }
}

export async function repairTenantPlatformCapabilities({ database, tenantId = null }) {
  if (!database?.connect) throw new TenantPlatformProvisioningError('TENANT_PLATFORM_DATABASE_INVALID');
  const tenantIds = tenantId
    ? [validTenantId(tenantId)]
    : (await database.query('SELECT id FROM tenants ORDER BY id')).rows.map((row) => validTenantId(row.id));
  const repaired = [];
  for (const id of tenantIds) repaired.push(await repairOne(database, id));
  return repaired;
}
