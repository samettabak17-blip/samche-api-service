export function setSamCheFavicon(href: string) {
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) return;
  favicon.dataset.normalHref = href;
  favicon.href = href;
}

/**
 * Canonical asset resolver for Web Chat branding assets.
 * Normalizes relative API asset paths to absolute URLs using the configured API base URL,
 * while preserving valid external HTTP/HTTPS and data URLs.
 */
export function resolveWebChatAssetUrl(url?: string | null, baseUrl?: string): string {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Preserve external absolute URLs and data/blob URIs
  if (/^(https?:|\/\/|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }

  // Determine base URL: explicit param > VITE_API_BASE_URL > window origin
  const base = (
    baseUrl ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
    (typeof window !== 'undefined' && (window as any).__SAMCHE_API_BASE_URL__) ||
    ''
  ).trim().replace(/\/+$/, '');

  if (trimmed.startsWith('/')) {
    return base ? `${base}${trimmed}` : trimmed;
  }

  return base ? `${base}/${trimmed}` : trimmed;
}

