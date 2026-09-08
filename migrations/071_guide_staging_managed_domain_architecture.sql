-- Platform-managed staging Guide routing uses one canonical platform hostname
-- with tenant-safe path-based resolution; tenant-specific wildcard DNS is not a
-- runtime dependency; custom Guide domains remain host-based.

-- 1. Establish slug column/schema prerequisites
ALTER TABLE guide_domains
  ADD COLUMN IF NOT EXISTS slug VARCHAR(63);

-- 2. Safely retire legacy GLOBAL hostname uniqueness rules BEFORE converging records.
-- Drop legacy unique constraints if present
ALTER TABLE guide_domains
  DROP CONSTRAINT IF EXISTS uq_guide_domain_hostname CASCADE;

ALTER TABLE guide_domains
  DROP CONSTRAINT IF EXISTS guide_domains_hostname_key CASCADE;

-- Drop standalone global unique indexes if present
DROP INDEX IF EXISTS uq_guide_domain_hostname;
DROP INDEX IF EXISTS guide_domains_hostname_key;

-- 3. Generic and idempotent convergence for historical managed guide domains:
-- Multiple managed domains converge to canonical shared platform host (guide-staging.samchecompany.com),
-- with distinct canonical slugs extracted from historical multi-level hostnames.
-- Custom domains (domain_mode = 'CUSTOM') are preserved completely unchanged.
UPDATE guide_domains
   SET slug = CASE
         WHEN slug IS NOT NULL AND slug <> '' THEN slug
         WHEN hostname LIKE '%.guide.staging.samchecompany.com'
           THEN lower(regexp_replace(hostname, '\.guide\.staging\.samchecompany\.com$', ''))
         WHEN hostname LIKE '%.guide.samchecompany.com'
           THEN lower(regexp_replace(hostname, '\.guide\.samchecompany\.com$', ''))
         ELSE substring(replace(tenant_id::text, '-', '') FROM 1 FOR 12)
       END,
       hostname = CASE
         WHEN hostname LIKE '%.guide.staging.samchecompany.com' THEN 'guide-staging.samchecompany.com'
         WHEN hostname LIKE '%.guide.samchecompany.com' THEN 'guide.samchecompany.com'
         WHEN domain_mode = 'MANAGED' THEN 'guide-staging.samchecompany.com'
         ELSE hostname
       END,
       domain_mode = 'MANAGED',
       updated_at = CURRENT_TIMESTAMP
 WHERE (domain_mode = 'MANAGED' OR hostname LIKE '%.guide.staging.samchecompany.com' OR hostname LIKE '%.guide.samchecompany.com')
   AND (slug IS NULL OR hostname LIKE '%.guide.staging.samchecompany.com' OR hostname LIKE '%.guide.samchecompany.com');

-- 4. Create separate unique indexes for custom domains (by hostname) and managed domains (by slug)
CREATE UNIQUE INDEX IF NOT EXISTS uq_guide_domain_custom_hostname
  ON guide_domains (lower(hostname))
  WHERE domain_mode = 'CUSTOM';

CREATE UNIQUE INDEX IF NOT EXISTS uq_guide_domain_managed_slug
  ON guide_domains (lower(slug))
  WHERE domain_mode = 'MANAGED';

-- 5. Add check constraint on slug format when present
ALTER TABLE guide_domains
  DROP CONSTRAINT IF EXISTS ck_guide_domain_slug_normalized;

ALTER TABLE guide_domains
  ADD CONSTRAINT ck_guide_domain_slug_normalized
  CHECK (slug IS NULL OR (slug = lower(slug) AND slug ~ '^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$'));

