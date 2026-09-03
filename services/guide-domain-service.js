import { domainToASCII } from 'node:url';

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export class GuideDomainError extends Error {
  constructor(code, message = 'Guide domain is unavailable.') {
    super(message);
    this.code = code;
  }
}

export function normalizeGuideHostname(value) {
  if (typeof value !== 'string') throw new GuideDomainError('GUIDE_DOMAIN_INVALID_HOSTNAME');
  const source = value.trim().replace(/\.$/, '');
  if (!source || /[/:?#[\]@*\s]/.test(source)) throw new GuideDomainError('GUIDE_DOMAIN_INVALID_HOSTNAME');
  const hostname = domainToASCII(source).toLowerCase();
  if (!hostname || !HOSTNAME.test(hostname) || IPV4.test(hostname)) throw new GuideDomainError('GUIDE_DOMAIN_INVALID_HOSTNAME');
  return hostname;
}

export function guideDomainCacheKey({ hostname, tenantId, assistantId }) {
  return `guide-domain:${normalizeGuideHostname(hostname)}:${tenantId}:${assistantId}`;
}

export function configuredGuideDomainIngressTarget(environment = process.env) {
  const target = environment.GUIDE_DOMAIN_INGRESS_TARGET;
  if (!target) throw new GuideDomainError('GUIDE_DOMAIN_INGRESS_UNAVAILABLE');
  return normalizeGuideHostname(target);
}

function integrationIsHealthy(row) {
  return row
    && row.channel_type === 'SAMCHEGUIDE'
    && row.channel_status === 'active'
    && row.assistant_status === 'active'
    && row.integration_enabled === true
    && row.channel_assistant_id === row.assistant_id;
}

export async function resolveActiveGuideDomain({ database, hostname }) {
  let normalized;
  try { normalized = normalizeGuideHostname(hostname); } catch { return null; }
  const result = await database.query(
    `SELECT gd.id AS domain_id, gd.hostname, gd.tenant_id, gd.assistant_id, gd.channel_id,
            tc.assistant_id AS channel_assistant_id, tc.channel_type, tc.status AS channel_status,
            ci.enabled AS integration_enabled,
            a.status AS assistant_status
       FROM guide_domains gd
       JOIN tenant_channels tc ON tc.id = gd.channel_id AND tc.tenant_id = gd.tenant_id
       JOIN channel_integrations ci ON ci.channel_id = gd.channel_id AND ci.tenant_id = gd.tenant_id
         AND ci.assistant_id = gd.assistant_id AND ci.integration_type = 'SAMCHEGUIDE' AND ci.enabled = TRUE
       JOIN ai_assistants a ON a.id = gd.assistant_id AND a.tenant_id = gd.tenant_id
      WHERE gd.hostname = $1 AND gd.status = 'ACTIVE'
      LIMIT 2`,
    [normalized],
  );
  if (result.rowCount !== 1 || !integrationIsHealthy(result.rows[0])) return null;
  return result.rows[0];
}

export function requestGuideHostname(req) {
  const host = String(req?.headers?.host ?? '').trim().replace(/:\d+$/, '');
  // A normal browser cannot set Host independently of its TLS destination. This
  // intentionally rejects forwarded/query/local-state identity sources.
  return normalizeGuideHostname(host);
}

export async function resolveGuideRuntimeScopeFromRequest({ database, req }) {
  try {
    return await resolveActiveGuideDomain({ database, hostname: requestGuideHostname(req) });
  } catch {
    return null;
  }
}

function serialize(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    assistant_id: row.assistant_id,
    channel_id: row.channel_id,
    hostname: row.hostname,
    status: row.status,
    verification_record_type: row.verification_record_type,
    verification_target: row.verification_target,
    verified_at: row.verified_at,
    activated_at: row.activated_at,
    archived_at: row.archived_at,
    created_at: row.created_at,
  };
}

export async function listGuideDomains({ database, tenantId, assistantId }) {
  const result = await database.query(
    `SELECT id, tenant_id, assistant_id, channel_id, hostname, status, verification_record_type,
            verification_target, verified_at, activated_at, archived_at, created_at
       FROM guide_domains WHERE tenant_id=$1 AND assistant_id=$2 ORDER BY created_at DESC`,
    [tenantId, assistantId],
  );
  return result.rows.map(serialize);
}

export async function createGuideDomain({ client, tenantId, assistantId, channelId, hostname, actorUserId, ingressTarget }) {
  const normalized = normalizeGuideHostname(hostname);
  const target = normalizeGuideHostname(ingressTarget);
  const created = await client.query(
    `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, verification_record_type, verification_target, created_by)
     VALUES ($1,$2,$3,$4,'PENDING','CNAME',$5,$6)
     RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [tenantId, assistantId, channelId, normalized, target, actorUserId],
  );
  if (created.rowCount !== 1) throw new GuideDomainError('GUIDE_DOMAIN_CREATE_FAILED');
  await client.query(
    `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type)
     VALUES ($1,$2,$3,$4,'CREATED')`,
    [tenantId, assistantId, created.rows[0].id, actorUserId],
  );
  return serialize(created.rows[0]);
}

export async function archiveGuideDomain({ client, tenantId, assistantId, domainId, actorUserId }) {
  const archived = await client.query(
    `UPDATE guide_domains SET status='ARCHIVED', archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, updated_by=$4
      WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 AND status IN ('PENDING','VERIFIED','FAILED','ACTIVE')
      RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [domainId, tenantId, assistantId, actorUserId],
  );
  if (!archived.rowCount) throw new GuideDomainError('GUIDE_DOMAIN_NOT_FOUND');
  await client.query(
    `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type)
     VALUES ($1,$2,$3,$4,'ARCHIVED')`,
    [tenantId, assistantId, domainId, actorUserId],
  );
  return serialize(archived.rows[0]);
}

export async function activateGuideDomain({ client, tenantId, assistantId, domainId, actorUserId }) {
  const verified = await client.query(
    `UPDATE guide_domains SET status='ACTIVE', activated_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, updated_by=$4
      WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 AND status='VERIFIED'
      RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [domainId, tenantId, assistantId, actorUserId],
  );
  if (!verified.rowCount) throw new GuideDomainError('GUIDE_DOMAIN_NOT_VERIFIED');
  await client.query(
    `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type)
     VALUES ($1,$2,$3,$4,'ACTIVATED')`,
    [tenantId, assistantId, domainId, actorUserId],
  );
  return serialize(verified.rows[0]);
}

function dnsTargetMatches(records, target) {
  return Array.isArray(records) && records.some((record) => {
    try { return normalizeGuideHostname(record) === target; } catch { return false; }
  });
}

export async function verifyGuideDomainDns({ client, tenantId, assistantId, domainId, actorUserId, resolveCname }) {
  const selected = await client.query(
    `SELECT id, tenant_id, assistant_id, channel_id, hostname, status, verification_target
       FROM guide_domains
      WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 AND status IN ('PENDING','FAILED','VERIFIED')
      FOR UPDATE`,
    [domainId, tenantId, assistantId],
  );
  if (!selected.rowCount) throw new GuideDomainError('GUIDE_DOMAIN_NOT_FOUND');
  const domain = selected.rows[0];
  let records = [];
  try { records = await resolveCname(domain.hostname); } catch { records = []; }
  if (!dnsTargetMatches(records, domain.verification_target)) {
    const failed = await client.query(
      `UPDATE guide_domains SET status='FAILED', verification_metadata=jsonb_build_object('reason','DNS_TARGET_MISMATCH'), updated_at=CURRENT_TIMESTAMP, updated_by=$4
        WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3`,
      [domainId, tenantId, assistantId, actorUserId],
    );
    await client.query(
      `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type, metadata)
       VALUES ($1,$2,$3,$4,'FAILED',jsonb_build_object('reason','DNS_TARGET_MISMATCH'))`,
      [tenantId, assistantId, domainId, actorUserId],
    );
    return serialize(failed.rows[0]);
  }
  const verified = await client.query(
    `UPDATE guide_domains SET status='VERIFIED', verified_at=CURRENT_TIMESTAMP,
       verification_metadata=jsonb_build_object('reason','DNS_TARGET_MATCHED'), updated_at=CURRENT_TIMESTAMP, updated_by=$4
      WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3`,
    [domainId, tenantId, assistantId, actorUserId],
  );
  await client.query(
    `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type)
     VALUES ($1,$2,$3,$4,'VERIFIED')`,
    [tenantId, assistantId, domainId, actorUserId],
  );
  return serialize(verified.rows[0]);
}
