import { GuideDomainError, normalizeGuideHostname } from './guide-domain-service.js';

const RENDER_API_BASE_URL = 'https://api.render.com/v1';

function configuredRenderIngress(environment = process.env) {
  const apiKey = environment.RENDER_API_KEY;
  const serviceId = environment.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) throw new GuideDomainError('GUIDE_DOMAIN_INGRESS_UNAVAILABLE');
  return { apiKey, serviceId };
}

function safeIngressFailure(status) {
  if (status === 401 || status === 403) return 'GUIDE_DOMAIN_INGRESS_AUTH_FAILED';
  if (status === 402) return 'GUIDE_DOMAIN_INGRESS_PLAN_UNAVAILABLE';
  if (status === 409) return 'GUIDE_DOMAIN_INGRESS_CONFLICT';
  if (status === 429) return 'GUIDE_DOMAIN_INGRESS_RATE_LIMITED';
  return 'GUIDE_DOMAIN_INGRESS_FAILED';
}

async function renderRequest({ fetchImpl, apiKey, path, method, body }) {
  let response;
  try {
    response = await fetchImpl(`${RENDER_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new GuideDomainError('GUIDE_DOMAIN_INGRESS_FAILED');
  }
  return response;
}

// The Dashboard never talks to a hosting vendor. This platform-owned adapter
// registers an exact hostname with the shared ingress before DNS verification.
export async function provisionGuideDomainIngress({ hostname, environment = process.env, fetchImpl = fetch }) {
  const normalized = normalizeGuideHostname(hostname);
  const { apiKey, serviceId } = configuredRenderIngress(environment);
  const response = await renderRequest({
    fetchImpl,
    apiKey,
    path: `/services/${encodeURIComponent(serviceId)}/custom-domains`,
    method: 'POST',
    body: { name: normalized },
  });
  if (response.status === 201 || response.status === 409) {
    return { provider: 'RENDER', hostname: normalized, state: response.status === 201 ? 'REGISTERED' : 'EXISTING' };
  }
  throw new GuideDomainError(safeIngressFailure(response.status));
}

export async function verifyGuideDomainIngress({ hostname, environment = process.env, fetchImpl = fetch }) {
  const normalized = normalizeGuideHostname(hostname);
  const { apiKey, serviceId } = configuredRenderIngress(environment);
  const response = await renderRequest({
    fetchImpl,
    apiKey,
    path: `/services/${encodeURIComponent(serviceId)}/custom-domains/${encodeURIComponent(normalized)}/verify`,
    method: 'POST',
  });
  if (response.status === 202 || response.status === 200 || response.status === 409) {
    return { provider: 'RENDER', hostname: normalized, state: 'VERIFICATION_REQUESTED' };
  }
  throw new GuideDomainError(safeIngressFailure(response.status));
}

function selectRenderCustomDomain(payload, hostname) {
  const candidates = Array.isArray(payload)
    ? payload
    : (payload?.items ?? payload?.data ?? payload?.customDomains ?? (payload?.customDomain ? [payload] : Object.values(payload ?? {})));
  const entries = candidates.flatMap((entry) => entry?.customDomain ? [entry.customDomain] : [entry]);
  return entries.find((entry) => String(entry?.name ?? '').toLowerCase() === hostname) ?? null;
}

export async function resolveGuideDomainIngressStatus({ hostname, environment = process.env, fetchImpl = fetch }) {
  const normalized = normalizeGuideHostname(hostname);
  const { apiKey, serviceId } = configuredRenderIngress(environment);
  const response = await renderRequest({
    fetchImpl,
    apiKey,
    // Render's `name` filter is an array query parameter.  Listing the
    // service domains and selecting the exact normalized hostname keeps this
    // adapter compatible across API versions while preserving tenant-side
    // hostname scoping in the SamChe domain table.
    path: `/services/${encodeURIComponent(serviceId)}/custom-domains?limit=100`,
    method: 'GET',
  });
  if (response.status !== 200) throw new GuideDomainError(safeIngressFailure(response.status));
  let payload;
  try { payload = await response.json(); } catch { throw new GuideDomainError('GUIDE_DOMAIN_INGRESS_FAILED'); }
  const domain = selectRenderCustomDomain(payload, normalized);
  if (!domain) throw new GuideDomainError('GUIDE_DOMAIN_INGRESS_CONFLICT');
  const verification = String(domain.verificationStatus ?? domain.verification_status ?? '').toLowerCase();
  return {
    provider: 'RENDER',
    hostname: normalized,
    verified: verification === 'verified',
    state: verification === 'verified' ? 'VERIFIED' : 'PENDING',
  };
}

export async function archiveGuideDomainIngress({ hostname, environment = process.env, fetchImpl = fetch }) {
  const normalized = normalizeGuideHostname(hostname);
  const { apiKey, serviceId } = configuredRenderIngress(environment);
  const response = await renderRequest({
    fetchImpl,
    apiKey,
    path: `/services/${encodeURIComponent(serviceId)}/custom-domains/${encodeURIComponent(normalized)}`,
    method: 'DELETE',
  });
  if (response.status === 204 || response.status === 200 || response.status === 404) {
    return { provider: 'RENDER', hostname: normalized, state: 'ARCHIVED' };
  }
  throw new GuideDomainError(safeIngressFailure(response.status));
}
