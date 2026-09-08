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

export function normalizeGuideSlug(slug) {
  if (typeof slug !== 'string') throw new GuideDomainError('GUIDE_DOMAIN_INVALID_SLUG');
  let raw = slug.trim().toLowerCase().replace(/\.$/, '');
  try {
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const parsed = new URL(raw);
      raw = parsed.pathname.replace(/^\/+|\/+$/g, '') || parsed.hostname;
    }
  } catch {}
  const knownHosts = [
    'guide-staging.samchecompany.com',
    'guide.staging.samchecompany.com',
    'guide.samchecompany.com',
  ];
  for (const host of knownHosts) {
    if (raw.startsWith(`${host}/`)) {
      raw = raw.slice(host.length + 1);
    }
    while (raw.endsWith(`.${host}`)) {
      raw = raw.slice(0, -(host.length + 1));
    }
  }
  raw = raw.replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(raw)) {
    throw new GuideDomainError('GUIDE_DOMAIN_INVALID_SLUG');
  }
  return raw;
}
export async function allocateDeterministicManagedSlug({ database, baseSlug, tenantId, assistantId }) {
  const normalized = normalizeGuideSlug(baseSlug);

  // Check if current tenant & assistant already owns this slug
  const ownRow = await database.query(
    `SELECT id FROM guide_domains WHERE lower(slug) = $1 AND tenant_id = $2 AND assistant_id = $3 AND domain_mode = 'MANAGED'`,
    [normalized, tenantId, assistantId],
  );
  if (ownRow.rowCount > 0) {
    return normalized;
  }

  // Check if base slug is globally available among MANAGED domains
  const conflict = await database.query(
    `SELECT id FROM guide_domains WHERE lower(slug) = $1 AND domain_mode = 'MANAGED'`,
    [normalized],
  );
  if (!conflict.rowCount) {
    return normalized;
  }

  // Conflict exists: allocate deterministic collision-safe slug
  const tenantSuffix = String(tenantId).replace(/-/g, '').slice(0, 6).toLowerCase();
  const trimmedBase = normalized.slice(0, 25).replace(/-+$/, '');
  const candidate1 = `${trimmedBase}-${tenantSuffix}`;

  const conflict1 = await database.query(
    `SELECT id FROM guide_domains WHERE lower(slug) = $1 AND (tenant_id != $2 OR assistant_id != $3) AND domain_mode = 'MANAGED'`,
    [candidate1, tenantId, assistantId],
  );
  if (!conflict1.rowCount) {
    return candidate1;
  }

  // If candidate1 also conflicts, append assistant suffix
  const assistantSuffix = String(assistantId || '').replace(/-/g, '').slice(0, 4).toLowerCase() || '0000';
  const trimmedBase2 = normalized.slice(0, 20).replace(/-+$/, '');
  return `${trimmedBase2}-${tenantSuffix}-${assistantSuffix}`;
}


export function guideDomainCacheKey({ hostname, tenantId, assistantId }) {
  return `guide-domain:${normalizeGuideHostname(hostname)}:${tenantId}:${assistantId}`;
}

export function configuredGuideDomainIngressTarget(environment = process.env) {
  const target = environment.GUIDE_DOMAIN_INGRESS_TARGET;
  if (!target) throw new GuideDomainError('GUIDE_DOMAIN_INGRESS_UNAVAILABLE');
  return normalizeGuideHostname(target);
}

export function configuredManagedGuideHostname(environment = process.env) {
  const configured = environment.GUIDE_MANAGED_HOST || environment.GUIDE_MANAGED_DOMAIN;
  if (configured) return normalizeGuideHostname(configured);

  const environmentMarkers = [
    environment.RENDER_GIT_BRANCH,
    environment.APP_ENV,
    environment.NODE_ENV,
    environment.RENDER_SERVICE_NAME,
    environment.RENDER_EXTERNAL_HOSTNAME,
  ].map((value) => String(value ?? '').toLowerCase());
  const staging = environmentMarkers.some((value) => value === 'staging' || value.includes('staging'));
  const production = (environment.NODE_ENV || environment.APP_ENV) === 'production' && !staging;

  const configuredSuffix = environment.GUIDE_MANAGED_DOMAIN_SUFFIX;
  if (configuredSuffix && configuredSuffix !== 'guide.samchecompany.com' && configuredSuffix !== 'guide.staging.samchecompany.com') {
    return normalizeGuideHostname(configuredSuffix);
  }

  return production ? 'guide.samchecompany.com' : 'guide-staging.samchecompany.com';
}

export function configuredManagedGuideDomainSuffix(environment = process.env) {
  return configuredManagedGuideHostname(environment);
}

export function managedGuideUrlFromSlug(slug, environment = process.env) {
  const normalized = normalizeGuideSlug(slug);
  const host = configuredManagedGuideHostname(environment);
  return `https://${host}/${normalized}`;
}

export function managedGuideHostnameFromSlug(slug, environment = process.env) {
  normalizeGuideSlug(slug);
  return configuredManagedGuideHostname(environment);
}

export function isManagedGuidePlatformHost(hostname, environment = process.env) {
  if (!hostname || typeof hostname !== 'string') return false;
  let normalized;
  try { normalized = normalizeGuideHostname(hostname); } catch { return false; }
  const canonical = configuredManagedGuideHostname(environment);
  if (normalized === canonical) return true;
  const knownPlatformHosts = [
    'guide-staging.samchecompany.com',
    'guide.staging.samchecompany.com',
    'guide.samchecompany.com',
  ];
  return knownPlatformHosts.includes(normalized) || normalized.endsWith('.guide.staging.samchecompany.com');
}

function integrationIsHealthy(row) {
  return row
    && row.channel_type === 'SAMCHEGUIDE'
    && row.channel_status === 'active'
    && row.assistant_status === 'active'
    && row.integration_enabled === true
    && (row.channel_assistant_id === row.assistant_id || (!row.channel_assistant_id && row.assistant_id));
}

export async function resolveActiveGuideDomain({ database, hostname }) {
  let normalized;
  try { normalized = normalizeGuideHostname(hostname); } catch { return null; }
  const result = await database.query(
    `SELECT gd.id AS domain_id, gd.hostname, gd.slug, gd.tenant_id, gd.assistant_id, gd.channel_id,
            tc.assistant_id AS channel_assistant_id, tc.channel_type, tc.status AS channel_status,
            ci.enabled AS integration_enabled,
            a.status AS assistant_status
       FROM guide_domains gd
       JOIN tenant_channels tc ON tc.id = gd.channel_id AND tc.tenant_id = gd.tenant_id
       JOIN channel_integrations ci ON ci.channel_id = gd.channel_id AND ci.tenant_id = gd.tenant_id
         AND (ci.assistant_id = gd.assistant_id OR ci.assistant_id IS NULL) AND ci.integration_type = 'SAMCHEGUIDE' AND ci.enabled = TRUE
       JOIN ai_assistants a ON a.id = gd.assistant_id AND a.tenant_id = gd.tenant_id
      WHERE gd.hostname = $1 AND gd.status = 'ACTIVE'
      LIMIT 2`,
    [normalized],
  );
  if (result.rowCount !== 1 || !integrationIsHealthy(result.rows[0])) return null;
  return result.rows[0];
}

export async function resolveActiveManagedGuideDomain({ database, slug }) {
  let normalizedSlug;
  try { normalizedSlug = normalizeGuideSlug(slug); } catch { return null; }
  const result = await database.query(
    `SELECT gd.id AS domain_id, gd.hostname, gd.slug, gd.tenant_id, gd.assistant_id, gd.channel_id,
            tc.assistant_id AS channel_assistant_id, tc.channel_type, tc.status AS channel_status,
            ci.enabled AS integration_enabled,
            a.status AS assistant_status
       FROM guide_domains gd
       JOIN tenant_channels tc ON tc.id = gd.channel_id AND tc.tenant_id = gd.tenant_id
       JOIN channel_integrations ci ON ci.channel_id = gd.channel_id AND ci.tenant_id = gd.tenant_id
         AND (ci.assistant_id = gd.assistant_id OR ci.assistant_id IS NULL) AND ci.integration_type = 'SAMCHEGUIDE' AND ci.enabled = TRUE
       JOIN ai_assistants a ON a.id = gd.assistant_id AND a.tenant_id = gd.tenant_id
      WHERE lower(gd.slug) = $1 AND gd.status = 'ACTIVE' AND gd.domain_mode = 'MANAGED'
      LIMIT 2`,
    [normalizedSlug],
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

export function extractGuideSlug(req) {
  if (req?.params?.slug) {
    try { return normalizeGuideSlug(req.params.slug); } catch { return null; }
  }

  const getHeader = (name) => (typeof req?.get === 'function' ? req.get(name) : req?.headers?.[name.toLowerCase()]);
  const headerSlug = getHeader('X-Samcheguide-Slug') || req?.query?.slug;
  if (typeof headerSlug === 'string' && headerSlug.trim()) {
    try { return normalizeGuideSlug(headerSlug); } catch { return null; }
  }

  const pathname = (typeof req?.originalUrl === 'string' ? req.originalUrl : req?.path) || '';
  const cleanPath = pathname.split('?')[0];
  const parts = cleanPath.split('/').filter(Boolean);
  if (parts.length > 0 && !['guide', 'chat', 'api', 'webhook', 'ping', 'plan', 'health'].includes(parts[0])) {
    try { return normalizeGuideSlug(parts[0]); } catch { return null; }
  }
  if (parts.length > 1 && parts[0] === 'guide' && !['guide', 'chat', 'api', 'webhook', 'ping', 'plan', 'health', 'bootstrap', 'assets', 'session-context'].includes(parts[1])) {
    try { return normalizeGuideSlug(parts[1]); } catch { return null; }
  }

  const referer = getHeader('referer') || getHeader('referrer');
  if (typeof referer === 'string' && referer.trim()) {
    try {
      const refUrl = new URL(referer);
      if (isManagedGuidePlatformHost(refUrl.hostname)) {
        const refParts = refUrl.pathname.split('/').filter(Boolean);
        if (refParts.length > 0 && !['guide', 'chat', 'api', 'webhook', 'ping', 'plan', 'health'].includes(refParts[0])) {
          return normalizeGuideSlug(refParts[0]);
        }
      }
    } catch {}
  }

  return null;
}

export async function resolveGuideRuntimeScopeFromRequest({ database, req }) {
  try {
    const host = requestGuideHostname(req);
    const slug = extractGuideSlug(req);
    const isManaged = isManagedGuidePlatformHost(host);
    const getHeader = (name) => (typeof req?.get === 'function' ? req.get(name) : req?.headers?.[name.toLowerCase()]);
    const previewToken = getHeader('X-Samcheguide-Preview') || req?.query?.preview;
    const sessionToken = getHeader('X-Samcheguide-Session');

    // 1. Managed Platform Host with Path Slug
    if (slug) {
      const managedScope = await resolveActiveManagedGuideDomain({ database, slug });
      if (managedScope) {
        if (typeof previewToken === 'string' && previewToken.trim()) {
          try {
            const claims = verifyGuidePreviewToken(previewToken.trim());
            if (claims?.tenant_id !== managedScope.tenant_id || claims?.assistant_id !== managedScope.assistant_id) {
              return null;
            }
          } catch {
            return null;
          }
        }
        if (typeof sessionToken === 'string' && sessionToken.length >= 32) {
          try {
            const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
            const sessionScope = await database.query(
              `SELECT tenant_id FROM guide_public_sessions WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP LIMIT 1`,
              [tokenHash],
            );
            if (sessionScope.rowCount && sessionScope.rows[0].tenant_id !== managedScope.tenant_id) {
              return null;
            }
          } catch {}
        }
        return managedScope;
      }

      if (typeof previewToken === 'string' && previewToken.trim()) {
        try {
          const claims = verifyGuidePreviewToken(previewToken.trim());
          if (claims?.tenant_id && claims?.assistant_id) {
            const domainResult = await database.query(
              `SELECT gd.id AS domain_id, gd.hostname, gd.slug, ci.tenant_id, ci.assistant_id, ci.channel_id,
                      tc.assistant_id AS channel_assistant_id, tc.channel_type, tc.status AS channel_status,
                      ci.enabled AS integration_enabled,
                      a.status AS assistant_status
                 FROM guide_domains gd
                 JOIN channel_integrations ci ON ci.tenant_id = gd.tenant_id AND ci.assistant_id = gd.assistant_id AND ci.channel_id = gd.channel_id
                 JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
                 JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
                WHERE lower(gd.slug) = $1
                  AND gd.tenant_id = $2
                  AND gd.assistant_id = $3
                  AND ci.integration_type = 'SAMCHEGUIDE'
                  AND ci.enabled = TRUE
                  AND tc.channel_type = 'SAMCHEGUIDE'
                  AND tc.status = 'active'
                  AND a.status = 'active'
                LIMIT 1`,
              [normalizeGuideSlug(slug), claims.tenant_id, claims.assistant_id],
            );
            if (domainResult.rowCount === 1 && integrationIsHealthy(domainResult.rows[0])) {
              return domainResult.rows[0];
            }
          }
        } catch {}
      }

      return null;
    }

    // 2. Custom Domain: Resolve by dedicated active hostname
    if (host && !isManaged) {
      const direct = await resolveActiveGuideDomain({ database, hostname: host });
      if (direct) {
        if (typeof previewToken === 'string' && previewToken.trim()) {
          try {
            const claims = verifyGuidePreviewToken(previewToken.trim());
            if (claims?.tenant_id !== direct.tenant_id || claims?.assistant_id !== direct.assistant_id) {
              return null;
            }
          } catch {
            return null;
          }
        }
        return direct;
      }
    }

    // 3. Shared Host / Preview Context (fallback without slug)
    if (typeof previewToken === 'string' && previewToken.trim()) {
      try {
        const claims = verifyGuidePreviewToken(previewToken.trim());
        if (claims?.tenant_id && claims?.assistant_id) {
          const previewResult = await database.query(
            `SELECT gd.id AS domain_id, gd.hostname, gd.slug, ci.tenant_id, ci.assistant_id, ci.channel_id,
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
              scope.slug = provisioned.slug;
            }
            return scope;
          }
        }
      } catch {}
    }

    // 4. Shared Host / Session Context (fallback without slug for non-managed hosts)
    if (!isManaged && typeof sessionToken === 'string' && sessionToken.length >= 32) {
      try {
        const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
        const sessionResult = await database.query(
          `SELECT gps.domain_id, gd.hostname, gd.slug, gps.tenant_id, gps.assistant_id, gps.channel_id,
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
    slug: row.slug ?? null,
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
    `SELECT id, tenant_id, assistant_id, channel_id, hostname, slug, status, verification_record_type,
            domain_mode,
            verification_target, verified_at, activated_at, archived_at, created_at
       FROM guide_domains WHERE tenant_id=$1 AND assistant_id=$2 ORDER BY created_at DESC`,
    [tenantId, assistantId],
  );
  return result.rows.map(serialize);
}

export async function createGuideDomain({ client, tenantId, assistantId, channelId, hostname, slug, actorUserId, ingressTarget, domainMode = 'CUSTOM', disambiguateSlug = false }) {
  if (!['MANAGED', 'CUSTOM'].includes(domainMode)) throw new GuideDomainError('GUIDE_DOMAIN_MODE_INVALID');
  const isManaged = domainMode === 'MANAGED';
  let target;
  let normalizedHostname;
  let normalizedSlug = null;

  if (isManaged) {
    if (disambiguateSlug) {
      normalizedSlug = await allocateDeterministicManagedSlug({
        database: client,
        baseSlug: slug || `t-${String(tenantId).replace(/-/g, '').slice(0, 12)}`,
        tenantId,
        assistantId,
      });
    } else {
      normalizedSlug = normalizeGuideSlug(slug);
      const slugConflict = await client.query(
        `SELECT id FROM guide_domains WHERE lower(slug) = $1 AND (tenant_id != $2 OR assistant_id != $3)`,
        [normalizedSlug, tenantId, assistantId],
      );
      if (slugConflict.rowCount) {
        throw new GuideDomainError('GUIDE_DOMAIN_HOSTNAME_EXISTS', 'This domain or slug is already bound to another Guide.');
      }
    }
    normalizedHostname = configuredManagedGuideHostname();
    target = ingressTarget || configuredGuideDomainIngressTarget();
  } else {
    normalizedHostname = normalizeGuideHostname(hostname);
    target = ingressTarget;
    const hostConflict = await client.query(
      `SELECT id FROM guide_domains WHERE lower(hostname) = $1 AND domain_mode = 'CUSTOM' AND (tenant_id != $2 OR assistant_id != $3)`,
      [normalizedHostname, tenantId, assistantId],
    );
    if (hostConflict.rowCount) {
      throw new GuideDomainError('GUIDE_DOMAIN_HOSTNAME_EXISTS', 'This domain or slug is already bound to another Guide.');
    }
  }

  const initialStatus = isManaged ? 'ACTIVE' : 'PENDING';
  const activeTimestamp = initialStatus === 'ACTIVE' ? new Date() : null;
  const created = await client.query(
    `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'CNAME', $8, $9, $10, $11)
     RETURNING id, tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [tenantId, assistantId, channelId, normalizedHostname, normalizedSlug, initialStatus, domainMode, target, activeTimestamp, activeTimestamp, actorUserId],
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

export async function ensureGuideChannelForAssistant({ database, tenantId, assistantId }) {
  if (!database?.query) throw new GuideDomainError('GUIDE_DOMAIN_DATABASE_INVALID');
  const assistantResult = await database.query(
    `SELECT id, name, status FROM ai_assistants WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
    [assistantId, tenantId],
  );
  if (!assistantResult.rowCount) {
    throw new GuideDomainError('GUIDE_DOMAIN_ASSISTANT_NOT_FOUND', 'Active assistant required for Guide channel.');
  }

  // 1. Check for existing active SAMCHEGUIDE channel for this assistant
  let channel = null;
  const existingChannel = await database.query(
    `SELECT id, tenant_id, assistant_id, channel_type, display_name, external_channel_id, status
       FROM tenant_channels
      WHERE tenant_id = $1 AND assistant_id = $2 AND channel_type = 'SAMCHEGUIDE'
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, assistantId],
  );

  if (existingChannel.rowCount) {
    channel = existingChannel.rows[0];
    if (channel.status !== 'active') {
      const activated = await database.query(
        `UPDATE tenant_channels SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, assistant_id, channel_type, display_name, external_channel_id, status`,
        [channel.id, tenantId],
      );
      channel = activated.rows[0];
    }
  } else {
    // 2. Check for any historical unassigned SAMCHEGUIDE channel in this tenant
    const unassignedChannel = await database.query(
      `SELECT id, tenant_id, assistant_id, channel_type, display_name, external_channel_id, status
         FROM tenant_channels
        WHERE tenant_id = $1 AND assistant_id IS NULL AND channel_type = 'SAMCHEGUIDE'
        ORDER BY created_at ASC
        LIMIT 1`,
      [tenantId],
    );
    if (unassignedChannel.rowCount) {
      const updated = await database.query(
        `UPDATE tenant_channels
            SET assistant_id = $1, status = 'active', updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND tenant_id = $3
          RETURNING id, tenant_id, assistant_id, channel_type, display_name, external_channel_id, status`,
        [assistantId, unassignedChannel.rows[0].id, tenantId],
      );
      channel = updated.rows[0];
    } else {
      const inserted = await database.query(
        `INSERT INTO tenant_channels (tenant_id, assistant_id, channel_type, display_name, external_channel_id, status)
         VALUES ($1, $2, 'SAMCHEGUIDE', 'AI Guide', $3, 'active')
         ON CONFLICT (tenant_id, channel_type, external_channel_id)
         DO UPDATE SET assistant_id = EXCLUDED.assistant_id, status = 'active', updated_at = CURRENT_TIMESTAMP
         RETURNING id, tenant_id, assistant_id, channel_type, display_name, external_channel_id, status`,
        [tenantId, assistantId, `guide:${assistantId}`],
      );
      channel = inserted.rows[0];
    }
  }

  // 3. Ensure channel_integrations row exists and links channel to assistant
  const existingIntegration = await database.query(
    `SELECT id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled
       FROM channel_integrations
      WHERE tenant_id = $1 AND channel_id = $2 AND integration_type = 'SAMCHEGUIDE'
      LIMIT 1`,
    [tenantId, channel.id],
  );

  let integration = null;
  if (existingIntegration.rowCount) {
    integration = existingIntegration.rows[0];
    if (integration.assistant_id !== assistantId || !integration.enabled) {
      const updated = await database.query(
        `UPDATE channel_integrations
            SET assistant_id = $1, enabled = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND tenant_id = $3
          RETURNING id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled`,
        [assistantId, integration.id, tenantId],
      );
      integration = updated.rows[0];
    }
  } else {
    const integrationKey = `guide:${tenantId}:${assistantId}`;
    const inserted = await database.query(
      `INSERT INTO channel_integrations (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
       VALUES ($1, 'SAMCHEGUIDE', $2, $3, $4, TRUE)
       ON CONFLICT (integration_key)
       DO UPDATE SET channel_id = EXCLUDED.channel_id, assistant_id = EXCLUDED.assistant_id, enabled = TRUE, updated_at = CURRENT_TIMESTAMP
       RETURNING id, integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled`,
      [integrationKey, tenantId, channel.id, assistantId],
    );
    integration = inserted.rows[0];
  }

  return { channelId: channel.id, integrationId: integration.id, channel, integration };
}

export async function ensureGuideChannelsForTenant({ database, tenantId }) {
  if (!database?.query) return [];
  const assistants = await database.query(
    `SELECT id, name FROM ai_assistants WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at ASC`,
    [tenantId],
  );
  const ensured = [];
  for (const assistant of assistants.rows) {
    try {
      ensured.push(await ensureGuideChannelForAssistant({ database, tenantId, assistantId: assistant.id }));
    } catch {}
  }
  return ensured;
}


export async function ensureManagedGuideDomainForAssistant({ database, tenantId, assistantId, channelId, slug: desiredSlug, environment = process.env }) {
  const existing = await database.query(
    `SELECT id, tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at
       FROM guide_domains
      WHERE tenant_id = $1 AND assistant_id = $2 AND status = 'ACTIVE'
      LIMIT 1`,
    [tenantId, assistantId],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    // Idempotent historical convergence: update old multi-level staging hostname to canonical platform host + slug
    if (row.domain_mode === 'MANAGED' && (row.hostname?.includes('.guide.staging.samchecompany.com') || !row.slug)) {
      const extractedSlug = row.slug || normalizeGuideSlug(row.hostname);
      const safeSlug = await allocateDeterministicManagedSlug({ database, baseSlug: extractedSlug, tenantId, assistantId });
      const canonicalHost = configuredManagedGuideHostname(environment);
      const updated = await database.query(
        `UPDATE guide_domains
            SET hostname = $1, slug = $2, domain_mode = 'MANAGED', updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
          RETURNING id, tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
        [canonicalHost, safeSlug, row.id],
      );
      return serialize(updated.rows[0]);
    }
    return serialize(row);
  }

  let resolvedChannelId = channelId;
  if (!resolvedChannelId) {
    const ensuredChannel = await ensureGuideChannelForAssistant({ database, tenantId, assistantId });
    resolvedChannelId = ensuredChannel.channelId;
  }

  let target;
  try {
    target = configuredGuideDomainIngressTarget(environment);
  } catch {
    target = 'ingress.samchecompany.com';
  }

  const canonicalHost = configuredManagedGuideHostname(environment);
  const baseSlug = desiredSlug
    ? normalizeGuideSlug(desiredSlug)
    : `t-${String(tenantId).replace(/-/g, '').slice(0, 12)}`;
  const slug = await allocateDeterministicManagedSlug({
    database,
    baseSlug,
    tenantId,
    assistantId,
  });

  const created = await database.query(
    `INSERT INTO guide_domains (tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'MANAGED', 'CNAME', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (lower(slug)) WHERE domain_mode = 'MANAGED'
     DO UPDATE SET
       hostname = EXCLUDED.hostname,
       channel_id = EXCLUDED.channel_id,
       status = 'ACTIVE',
       domain_mode = 'MANAGED',
       verified_at = CURRENT_TIMESTAMP,
       activated_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [tenantId, assistantId, resolvedChannelId, canonicalHost, slug, target],
  );
  return serialize(created.rows[0]);
}

export async function repairEligibleGuideDomains({ database, environment = process.env }) {
  // Ensure channels exist for all active assistants across tenants
  const activeAssistants = await database.query(
    `SELECT id, tenant_id FROM ai_assistants WHERE status = 'active'`,
  );
  for (const row of activeAssistants.rows) {
    try {
      await ensureGuideChannelForAssistant({ database, tenantId: row.tenant_id, assistantId: row.id });
    } catch {}
  }

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
      RETURNING id, tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
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
      RETURNING id, tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
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
    `SELECT id, tenant_id, assistant_id, channel_id, hostname, slug, status, verification_target
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
        RETURNING id, tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
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
      RETURNING id, tenant_id, assistant_id, channel_id, hostname, slug, status, domain_mode, verification_record_type, verification_target, verified_at, activated_at, archived_at, created_at`,
    [domainId, tenantId, assistantId, actorUserId],
  );
  await client.query(
    `INSERT INTO guide_domain_audit_events (tenant_id, assistant_id, domain_id, actor_user_id, event_type)
     VALUES ($1,$2,$3,$4,'VERIFIED')`,
    [tenantId, assistantId, domainId, actorUserId],
  );
  return serialize(verified.rows[0]);
}
