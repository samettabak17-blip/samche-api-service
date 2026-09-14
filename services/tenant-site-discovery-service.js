import { safeFetchUrl, validateSafeUrl, resolveAndValidateDns, isPrivateOrBlockedIp, UrlIntelligenceError } from './url-intelligence-service.js';
import { extractTenantPageIntelligence, extractInternalLinks } from './tenant-site-extraction-service.js';
import { upsertTenantSitePage, upsertTenantSiteDiscoveryState, getTenantSiteDiscoveryState, markStalePagesRetired } from './tenant-site-index-service.js';

export const DISCOVERY_LIMITS = Object.freeze({
  MAX_DISCOVERED_PAGES: 60,
  MAX_CONCURRENT_FETCHES: 3,
  DISCOVERY_COOLDOWN_HOURS: 24,
  MAX_SITEMAP_DEPTH: 3,
});

export function normalizeSiteUrl(rawUrl, baseUrl = null) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  try {
    const resolved = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;

    resolved.hash = '';
    const paramsToStrip = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid'];
    for (const p of paramsToStrip) {
      resolved.searchParams.delete(p);
    }

    let clean = resolved.toString();
    if (resolved.pathname !== '/' && clean.endsWith('/')) {
      clean = clean.slice(0, -1);
    }
    return clean;
  } catch {
    return null;
  }
}

export function parseSitemapXmlUrls(xmlContent, baseHostname) {
  if (typeof xmlContent !== 'string') return { pageUrls: [], sitemapUrls: [] };
  const pageUrls = [];
  const sitemapUrls = [];

  const locRegex = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xmlContent)) !== null) {
    const rawLoc = match[1]?.trim();
    if (!rawLoc) continue;
    try {
      const parsed = new URL(rawLoc);
      if (parsed.hostname.toLowerCase() === baseHostname) {
        if (/\.xml(?:\?|$)/i.test(parsed.pathname) || parsed.pathname.includes('/sitemap')) {
          sitemapUrls.push(parsed.toString());
        } else {
          pageUrls.push(parsed.toString());
        }
      }
    } catch {}
  }

  return { pageUrls, sitemapUrls };
}

export async function discoverSitemapUrls(rootUrl, { fetchImpl = null } = {}) {
  let parsedRoot;
  try {
    parsedRoot = new URL(rootUrl);
  } catch {
    return [];
  }

  const baseOrigin = parsedRoot.origin;
  const baseHostname = parsedRoot.hostname.toLowerCase();
  const candidateSitemaps = [
    `${baseOrigin}/sitemap.xml`,
    `${baseOrigin}/sitemap_index.xml`,
    `${baseOrigin}/sitemap-index.xml`,
    `${baseOrigin}/wp-sitemap.xml`,
  ];

  // 1. Check robots.txt for Sitemap directive
  try {
    const robotsRes = await safeFetchUrl(`${baseOrigin}/robots.txt`, { fetchImpl, maxSizeBytes: 32768, timeoutMs: 4000, allowXmlOrText: true });
    if (robotsRes && robotsRes.html) {
      const sitemapMatches = robotsRes.html.match(/^Sitemap:\s*(\S+)/gim) || [];
      for (const line of sitemapMatches) {
        const smUrl = line.replace(/^Sitemap:\s*/i, '').trim();
        if (smUrl && !candidateSitemaps.includes(smUrl)) {
          candidateSitemaps.unshift(smUrl);
        }
      }
    }
  } catch {}

  const discoveredPageUrls = new Set();
  const visitedSitemaps = new Set();
  const sitemapsToFetch = [...candidateSitemaps];

  while (sitemapsToFetch.length > 0 && visitedSitemaps.size < DISCOVERY_LIMITS.MAX_SITEMAP_DEPTH) {
    const sitemapUrl = sitemapsToFetch.shift();
    if (visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);

    try {
      const res = await safeFetchUrl(sitemapUrl, { fetchImpl, maxSizeBytes: 262144, timeoutMs: 5000, allowXmlOrText: true });
      if (res && res.html) {
        const { pageUrls, sitemapUrls } = parseSitemapXmlUrls(res.html, baseHostname);
        for (const u of pageUrls) {
          const norm = normalizeSiteUrl(u);
          if (norm) discoveredPageUrls.add(norm);
          if (discoveredPageUrls.size >= DISCOVERY_LIMITS.MAX_DISCOVERED_PAGES) break;
        }
        for (const sm of sitemapUrls) {
          if (!visitedSitemaps.has(sm)) sitemapsToFetch.push(sm);
        }
      }
    } catch {}

    if (discoveredPageUrls.size >= DISCOVERY_LIMITS.MAX_DISCOVERED_PAGES) break;
  }

  return Array.from(discoveredPageUrls);
}

export async function crawlInternalLinks(seedUrl, { fetchImpl = null, maxPages = 30 } = {}) {
  let parsedSeed;
  try {
    parsedSeed = new URL(seedUrl);
  } catch {
    return [];
  }

  const baseHostname = parsedSeed.hostname.toLowerCase();
  const queue = [seedUrl];
  const visited = new Set();
  const discovered = new Set([seedUrl]);

  while (queue.length > 0 && discovered.size < maxPages) {
    const currentUrl = queue.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      const res = await safeFetchUrl(currentUrl, { fetchImpl, maxSizeBytes: 262144, timeoutMs: 5000, allowXmlOrText: true });
      if (res && res.html) {
        const links = extractInternalLinks(res.html, currentUrl);
        for (const link of links) {
          const norm = normalizeSiteUrl(link);
          if (norm && !discovered.has(norm)) {
            try {
              if (new URL(norm).hostname.toLowerCase() === baseHostname) {
                discovered.add(norm);
                queue.push(norm);
                if (discovered.size >= maxPages) break;
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  return Array.from(discovered);
}

export async function discoverAndIndexTenantSite({
  database,
  tenantId,
  rootUrl,
  options = {},
}) {
  if (!database || !tenantId || !rootUrl) {
    throw new Error('MISSING_REQUIRED_DISCOVERY_PARAMETERS');
  }

  const parsed = validateSafeUrl(rootUrl);
  const baseOrigin = parsed.origin;
  const baseHostname = parsed.hostname.toLowerCase();
  const fetchImpl = options.fetchImpl || null;
  const maxPages = options.maxPages || DISCOVERY_LIMITS.MAX_DISCOVERED_PAGES;

  // Record initial discovery status
  await upsertTenantSiteDiscoveryState({
    database,
    tenantId,
    hostname: baseHostname,
    rootUrl: baseOrigin,
    status: 'DISCOVERING',
    discoverySource: 'AUTO',
  });

  let discoveredUrls = [];
  let source = 'SITEMAP';

  try {
    discoveredUrls = await discoverSitemapUrls(baseOrigin, { fetchImpl });
    if (!discoveredUrls || discoveredUrls.length < 2) {
      source = 'INTERNAL_LINKS';
      const crawledUrls = await crawlInternalLinks(baseOrigin, { fetchImpl, maxPages });
      discoveredUrls = [...new Set([...discoveredUrls, ...crawledUrls])];
    }
  } catch (err) {
    source = 'INTERNAL_LINKS';
    const crawledUrls = await crawlInternalLinks(baseOrigin, { fetchImpl, maxPages });
    discoveredUrls = crawledUrls;
  }

  if (discoveredUrls.length === 0) {
    discoveredUrls = [baseOrigin];
  }

  // Always ensure root homepage is in the list
  if (!discoveredUrls.includes(baseOrigin) && !discoveredUrls.includes(`${baseOrigin}/`)) {
    discoveredUrls.unshift(baseOrigin);
  }

  const boundedUrls = discoveredUrls.slice(0, maxPages);
  let indexedCount = 0;
  const successfullyIndexed = [];

  for (const pageUrl of boundedUrls) {
    try {
      const res = await safeFetchUrl(pageUrl, { fetchImpl, maxSizeBytes: 300000, timeoutMs: 6000, allowXmlOrText: true });
      if (res && res.html) {
        const intelligence = extractTenantPageIntelligence(res.html, pageUrl);
        const saved = await upsertTenantSitePage({
          database,
          tenantId,
          pageData: {
            ...intelligence,
            crawl_status: 'INDEXED',
            http_status: res.status,
          },
        });
        if (saved) {
          indexedCount++;
          successfullyIndexed.push(pageUrl);
        }
      }
    } catch (pageErr) {
      console.warn(`[SITE_DISCOVERY_PAGE_WARN] Failed to index ${pageUrl}:`, pageErr?.message || pageErr);
    }
  }

  // Update discovery state to INDEXED
  await upsertTenantSiteDiscoveryState({
    database,
    tenantId,
    hostname: baseHostname,
    rootUrl: baseOrigin,
    status: 'INDEXED',
    pagesDiscovered: boundedUrls.length,
    pagesIndexed: indexedCount,
    discoverySource: source,
  });

  return {
    hostname: baseHostname,
    rootUrl: baseOrigin,
    source,
    discoveredCount: boundedUrls.length,
    indexedCount,
    indexedPages: successfullyIndexed,
  };
}

const activeDiscoveryJobs = new Map();

export function triggerTenantSiteDiscoveryBackground({ database, tenantId, rootUrl, options = {} }) {
  if (!database || !tenantId || !rootUrl) return;

  let hostname = '';
  try {
    hostname = new URL(rootUrl).hostname.toLowerCase();
  } catch {
    return;
  }

  const jobKey = `${tenantId}:${hostname}`;
  if (activeDiscoveryJobs.has(jobKey)) {
    return; // Already running in background
  }

  activeDiscoveryJobs.set(jobKey, Date.now());

  setImmediate(async () => {
    try {
      await discoverAndIndexTenantSite({ database, tenantId, rootUrl, options });
    } catch (err) {
      console.warn(`[BACKGROUND_SITE_DISCOVERY_ERROR] tenant=${tenantId} host=${hostname}:`, err?.message || err);
    } finally {
      activeDiscoveryJobs.delete(jobKey);
    }
  });
}
