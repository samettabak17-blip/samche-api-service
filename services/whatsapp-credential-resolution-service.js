/**
 * services/whatsapp-credential-resolution-service.js
 *
 * Canonical, generic, multi-tenant WhatsApp Cloud API credential resolution.
 *
 * ARCHITECTURE
 * ------------
 * A single global `WHATSAPP_TOKEN` environment variable is a single-tenant
 * assumption. In a multi-tenant SaaS every tenant's business phone number can
 * belong to a different WABA, and therefore may require a different authorized
 * credential. Resolving the outbound credential from the environment alone
 * silently sends one tenant's message with another tenant's authorization, or
 * fails with an opaque provider 401/403.
 *
 * This service makes the outbound credential a resolved, integration-scoped
 * platform concern:
 *
 *   1. INTEGRATION_SCOPED  - `channel_integrations.config.whatsapp.access_token_env`
 *                            names the environment variable holding the
 *                            credential authorized for that tenant's WABA.
 *                            The secret VALUE is never stored in the database;
 *                            only the reference is. This keeps secrets in the
 *                            platform secret store and out of tenant data.
 *   2. PLATFORM_FALLBACK   - the shared platform credential (`WHATSAPP_TOKEN`)
 *                            when a tenant has not been assigned a dedicated
 *                            credential. This preserves every existing tenant's
 *                            current working behavior (non-regression).
 *
 * This is the smallest safe canonical foundation required for real multi-tenant
 * acceptance, and it is deliberately forward-compatible with Meta Embedded
 * Signup: when Embedded Signup is implemented, the business integration system
 * user token it returns is stored in the platform secret store and referenced
 * per integration through exactly this same resolution contract.
 *
 * Per current Meta guidance, the correct credential for a manual (non-Embedded
 * Signup) Cloud API integration is a long-lived System User access token owned
 * by the business portfolio, granted `whatsapp_business_messaging` and
 * `whatsapp_business_management`, with the app added to the WABA. Temporary
 * 24-hour dashboard tokens are not a valid production mechanism.
 *
 * SAFETY: token values are never logged, returned in diagnostics, or persisted.
 * Only a non-reversible fingerprint and the resolution source are observable.
 */

import { createHash } from 'node:crypto';

export const WHATSAPP_CREDENTIAL_SOURCES = Object.freeze({
  INTEGRATION_SCOPED: 'INTEGRATION_SCOPED',
  PLATFORM_FALLBACK: 'PLATFORM_FALLBACK',
  UNRESOLVED: 'UNRESOLVED',
});

export const PLATFORM_WHATSAPP_TOKEN_ENV = 'WHATSAPP_TOKEN';

export class WhatsAppCredentialError extends Error {
  constructor(code, message = 'WhatsApp credential could not be resolved') {
    super(message);
    this.name = 'WhatsAppCredentialError';
    this.code = code;
  }
}

function trimmed(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

/**
 * Non-reversible credential fingerprint for safe observability. Never exposes
 * any part of the credential itself.
 */
export function credentialFingerprint(token) {
  const normalized = trimmed(token);
  if (!normalized) return 'unconfigured';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Only a conservative environment-variable name is accepted as an integration
 * credential reference. This prevents tenant-supplied configuration from
 * reading arbitrary process environment values (for example DATABASE_URL).
 */
function isAllowedCredentialEnvName(name) {
  return typeof name === 'string' && /^WHATSAPP_[A-Z0-9_]{1,64}$/.test(name);
}

/**
 * Reads the integration-scoped credential reference from canonical channel
 * integration configuration. Returns null when the tenant has no dedicated
 * credential assigned, which is the normal shared-platform case.
 */
export function integrationCredentialEnvName(integrationConfig) {
  const reference = integrationConfig?.whatsapp?.access_token_env;
  return isAllowedCredentialEnvName(reference) ? reference : null;
}

/**
 * Canonical outbound credential resolution.
 *
 * Returns { accessToken, source, envName, fingerprint } and never throws for a
 * missing credential, so callers keep their existing, already-tested provider
 * error semantics.
 */
export function resolveWhatsAppOutboundCredential({ integrationConfig = null, env = process.env } = {}) {
  const scopedEnvName = integrationCredentialEnvName(integrationConfig);
  if (scopedEnvName) {
    const scopedToken = trimmed(env?.[scopedEnvName]);
    if (scopedToken) {
      return {
        accessToken: scopedToken,
        source: WHATSAPP_CREDENTIAL_SOURCES.INTEGRATION_SCOPED,
        envName: scopedEnvName,
        fingerprint: credentialFingerprint(scopedToken),
      };
    }
    // A tenant explicitly assigned a dedicated credential that is absent from
    // the secret store. Silently borrowing the platform credential would send
    // on an unauthorized WABA, so this fails closed as UNRESOLVED.
    return {
      accessToken: null,
      source: WHATSAPP_CREDENTIAL_SOURCES.UNRESOLVED,
      envName: scopedEnvName,
      fingerprint: 'unconfigured',
    };
  }

  const platformToken = trimmed(env?.[PLATFORM_WHATSAPP_TOKEN_ENV]);
  if (platformToken) {
    return {
      accessToken: platformToken,
      source: WHATSAPP_CREDENTIAL_SOURCES.PLATFORM_FALLBACK,
      envName: PLATFORM_WHATSAPP_TOKEN_ENV,
      fingerprint: credentialFingerprint(platformToken),
    };
  }

  return {
    accessToken: null,
    source: WHATSAPP_CREDENTIAL_SOURCES.UNRESOLVED,
    envName: null,
    fingerprint: 'unconfigured',
  };
}

/**
 * Safe, bounded credential diagnostic. Contains no secret material.
 */
export function describeWhatsAppCredentialResolution(resolution) {
  return 'WHATSAPP_CREDENTIAL_RESOLUTION source=' + (resolution?.source ?? 'UNKNOWN')
    + ' env_reference=' + (resolution?.envName ?? 'none')
    + ' credential_fingerprint=' + (resolution?.fingerprint ?? 'unconfigured');
}
