-- Migration 081: Tenant-Wide Website Intelligence & Cross-Page Retrieval
-- Stores normalized tenant site pages, structured entities, reviews, policies, and discovery state.
-- Strictly scoped to tenant_id with full idempotency.

CREATE TABLE IF NOT EXISTS tenant_site_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    canonical_url TEXT,
    hostname VARCHAR(255) NOT NULL,
    title VARCHAR(500),
    page_type VARCHAR(64) NOT NULL DEFAULT 'GENERIC_PAGE',
    entity_type VARCHAR(64),
    entity_name VARCHAR(255),
    summary TEXT,
    headings JSONB NOT NULL DEFAULT '[]'::jsonb,
    products JSONB NOT NULL DEFAULT '[]'::jsonb,
    reviews JSONB NOT NULL DEFAULT '[]'::jsonb,
    policies JSONB NOT NULL DEFAULT '[]'::jsonb,
    faqs JSONB NOT NULL DEFAULT '[]'::jsonb,
    contact_info JSONB NOT NULL DEFAULT '{}'::jsonb,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_text TEXT,
    structured_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    content_hash VARCHAR(64) NOT NULL,
    crawl_status VARCHAR(32) NOT NULL DEFAULT 'INDEXED'
        CHECK (crawl_status IN ('DISCOVERED', 'INDEXING', 'INDEXED', 'FAILED', 'RETIRED')),
    http_status INTEGER,
    last_crawled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_site_pages_tenant_url UNIQUE (tenant_id, url)
);

CREATE TABLE IF NOT EXISTS tenant_site_discovery (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hostname VARCHAR(255) NOT NULL,
    root_url TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'IDLE'
        CHECK (status IN ('IDLE', 'DISCOVERING', 'INDEXED', 'FAILED')),
    pages_discovered INTEGER NOT NULL DEFAULT 0,
    pages_indexed INTEGER NOT NULL DEFAULT 0,
    discovery_source VARCHAR(64) NOT NULL DEFAULT 'AUTO'
        CHECK (discovery_source IN ('AUTO', 'SITEMAP', 'INTERNAL_LINKS', 'PAGE_CONTEXT', 'MANUAL')),
    last_discovered_at TIMESTAMPTZ,
    last_crawl_started_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hostname)
);

CREATE INDEX IF NOT EXISTS idx_tenant_site_pages_tenant_lookup
    ON tenant_site_pages (tenant_id, crawl_status);

CREATE INDEX IF NOT EXISTS idx_tenant_site_pages_tenant_type
    ON tenant_site_pages (tenant_id, page_type);

CREATE INDEX IF NOT EXISTS idx_tenant_site_pages_tenant_hostname
    ON tenant_site_pages (tenant_id, hostname);

CREATE INDEX IF NOT EXISTS idx_tenant_site_pages_tenant_entity
    ON tenant_site_pages (tenant_id, entity_name)
    WHERE entity_name IS NOT NULL;
