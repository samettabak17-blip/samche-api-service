/**
 * services/meta-graph-api-version.js
 *
 * Canonical, generic resolution of the Meta Graph API version used by every
 * WhatsApp Cloud API provider call.
 *
 * Meta expires Graph API versions on a published schedule (for example v20.0
 * expires 2026-09-24). A version hardcoded across provider call sites becomes a
 * platform-wide outage with no safe remediation path. This module keeps the
 * version a single configurable platform concern so the shared platform can be
 * moved forward for every tenant without touching provider call sites and
 * without any tenant-specific branch.
 *
 * Provider independence: this is Meta-transport configuration only. It never
 * participates in tenant resolution, authorization, or business truth.
 */

// Canonical platform default. Chosen as a currently supported, non-expiring
// Graph API version so the shared platform is never pinned to an expiring one.
export const DEFAULT_META_GRAPH_API_VERSION = 'v23.0';

const VERSION_PATTERN = /^v\d+\.\d+$/;

/**
 * Resolves the configured Meta Graph API version.
 * Accepts `v23.0` or a bare `23.0` and fails safe to the platform default when
 * configuration is absent or malformed, so a bad environment value can never
 * produce an invalid provider URL.
 */
export function resolveMetaGraphApiVersion(env = process.env) {
  const configured = String(env?.WHATSAPP_GRAPH_API_VERSION ?? '').trim().toLowerCase();
  if (!configured) return DEFAULT_META_GRAPH_API_VERSION;
  const candidate = configured.startsWith('v') ? configured : `v${configured}`;
  return VERSION_PATTERN.test(candidate) ? candidate : DEFAULT_META_GRAPH_API_VERSION;
}

/**
 * Canonical Graph API base URL for WhatsApp Cloud API provider calls.
 */
export function metaGraphApiBase(env = process.env) {
  return `https://graph.facebook.com/${resolveMetaGraphApiVersion(env)}`;
}
