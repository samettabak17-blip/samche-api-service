import { domainToASCII } from 'node:url';
import crypto from 'node:crypto';
import { verifyGuidePreviewToken } from './guide-preview-service.js';

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

export function configuredManagedGuideDomainSuffix(environment = process.env) {
  // The platform may override this value per deployment. The safe default
  // keeps non-production managed hosts out of the production guide namespace.
  const configured = environment.GUIDE_MANAGED_DOMAIN_SUFFIX;
  const environmentMarkers = [
    environment.RENDER_GIT_BRANCH,
    environment.APP_ENV,
    environment.NODE_ENV,
    environment.RENDER_SERVICE_NAME,
    environment.RENDER_EXTERNAL_HOSTNAME,
  ].map((value) => String(value ?? '').toLowerCase());
  const staging = environmentMarkers.some((value) => value === 'staging' || value.includes('staging'));
  const suffix = staging
    ? (configured === 'guide.samchecompany.com' || !configured ? 'guide.staging.samchecompany.com' : configured)
    : configured || ((environment.NODE_ENV || environment.APP_ENV) === 'production'
      ? 'guide.samchecompany.com'
      : 'guide.staging.samchecompany.com');
  return normalizeGuideHostname(suffix);
}

export function managedGuideHostnameFromSlug(slug, environment = process.env) {
  if (typeof slug !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(slug.trim().toLowerCase())) {
    throw new GuideDomainError('GUIDE_DOMAIN_INVALID_SLUG');
  }
  return `${slug.trim().toLowerCase()}.${configuredManagedGuideDomainSuffix(environment)}`;
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
  try {
    const raw = (typeof req?.get === 'function' ? req.get('host') : req?.headers?.host) || '';
    const host = String(raw).trim().replace(/:\d+$/, '');
    if (!host) return null;
    return normalizeGuideHostname(host);
  } catch {
    return null;
  }
}

export async function resolveGuideRuntimeScopeFromRequest({ database, req }) {
  try {
    // 1. Try resolving dedicated active guide hostname
    const host = requestGuideHostname(req);
    if (host) {
      const direct = await resolveActiveGuideDomain({ database, hostname: host });
      if (direct) return direct;
    }

    // 2. Shared Host / Preview Context: Check signed preview token
    const getHeader = (name) => (typeof req?.get === 'function' ? req.get(name) : req?.headers?.[name.toLowerCase()]);
    const previewToken = getHeader('X-Samcheguide-Preview') || req?.query?.preview;
    if (typeof previewToken === 'string' && previewToken.trim()) {
      try {
        const claims = verifyGuidePreviewToken(previewToken.trim());
        if (claims?.tenant_id && claims?.assistant_id) {
          const previewResult = await database.query(
            `SELECT gd.id AS domain_id, gd.hostname, ci.tenant_id, ci.assistant_id, ci.channel_id,
                    tc.assistant_id AS channel_assistant_id, tc.channel_type, tc.status AS channel_status,
                    ci.enabled AS integration_enabled,
                    a.status AS assistant_status
               FROM channel_integrations ci
               JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
               JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
               LEFT JOIN guide_domains gd ON gd.tenant_id = ci.tenant_id AND gd.assistant_id = ci.assistant_id AND gd.status = 'ACTIVE'
              WHERE ci.tenant_id = $1
                AND ci.assistant_id = $2
                AND ci.integration_type = 'SAMCHEGUIDE'
                AND ci.enabled = TRUE
                AND tc.channel_type = 'SAMCHEGUIDE'
                AND tc.status = 'active'
                AND a.status = 'active'
              ORDER BY gd.created_at DESC
              LIMIT 1`,
            [claims.tenant_id, claims.assistant_id],
          );
          if (previewResult.rowCount === 1 && integrationIsHealthy(previewResult.rows[0])) {
            const scope = previewResult.rows[0];
            if (!scope.domain_id) {
              const provisioned = await ensureManagedGuideDomainForAssistant({
                database,
                tenantId: scope.tenant_id,
                assistantId: scope.assistant_id,
                channelId: scope.channel_id,
              });
              scope.domain_id = provisioned.id;
              scope.hostname = provisioned.hostname;
            }
            return scope;
          }
        }
      } catch {}
    }

    // 3. Shared Host / Session Context: Check public session token
    const sessionToken = getHeader('X-Samcheguide-Session');
    if (typeof sessionToken === 'string' && sessionToken.length >= 32) {
      try {
        const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
        const sessionResult = await database.query(
          `SELECT gps.domain_id, gd.hostname, gps.tenant_id, gps.assistant_id, gps.channel_id,
                  tc.assistant_id AS channel_assistant_id, tc.channel_type, tc.status AS channel_status,
                  ci.enabled AS integration_enabled,
                  a.status AS assistant_status
             FROM guide_public_sessions gps
             JOIN channel_integrations ci ON ci.tenant_id = gps.tenant_id AND ci.assistant_id = gps.assistant_id AND ci.channel_id = gps.channel_id
               AND ci.integration_type = 'SAMCHEGUIDE' AND ci.enabled = TRUE
             JOIN tenant_channels tc ON tc.id = gps.channel_id AND tc.tenant_id = gps.tenant_id
               AND tc.channel_type = 'SAMCHEGUIDE' AND tc.status = 'active'
             JOIN ai_assistants a ON a.id = gps.assistant_id AND a.tenant_id = gps.tenant_id
               AND a.status = 'active'
             LEFT JOIN guide_domains gd ON gd.id = gps.domain_id
            WHERE gps.token_hash = $1
              AND gps.expires_at > CURRENT_TIMESTAMP
            LIMIT 1`,
          [tokenHash],
        );
        if (sessionResult.rowCount === 1 && integrationIsHealthy(sessionResult.rows[0])) {
          return sessionResult.rows[0];
        }
      } catch {}
    }

    return null;
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
    domain_mode: row.domain_mode ?? 'CUSTOM',
    created_at: row.created_at,
  };
}

export async function listGuideDomains({ database, tenantId, assistantId }) {
  const result = await database.query(
    `SELECT id, tenant_id, assistant_id, channel_id, hostname, status, verification_record_type,
            domain_mode,
            verification_target, verified_at, activated_at, archived_at, created_at
       FROM guide_domains WHERE tenant_id=$1 AND assistant_id=$2 ORDER BY created_at DESC`,
    [tenantId, assistantId],
  );
  return result.rows.map(serialize);
}

export async function createGuideDomain({ client, tenantId, assistantId, channelId, hostname, actorUserId, ingressTarget, domainMode = 'CUSTOM' }) {
  if (!['MANAGED', 'CUSTOM'].includes(domainMode)) throw new GuideDomainError('GUIDE_DOMAIN_MODE_INVALID');
  const normalized = normalizeGuideHostname(hostname);
  const target = normalizeGuideHostname(ingressTarget);
  const initialStatus = domainMode === 'MANAGED' ? 'ACTIVE' : 'PENDING';
  const created = await client.query(
    `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'CNAME',$7,CASE WHEN $5='ACTIVE' THEN CURRENT_TIMESTAMP ELSE NULL END,CASE WHEN $5='ACTIVE' THEN CURRENT_TIMESTAMP ELSE NULL END,$8)
     RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [tenantId, assistantId, channelId, normalized, initialStatus, domainMode, target, actorUserId],
  );
  if (created.rowCount !== 1) throw new GuideDomainError('GUIDE_DOMAIN_CREATE_FAILED');
  await client.query(
    `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type)
     VALUES ($1,$2,$3,$4,'CREATED')`,
    [tenantId, assistantId, created.rows[0].id, actorUserId],
  );
  if (initialStatus === 'ACTIVE') {
    await client.query(
      `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type)
       VALUES ($1,$2,$3,$4,'ACTIVATED')`,
      [tenantId, assistantId, created.rows[0].id, actorUserId],
    );
  }
  return serialize(created.rows[0]);
}

export async function ensureManagedGuideDomainForAssistant({ database, tenantId, assistantId, channelId, environment = process.env }) {
  const existing = await database.query(
    `SELECT id, tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at
       FROM guide_domains
      WHERE tenant_id = $1 AND assistant_id = $2 AND status = 'ACTIVE'
      LIMIT 1`,
    [tenantId, assistantId],
  );
  if (existing.rowCount) return serialize(existing.rows[0]);

  let target;
  try {
    target = configuredGuideDomainIngressTarget(environment);
  } catch {
    target = 'ingress.samchecompany.com';
  }

  const baseSlug = `t-${String(tenantId).replace(/-/g, '').slice(0, 12)}`;
  let slug = baseSlug;
  let hostname;
  try {
    hostname = managedGuideHostnameFromSlug(slug, environment);
  } catch {
    hostname = `${slug}.guide.staging.samchecompany.com`;
  }

  const conflict = await database.query(
    `SELECT id FROM guide_domains WHERE hostname = $1 AND (tenant_id != $2 OR assistant_id != $3)`,
    [hostname, tenantId, assistantId],
  );
  if (conflict.rowCount) {
    slug = `t-${String(tenantId).replace(/-/g, '').slice(0, 8)}-${String(channelId).replace(/-/g, '').slice(0, 6)}`;
    try {
      hostname = managedGuideHostnameFromSlug(slug, environment);
    } catch {
      hostname = `${slug}.guide.staging.samchecompany.com`;
    }
  }

  const created = await database.query(
    `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at)
     VALUES ($1, $2, $3, $4, 'ACTIVE', 'MANAGED', 'CNAME', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (hostname)
     DO UPDATE SET
       channel_id = EXCLUDED.channel_id,
       status = 'ACTIVE',
       domain_mode = 'MANAGED',
       verified_at = CURRENT_TIMESTAMP,
       activated_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [tenantId, assistantId, channelId, hostname, target],
  );
  return serialize(created.rows[0]);
}

export async function repairEligibleGuideDomains({ database, environment = process.env }) {
  const eligible = await database.query(
    `SELECT ci.tenant_id, ci.assistant_id, ci.channel_id
       FROM channel_integrations ci
       JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
       JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
      WHERE ci.integration_type = 'SAMCHEGUIDE'
        AND ci.enabled = TRUE
        AND tc.channel_type = 'SAMCHEGUIDE'
        AND tc.status = 'active'
        AND a.status = 'active'`,
  );
  const repaired = [];
  for (const row of eligible.rows) {
    const domain = await ensureManagedGuideDomainForAssistant({
      database,
      tenantId: row.tenant_id,
      assistantId: row.assistant_id,
      channelId: row.channel_id,
      environment,
    });
    repaired.push(domain);
  }
  return repaired;
}

export async function archiveGuideDomain({ client, tenantId, assistantId, domainId, actorUserId }) {
  const archived = await client.query(
    `UPDATE guide_domains SET status='ARCHIVED', archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, updated_by=$4
      WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3 AND status IN ('PENDING','VERIFIED','FAILED','ACTIVE')
      RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
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
      RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
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
        WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3
        RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
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
      WHERE id=$1 AND tenant_id=$2 AND assistant_id=$3
      RETURNING id, tenant_id, assistant_id, channel_id, hostname, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [domainId, tenantId, assistantId, actorUserId],
  );
  await client.query(
    `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type)
     VALUES ($1,$2,$3,$4,'VERIFIED')`,
    [tenantId, assistantId, domainId, actorUserId],
  );
  return serialize(verified.rows[0]);
}
