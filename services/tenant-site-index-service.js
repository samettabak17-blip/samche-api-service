/**
 * services/tenant-site-index-service.js
 * Tenant-scoped persistence and indexing for tenant website intelligence.
 * Strictly enforces tenant isolation on all queries and mutations.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TenantSiteIndexError extends Error {
  constructor(code, message = 'Tenant site index operation failed') {
    super(message);
    this.name = 'TenantSiteIndexError';
    this.code = code;
  }
}

function validateUUID(value, code = 'INVALID_TENANT_ID') {
  if (!UUID_REGEX.test(String(value ?? ''))) {
    throw new TenantSiteIndexError(code, 'Invalid UUID identifier.');
  }
  return String(value);
}

export async function upsertTenantSitePage({ database, tenantId, pageData }) {
  if (!database?.query) throw new TenantSiteIndexError('DATABASE_UNAVAILABLE');
  const validTenantId = validateUUID(tenantId);

  if (!pageData || !pageData.url) {
    throw new TenantSiteIndexError('INVALID_PAGE_DATA', 'Page URL is required.');
  }

  const {
    url,
    canonical_url = pageData.url,
    hostname,
    title = '',
    page_type = 'GENERIC_PAGE',
    entity_type = null,
    entity_name = null,
    summary = '',
    headings = [],
    products = [],
    reviews = [],
    policies = [],
    faqs = [],
    contact_info = {},
    attributes = {},
    content_text = '',
    structured_data = [],
    content_hash = '',
    crawl_status = 'INDEXED',
    http_status = 200,
  } = pageData;

  const resolvedHostname = hostname || new URL(url).hostname.toLowerCase();

  const queryText = `
    INSERT INTO tenant_site_pages (
      tenant_id, url, canonical_url, hostname, title, page_type,
      entity_type, entity_name, summary, headings, products,
      reviews, policies, faqs, contact_info, attributes,
      content_text, structured_data, content_hash, crawl_status,
      http_status, last_crawled_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10::jsonb, $11::jsonb,
      $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb,
      $17, $18::jsonb, $19, $20,
      $21, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT (tenant_id, url) DO UPDATE SET
      canonical_url = EXCLUDED.canonical_url,
      hostname = EXCLUDED.hostname,
      title = EXCLUDED.title,
      page_type = EXCLUDED.page_type,
      entity_type = EXCLUDED.entity_type,
      entity_name = EXCLUDED.entity_name,
      summary = EXCLUDED.summary,
      headings = EXCLUDED.headings,
      products = EXCLUDED.products,
      reviews = EXCLUDED.reviews,
      policies = EXCLUDED.policies,
      faqs = EXCLUDED.faqs,
      contact_info = EXCLUDED.contact_info,
      attributes = EXCLUDED.attributes,
      content_text = EXCLUDED.content_text,
      structured_data = EXCLUDED.structured_data,
      content_hash = EXCLUDED.content_hash,
      crawl_status = EXCLUDED.crawl_status,
      http_status = EXCLUDED.http_status,
      last_crawled_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, tenant_id, url, title, page_type, entity_name, crawl_status, content_hash;
  `;

  const values = [
    validTenantId,
    url,
    canonical_url,
    resolvedHostname,
    title ? String(title).slice(0, 500) : '',
    page_type || 'GENERIC_PAGE',
    entity_type ? String(entity_type).slice(0, 64) : null,
    entity_name ? String(entity_name).slice(0, 255) : null,
    summary ? String(summary) : '',
    JSON.stringify(Array.isArray(headings) ? headings : []),
    JSON.stringify(Array.isArray(products) ? products : []),
    JSON.stringify(Array.isArray(reviews) ? reviews : []),
    JSON.stringify(Array.isArray(policies) ? policies : []),
    JSON.stringify(Array.isArray(faqs) ? faqs : []),
    JSON.stringify(contact_info && typeof contact_info === 'object' ? contact_info : {}),
    JSON.stringify(attributes && typeof attributes === 'object' ? attributes : {}),
    content_text ? String(content_text) : '',
    JSON.stringify(Array.isArray(structured_data) ? structured_data : []),
    content_hash || '',
    crawl_status,
    http_status,
  ];

  const result = await database.query(queryText, values);
  return result.rows[0];
}

export async function getTenantSitePage({ database, tenantId, url }) {
  if (!database?.query) throw new TenantSiteIndexError('DATABASE_UNAVAILABLE');
  const validTenantId = validateUUID(tenantId);
  const result = await database.query(
    `SELECT * FROM tenant_site_pages
      WHERE tenant_id = $1 AND (url = $2 OR canonical_url = $2) AND crawl_status != 'RETIRED'
      LIMIT 1`,
    [validTenantId, url]
  );
  return result.rows[0] || null;
}

export async function listTenantSitePages({ database, tenantId, pageType = null, limit = 50 }) {
  if (!database?.query) throw new TenantSiteIndexError('DATABASE_UNAVAILABLE');
  const validTenantId = validateUUID(tenantId);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));

  let queryText = `SELECT id, tenant_id, url, canonical_url, hostname, title, page_type, entity_type, entity_name, summary, headings, products, reviews, policies, faqs, contact_info, attributes, crawl_status, last_crawled_at
    FROM tenant_site_pages
    WHERE tenant_id = $1 AND crawl_status != 'RETIRED'`;
  const params = [validTenantId];

  if (pageType) {
    queryText += ` AND page_type = $2`;
    params.push(pageType);
  }

  queryText += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
  params.push(safeLimit);

  const result = await database.query(queryText, params);
  return result.rows;
}

export async function getTenantSiteDiscoveryState({ database, tenantId, hostname }) {
  if (!database?.query) throw new TenantSiteIndexError('DATABASE_UNAVAILABLE');
  const validTenantId = validateUUID(tenantId);
  const cleanHost = String(hostname || '').toLowerCase().trim();
  const result = await database.query(
    `SELECT * FROM tenant_site_discovery WHERE tenant_id = $1 AND hostname = $2 LIMIT 1`,
    [validTenantId, cleanHost]
  );
  return result.rows[0] || null;
}

export async function upsertTenantSiteDiscoveryState({
  database,
  tenantId,
  hostname,
  rootUrl,
  status = 'INDEXED',
  pagesDiscovered = 0,
  pagesIndexed = 0,
  discoverySource = 'AUTO',
  lastError = null,
}) {
  if (!database?.query) throw new TenantSiteIndexError('DATABASE_UNAVAILABLE');
  const validTenantId = validateUUID(tenantId);
  const cleanHost = String(hostname || '').toLowerCase().trim();

  const result = await database.query(
    `INSERT INTO tenant_site_discovery (
      tenant_id, hostname, root_url, status, pages_discovered,
      pages_indexed, discovery_source, last_discovered_at, last_error, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, CURRENT_TIMESTAMP, $8, CURRENT_TIMESTAMP
    )
    ON CONFLICT (tenant_id, hostname) DO UPDATE SET
      root_url = EXCLUDED.root_url,
      status = EXCLUDED.status,
      pages_discovered = EXCLUDED.pages_discovered,
      pages_indexed = EXCLUDED.pages_indexed,
      discovery_source = EXCLUDED.discovery_source,
      last_discovered_at = CURRENT_TIMESTAMP,
      last_error = EXCLUDED.last_error,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [validTenantId, cleanHost, rootUrl, status, pagesDiscovered, pagesIndexed, discoverySource, lastError]
  );

  return result.rows[0];
}

export async function markStalePagesRetired({ database, tenantId, hostname, activeUrls = [] }) {
  if (!database?.query) throw new TenantSiteIndexError('DATABASE_UNAVAILABLE');
  const validTenantId = validateUUID(tenantId);
  const cleanHost = String(hostname || '').toLowerCase().trim();

  if (!Array.isArray(activeUrls) || activeUrls.length === 0) return 0;

  const result = await database.query(
    `UPDATE tenant_site_pages
        SET crawl_status = 'RETIRED', updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1
        AND hostname = $2
        AND url != ALL($3::text[])
        AND crawl_status != 'RETIRED'
      RETURNING id`,
    [validTenantId, cleanHost, activeUrls]
  );

  return result.rowCount;
}
