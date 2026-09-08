-- Platform-managed staging Guide routing uses one canonical platform hostname
-- with tenant-safe path-based resolution; tenant-specific wildcard DNS is not a
-- runtime dependency; custom Guide domains remain host-based.

-- 1. Add slug column to guide_domains if not present
ALTER TABLE guide_domains
  ADD COLUMN IF NOT EXISTS slug VARCHAR(63);

-- 2. Generic and idempotent convergence for historical managed guide domains:
-- Extract slug from historical multi-level managed hostnames
UPDATE guide_domains
   SET slug = lower(regexp_replace(hostname, '\.guide\.(?:staging\.)?samchecompany\.com$', '')),
       hostname = CASE
         WHEN hostname LIKE '%.guide.staging.samchecompany.com' THEN 'guide-staging.samchecompany.com'
         WHEN hostname LIKE '%.guide.samchecompany.com' THEN 'guide.samchecompany.com'
         ELSE 'guide-staging.samchecompany.com'
       END,
       domain_mode = 'MANAGED',
       updated_at = CURRENT_TIMESTAMP
 WHERE (domain_mode = 'MANAGED' OR hostname LIKE '%.guide.staging.samchecompany.com' OR hostname LIKE '%.guide.samchecompany.com')
   AND (slug IS NULL OR hostname LIKE '%.guide.staging.samchecompany.com' OR hostname LIKE '%.guide.samchecompany.com');

-- 3. Drop legacy global unique hostname constraint if present
ALTER TABLE guide_domains
  DROP CONSTRAINT IF EXISTS uq_guide_domain_hostname;

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
