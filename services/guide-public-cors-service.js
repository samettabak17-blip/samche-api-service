function normalizedProtocol(value) {
  const protocol = String(value ?? '').split(',')[0].trim().toLowerCase();
  return protocol === 'http' || protocol === 'https' ? protocol : null;
}

function normalizedHost(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isAllowedGuideCorsOrigin({ origin, requestHost, forwardedProtocol, allowedOrigins = [] }) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const protocol = normalizedProtocol(forwardedProtocol);
    return Boolean(
      protocol
      && !parsed.username
      && !parsed.password
      && parsed.protocol === `${protocol}:`
      && parsed.host.toLowerCase() === normalizedHost(requestHost),
    );
  } catch {
    return false;
  }
}
