import dns from 'node:dns/promises';
import net from 'node:net';
import { PROVENANCE_SOURCES } from './contextual-intelligence-service.js';

export class UrlIntelligenceError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'UrlIntelligenceError';
    this.code = code;
  }
}

export const URL_INTELLIGENCE_LIMITS = Object.freeze({
  MAX_URL_LENGTH: 2048,
  MAX_REDIRECTS: 4,
  DEFAULT_TIMEOUT_MS: 6000,
  MAX_RESPONSE_BYTES: 524288, // 512 KB
  MAX_TITLE_LENGTH: 255,
  MAX_SUMMARY_LENGTH: 1000,
  MAX_ATTRIBUTES_COUNT: 25,
  MAX_ATTR_KEY_LENGTH: 64,
  MAX_ATTR_VAL_LENGTH: 300,
  ALLOWED_PORTS: Object.freeze([80, 443, 8080, 8443]),
  ALLOWED_PROTOCOLS: Object.freeze(['http:', 'https:']),
});

const SCRIPT_STYLE_BLOCKS = /<\s*(?:script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style|iframe|object|embed|noscript)\s*>/gi;
const CONTROL_TOKEN_PATTERN = /<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>|<\|system\|>/gi;
const UNSAFE_HTML_TAGS = /<\s*\/?(?:script|style|iframe|object|embed|form|input|button|meta|link|base)[^>]*>/gi;
const HTML_TAGS_STRIP = /<[^>]+>/g;
const FORBIDDEN_KEY_PATTERN = /password|token|secret|credit|card|cvv|cvc|auth|bearer|ssn|iban|cookie|api[_-]?key/i;

export function sanitizeText(value, maxLength = 1000) {
  if (value === undefined || value === null) return '';
  const str = String(value)
    .replace(SCRIPT_STYLE_BLOCKS, ' ')
    .replace(CONTROL_TOKEN_PATTERN, '')
    .replace(UNSAFE_HTML_TAGS, ' ')
    .replace(HTML_TAGS_STRIP, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return str.slice(0, maxLength);
}

/**
 * Checks whether an IPv4 or IPv6 address is private, loopback, link-local,
 * multicast, cloud metadata, or reserved.
 */
export function isPrivateOrBlockedIp(ipAddress) {
  if (typeof ipAddress !== 'string') return true;
  const ip = ipAddress.trim();

  // IPv4 check
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b, c] = parts;

    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24
    if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24
    if (a >= 224 && a <= 239) return true; // 224.0.0.0/4
    if (a >= 240) return true; // 240.0.0.0/4

    return false;
  }

  // IPv6 check
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    if (lower === '::' || lower === '0000:0000:0000:0000:0000:0000:0000:0000') return true;

    const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4Mapped) {
      return isPrivateOrBlockedIp(v4Mapped[1]);
    }

    if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true; // fc00::/7
    if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true; // fe80::/10
    if (/^ff[0-9a-f]{2}:/i.test(lower)) return true; // ff00::/8
    if (/^0?100:/i.test(lower)) return true; // 100::/64
    if (/^2001:0?db8:/i.test(lower)) return true; // 2001:db8::/32

    return false;
  }

  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'instance-data',
  'metadata.internal',
]);

/**
 * Validates whether a URL structure is safe before any DNS resolution or network request.
 */
export function validateSafeUrl(urlString) {
  if (typeof urlString !== 'string') {
    throw new UrlIntelligenceError('INVALID_URL', 'URL must be a string.');
  }

  const trimmed = urlString.trim();
  if (!trimmed || trimmed.length > URL_INTELLIGENCE_LIMITS.MAX_URL_LENGTH) {
    throw new UrlIntelligenceError('INVALID_URL_LENGTH', 'URL exceeds maximum length.');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UrlIntelligenceError('MALFORMED_URL', 'Invalid URL format.');
  }

  if (!URL_INTELLIGENCE_LIMITS.ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new UrlIntelligenceError('UNSUPPORTED_PROTOCOL', `Protocol "${parsed.protocol}" is not supported. Only HTTP and HTTPS are permitted.`);
  }

  if (parsed.username || parsed.password) {
    throw new UrlIntelligenceError('URL_CREDENTIALS_FORBIDDEN', 'Embedded credentials in URLs are strictly forbidden.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new UrlIntelligenceError('SSRF_BLOCKED_TARGET', `Access to hostname "${hostname}" is forbidden.`);
  }

  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!URL_INTELLIGENCE_LIMITS.ALLOWED_PORTS.includes(portNum)) {
      throw new UrlIntelligenceError('FORBIDDEN_PORT', `Port ${portNum} is not permitted.`);
    }
  }

  if (net.isIP(hostname) && isPrivateOrBlockedIp(hostname)) {
    throw new UrlIntelligenceError('SSRF_BLOCKED_TARGET', `Direct access to private or reserved IP "${hostname}" is forbidden.`);
  }

  return parsed;
}

/**
 * Resolves DNS for hostname and asserts that no resolved addresses belong to
 * private, reserved, or loopback networks.
 */
export async function resolveAndValidateDns(hostname, { lookupImpl = dns.lookup } = {}) {
  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIp(hostname)) {
      throw new UrlIntelligenceError('SSRF_BLOCKED_TARGET', `Resolved IP "${hostname}" is within a restricted network.`);
    }
    return [{ address: hostname, family: net.isIP(hostname) }];
  }

  let records;
  try {
    records = await lookupImpl(hostname, { all: true });
  } catch (err) {
    throw new UrlIntelligenceError('DNS_RESOLUTION_FAILED', `DNS resolution failed for hostname "${hostname}": ${err?.message || 'Host not found'}`);
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new UrlIntelligenceError('DNS_RESOLUTION_FAILED', `No DNS records returned for hostname "${hostname}".`);
  }

  for (const record of records) {
    const ip = record.address;
    if (isPrivateOrBlockedIp(ip)) {
      throw new UrlIntelligenceError('SSRF_BLOCKED_TARGET', `Resolved IP "${ip}" for "${hostname}" is within a restricted or private network.`);
    }
  }

  return records;
}

/**
 * Safely fetches a public webpage URL with full SSRF protection, DNS check,
 * re-validation of each redirect target, bounded size, and request timeout.
 */
export async function safeFetchUrl(urlString, {
  maxRedirects = URL_INTELLIGENCE_LIMITS.MAX_REDIRECTS,
  timeoutMs = URL_INTELLIGENCE_LIMITS.DEFAULT_TIMEOUT_MS,
  maxSizeBytes = URL_INTELLIGENCE_LIMITS.MAX_RESPONSE_BYTES,
  fetchImpl = null,
  lookupImpl = dns.lookup,
} = {}) {
  let currentUrl = urlString;
  const clientFetch = fetchImpl || fetch;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const parsed = validateSafeUrl(currentUrl);
    await resolveAndValidateDns(parsed.hostname, { lookupImpl });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await clientFetch(currentUrl, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SamCheBot/1.0; +https://samchecompany.com)',
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr,en;q=0.9',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
        },
      });
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError' || controller.signal.aborted) {
        throw new UrlIntelligenceError('FETCH_TIMEOUT', `Fetch timed out after ${timeoutMs}ms.`);
      }
      throw new UrlIntelligenceError('FETCH_FAILED', `Failed to connect to ${currentUrl}: ${fetchErr.message}`);
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        throw new UrlIntelligenceError('INVALID_REDIRECT', `HTTP ${res.status} redirect received without Location header.`);
      }
      if (redirectCount >= maxRedirects) {
        throw new UrlIntelligenceError('TOO_MANY_REDIRECTS', `Exceeded maximum redirect limit (${maxRedirects}).`);
      }
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = nextUrl;
      continue;
    }

    if (!res.ok) {
      throw new UrlIntelligenceError(`HTTP_${res.status}`, `Remote server returned HTTP ${res.status}.`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml+xml');
    if (!isHtml) {
      throw new UrlIntelligenceError('UNSUPPORTED_CONTENT_TYPE', `Content type "${contentType}" is not supported. Only HTML pages are permitted.`);
    }

    let text;
    try {
      text = await res.text();
    } catch (readErr) {
      throw new UrlIntelligenceError('READ_FAILED', `Failed to read response body: ${readErr.message}`);
    }

    const boundedHtml = text.slice(0, maxSizeBytes);
    return {
      finalUrl: currentUrl,
      status: res.status,
      contentType,
      html: boundedHtml,
      truncated: text.length > maxSizeBytes,
    };
  }

  throw new UrlIntelligenceError('TOO_MANY_REDIRECTS', 'Exceeded maximum redirect count.');
}

function parseJsonLdBlocks(html) {
  const blocks = [];
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const rawJson = match[1]?.trim();
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          blocks.push(...parsed);
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed['@graph'])) {
            blocks.push(...parsed['@graph']);
          } else {
            blocks.push(parsed);
          }
        }
      } catch {
        // Safe skip on malformed embedded JSON
      }
    }
  }
  return blocks;
}

function findPrimarySchemaEntity(blocks) {
  const recognizedTypes = ['Product', 'Hotel', 'Accommodation', 'RealEstateListing', 'SingleFamilyResidence', 'Residence', 'Vehicle', 'Car', 'Course', 'Service', 'SoftwareApplication', 'Book'];
  for (const block of blocks) {
    const type = block?.['@type'];
    const typeStr = Array.isArray(type) ? type.join(' ') : String(type || '');
    if (recognizedTypes.some(t => typeStr.includes(t))) {
      return block;
    }
  }
  return blocks[0] || null;
}

function extractAttributesFromSchema(schemaEntity) {
  const attributes = {};
  if (!schemaEntity || typeof schemaEntity !== 'object') return attributes;

  if (schemaEntity.description) attributes['description'] = sanitizeText(schemaEntity.description, 300);
  if (schemaEntity.category) attributes['category'] = sanitizeText(schemaEntity.category, 100);
  if (schemaEntity.brand) {
    const brand = typeof schemaEntity.brand === 'object' ? schemaEntity.brand.name : schemaEntity.brand;
    if (brand) attributes['brand'] = sanitizeText(brand, 100);
  }
  if (schemaEntity.model) attributes['model'] = sanitizeText(schemaEntity.model, 100);
  if (schemaEntity.sku) attributes['sku'] = sanitizeText(schemaEntity.sku, 64);

  const offers = Array.isArray(schemaEntity.offers) ? schemaEntity.offers[0] : schemaEntity.offers;
  if (offers && typeof offers === 'object') {
    if (offers.price !== undefined) {
      const cur = offers.priceCurrency ? ` ${offers.priceCurrency}` : '';
      attributes['price'] = `${offers.price}${cur}`.trim();
    }
    if (offers.availability) {
      attributes['availability'] = sanitizeText(String(offers.availability).split('/').pop(), 64);
    }
  }

  if (schemaEntity.numberOfBedrooms !== undefined) attributes['bedrooms'] = schemaEntity.numberOfBedrooms;
  if (schemaEntity.numberOfBathrooms !== undefined) attributes['bathrooms'] = schemaEntity.numberOfBathrooms;
  if (schemaEntity.floorSize) {
    const s = typeof schemaEntity.floorSize === 'object' ? schemaEntity.floorSize.value : schemaEntity.floorSize;
    if (s) attributes['area'] = sanitizeText(String(s), 64);
  }
  if (schemaEntity.mileageFromOdometer) {
    const m = typeof schemaEntity.mileageFromOdometer === 'object' ? schemaEntity.mileageFromOdometer.value : schemaEntity.mileageFromOdometer;
    if (m) attributes['mileage'] = sanitizeText(String(m), 64);
  }
  if (schemaEntity.vehicleModelDate) attributes['year'] = sanitizeText(String(schemaEntity.vehicleModelDate), 32);

  if (Array.isArray(schemaEntity.additionalProperty)) {
    for (const prop of schemaEntity.additionalProperty) {
      if (prop && prop.name && prop.value !== undefined) {
        const k = sanitizeText(String(prop.name), URL_INTELLIGENCE_LIMITS.MAX_ATTR_KEY_LENGTH).toLowerCase();
        if (k && !FORBIDDEN_KEY_PATTERN.test(k) && Object.keys(attributes).length < URL_INTELLIGENCE_LIMITS.MAX_ATTRIBUTES_COUNT) {
          attributes[k] = sanitizeText(String(prop.value), URL_INTELLIGENCE_LIMITS.MAX_ATTR_VAL_LENGTH);
        }
      }
    }
  }
  return attributes;
}

/**
 * Extracts visible and structured content from HTML using Schema.org JSON-LD,
 * OpenGraph meta tags, HTML headings, tables, and specifications.
 */
export function extractContentFromHtml(html, pageUrl) {
  if (!html || typeof html !== 'string') {
    return { title: null, canonicalUrl: pageUrl, description: null, entityType: 'WEBPAGE', entityName: null, attributes: {}, summary: null };
  }

  let title = null;
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = sanitizeText(titleMatch[1], URL_INTELLIGENCE_LIMITS.MAX_TITLE_LENGTH);
  }

  let canonicalUrl = pageUrl;
  const canonicalMatch = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (canonicalMatch && canonicalMatch[1]) {
    try { canonicalUrl = new URL(canonicalMatch[1], pageUrl).toString(); } catch { canonicalUrl = pageUrl; }
  }

  const metaDescMatch = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  const metaDescription = metaDescMatch ? sanitizeText(metaDescMatch[1], URL_INTELLIGENCE_LIMITS.MAX_SUMMARY_LENGTH) : null;

  const ogTitleMatch = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const ogTitle = ogTitleMatch ? sanitizeText(ogTitleMatch[1], URL_INTELLIGENCE_LIMITS.MAX_TITLE_LENGTH) : null;

  const ogDescMatch = html.match(/<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
  const ogDesc = ogDescMatch ? sanitizeText(ogDescMatch[1], URL_INTELLIGENCE_LIMITS.MAX_SUMMARY_LENGTH) : null;

  const ogPriceAmountMatch = html.match(/<meta\b[^>]*property=["'](?:og|product):price:amount["'][^>]*content=["']([^"']+)["']/i);
  const ogPriceCurrencyMatch = html.match(/<meta\b[^>]*property=["'](?:og|product):price:currency["'][^>]*content=["']([^"']+)["']/i);

  const jsonBlocks = parseJsonLdBlocks(html);
  const schemaEntity = findPrimarySchemaEntity(jsonBlocks);
  const attributes = extractAttributesFromSchema(schemaEntity);

  let entityType = 'WEBPAGE';
  let entityName = ogTitle || title;

  if (schemaEntity) {
    const rawType = schemaEntity['@type'];
    entityType = sanitizeText(Array.isArray(rawType) ? rawType[0] : rawType, 64).toUpperCase() || 'WEBPAGE';
    if (schemaEntity.name) entityName = sanitizeText(schemaEntity.name, URL_INTELLIGENCE_LIMITS.MAX_TITLE_LENGTH);
  }

  if (!attributes['price'] && ogPriceAmountMatch && ogPriceAmountMatch[1]) {
    const cur = ogPriceCurrencyMatch ? ` ${ogPriceCurrencyMatch[1]}` : '';
    attributes['price'] = `${ogPriceAmountMatch[1]}${cur}`.trim();
  }

  const dlRegex = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  let dlMatch;
  while ((dlMatch = dlRegex.exec(html)) !== null && Object.keys(attributes).length < URL_INTELLIGENCE_LIMITS.MAX_ATTRIBUTES_COUNT) {
    const rawK = sanitizeText(dlMatch[1], URL_INTELLIGENCE_LIMITS.MAX_ATTR_KEY_LENGTH).toLowerCase();
    const rawV = sanitizeText(dlMatch[2], URL_INTELLIGENCE_LIMITS.MAX_ATTR_VAL_LENGTH);
    if (rawK && rawV && !FORBIDDEN_KEY_PATTERN.test(rawK) && !attributes[rawK]) {
      attributes[rawK] = rawV;
    }
  }

  const trRegex = /<tr\b[^>]*>\s*<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null && Object.keys(attributes).length < URL_INTELLIGENCE_LIMITS.MAX_ATTRIBUTES_COUNT) {
    const rawK = sanitizeText(trMatch[1], URL_INTELLIGENCE_LIMITS.MAX_ATTR_KEY_LENGTH).replace(/[:：]$/, '').toLowerCase();
    const rawV = sanitizeText(trMatch[2], URL_INTELLIGENCE_LIMITS.MAX_ATTR_VAL_LENGTH);
    if (rawK && rawV && rawK.length <= 40 && !FORBIDDEN_KEY_PATTERN.test(rawK) && !attributes[rawK]) {
      attributes[rawK] = rawV;
    }
  }

  if (!entityName) {
    const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match && h1Match[1]) entityName = sanitizeText(h1Match[1], URL_INTELLIGENCE_LIMITS.MAX_TITLE_LENGTH);
  }

  const finalSummary = ogDesc || metaDescription || (attributes['description'] ? String(attributes['description']) : null);

  return {
    title: title || entityName,
    canonicalUrl,
    description: finalSummary,
    entityType,
    entityName: entityName || title || canonicalUrl,
    attributes,
    summary: finalSummary,
  };
}

/**
 * Normalizes extracted webpage data into the canonical Contextual Intelligence entity structure,
 * tagging every attribute and the entity itself with EXTERNAL_URL_PAGE_FACT provenance.
 */
export function normalizeExternalUrlEntity({ url, pageData }) {
  const primaryUrl = pageData?.canonicalUrl || url;
  const nowIso = new Date().toISOString();
  const rawAttrs = pageData?.attributes || {};
  const cleanAttributes = {};
  const attributeProvenance = {};

  for (const [k, v] of Object.entries(rawAttrs)) {
    const cleanK = sanitizeText(k, URL_INTELLIGENCE_LIMITS.MAX_ATTR_KEY_LENGTH).toLowerCase();
    if (!cleanK || FORBIDDEN_KEY_PATTERN.test(cleanK)) continue;
    cleanAttributes[cleanK] = typeof v === 'number' || typeof v === 'boolean'
      ? v
      : sanitizeText(String(v), URL_INTELLIGENCE_LIMITS.MAX_ATTR_VAL_LENGTH);
    attributeProvenance[cleanK] = PROVENANCE_SOURCES.EXTERNAL_URL_PAGE_FACT;
  }

  const cleanName = sanitizeText(pageData?.entityName || pageData?.title || primaryUrl, 255);
  const cleanType = sanitizeText(pageData?.entityType || 'EXTERNAL_WEBPAGE', 64).toUpperCase();
  const cleanSummary = sanitizeText(pageData?.summary || pageData?.description || '', URL_INTELLIGENCE_LIMITS.MAX_SUMMARY_LENGTH);

  return {
    entity_type: cleanType,
    entity_id: primaryUrl,
    entity_name: cleanName,
    canonical_url: primaryUrl,
    attributes: cleanAttributes,
    attribute_provenance: attributeProvenance,
    summary: cleanSummary,
    source: PROVENANCE_SOURCES.EXTERNAL_URL_PAGE_FACT,
    freshness: nowIso,
    provenance: {
      source: PROVENANCE_SOURCES.EXTERNAL_URL_PAGE_FACT,
      extracted_from: primaryUrl,
      captured_at: nowIso,
    },
  };
}

const URL_EXTRACTION_PATTERN = /https?:\/\/[^\s<>"'{}|\\^`[\]]+/gi;

/**
 * Extracts public HTTP/HTTPS URLs from conversational user input text,
 * stripping trailing sentence punctuation.
 */
export function extractUrlsFromText(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(URL_EXTRACTION_PATTERN) || [];
  const cleaned = [];

  for (const raw of matches) {
    const stripped = raw.replace(/[.,;:!?)'"]+$/, '');
    try {
      const parsed = new URL(stripped);
      if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname) {
        cleaned.push(stripped);
      }
    } catch {
      // Skip invalid
    }
  }

  return [...new Set(cleaned)];
}

/**
 * Universal Shared Pipeline: processes user message text for URLs, safely fetches,
 * extracts page content, and produces a normalized Contextual Intelligence entity.
 * Reused identically across Web Chat, WhatsApp, AI Guide, and future channels.
 */
export async function processMessageUrlIntelligence({
  text,
  timeoutMs = URL_INTELLIGENCE_LIMITS.DEFAULT_TIMEOUT_MS,
  maxSizeBytes = URL_INTELLIGENCE_LIMITS.MAX_RESPONSE_BYTES,
  fetchImpl = null,
  lookupImpl = dns.lookup,
} = {}) {
  const urls = extractUrlsFromText(text);
  if (urls.length === 0) {
    return { hasUrl: false, url: null, success: false, entity: null, error: null };
  }

  const targetUrl = urls[0];
  try {
    const fetchResult = await safeFetchUrl(targetUrl, {
      timeoutMs,
      maxSizeBytes,
      fetchImpl,
      lookupImpl,
    });

    const pageData = extractContentFromHtml(fetchResult.html, fetchResult.finalUrl);
    const entity = normalizeExternalUrlEntity({ url: fetchResult.finalUrl, pageData });

    return {
      hasUrl: true,
      url: targetUrl,
      finalUrl: fetchResult.finalUrl,
      success: true,
      entity,
      error: null,
      truncated: fetchResult.truncated,
    };
  } catch (err) {
    return {
      hasUrl: true,
      url: targetUrl,
      success: false,
      entity: null,
      error: err.message,
      code: err.code || 'URL_PROCESSING_FAILED',
    };
  }
}
