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

-- 3. Generic, deterministic, idempotent convergence for historical managed domains:
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  -- A. Base slug extraction and canonical hostname convergence:
  UPDATE guide_domains
     SET slug = CASE
           WHEN slug IS NOT NULL AND slug <> '' THEN lower(slug)
           WHEN hostname LIKE '%.guide.staging.samchecompany.com'
             THEN lower(regexp_replace(hostname, '\.guide\.staging\.samchecompany\.com$', ''))
           WHEN hostname LIKE '%.guide.samchecompany.com'
             THEN lower(regexp_replace(hostname, '\.guide\.samchecompany\.com$', ''))
           WHEN hostname LIKE '%.staging.samchecompany.com'
             THEN lower(regexp_replace(hostname, '\.staging\.samchecompany\.com$', ''))
           ELSE 't-' || substring(replace(tenant_id::text, '-', '') FROM 1 FOR 12)
         END,
         hostname = CASE
           WHEN hostname LIKE '%.guide.staging.samchecompany.com' THEN 'guide-staging.samchecompany.com'
           WHEN hostname LIKE '%.guide.samchecompany.com' THEN 'guide.samchecompany.com'
           WHEN hostname LIKE '%.staging.samchecompany.com' THEN 'guide-staging.samchecompany.com'
           WHEN domain_mode = 'MANAGED' THEN 'guide-staging.samchecompany.com'
           ELSE hostname
         END,
         domain_mode = 'MANAGED',
         updated_at = CURRENT_TIMESTAMP
   WHERE (domain_mode = 'MANAGED'
          OR hostname LIKE '%.guide.staging.samchecompany.com'
          OR hostname LIKE '%.guide.samchecompany.com'
          OR hostname LIKE '%.staging.samchecompany.com')
     AND (slug IS NULL
          OR hostname LIKE '%.guide.staging.samchecompany.com'
          OR hostname LIKE '%.guide.samchecompany.com'
          OR hostname LIKE '%.staging.samchecompany.com');

  -- B. Sanitize slugs:
  UPDATE guide_domains
     SET slug = substring(
           trim(both '-' from regexp_replace(lower(slug), '[^a-z0-9]+', '-', 'g'))
           FROM 1 FOR 32
         )
   WHERE domain_mode = 'MANAGED' AND slug IS NOT NULL AND slug <> '';

  UPDATE guide_domains
     SET slug = 't-' || substring(replace(tenant_id::text, '-', '') FROM 1 FOR 12)
   WHERE domain_mode = 'MANAGED' AND (slug IS NULL OR slug = '');

  -- C. SAME-OWNER DUPLICATES CONVERGENCE:
  WITH ranked_owner_domains AS (
    SELECT
      gd.id,
      ROW_NUMBER() OVER (
        PARTITION BY gd.tenant_id, gd.assistant_id
        ORDER BY
          CASE WHEN gd.status = 'ACTIVE' THEN 0 WHEN gd.status = 'VERIFIED' THEN 1 WHEN gd.status = 'PENDING' THEN 2 ELSE 3 END ASC,
          CASE WHEN EXISTS (
            SELECT 1 FROM channel_integrations ci
             WHERE ci.channel_id = gd.channel_id
               AND ci.tenant_id = gd.tenant_id
               AND ci.assistant_id = gd.assistant_id
               AND ci.enabled = TRUE
          ) THEN 0 ELSE 1 END ASC,
          CASE WHEN gd.activated_at IS NOT NULL THEN 0 ELSE 1 END ASC,
          CASE WHEN gd.verified_at IS NOT NULL THEN 0 ELSE 1 END ASC,
          gd.updated_at DESC,
          gd.created_at DESC,
          gd.id DESC
      ) AS rn,
      FIRST_VALUE(gd.id) OVER (
        PARTITION BY gd.tenant_id, gd.assistant_id
        ORDER BY
          CASE WHEN gd.status = 'ACTIVE' THEN 0 WHEN gd.status = 'VERIFIED' THEN 1 WHEN gd.status = 'PENDING' THEN 2 ELSE 3 END ASC,
          CASE WHEN EXISTS (
            SELECT 1 FROM channel_integrations ci
             WHERE ci.channel_id = gd.channel_id
               AND ci.tenant_id = gd.tenant_id
               AND ci.assistant_id = gd.assistant_id
               AND ci.enabled = TRUE
          ) THEN 0 ELSE 1 END ASC,
          CASE WHEN gd.activated_at IS NOT NULL THEN 0 ELSE 1 END ASC,
          CASE WHEN gd.verified_at IS NOT NULL THEN 0 ELSE 1 END ASC,
          gd.updated_at DESC,
          gd.created_at DESC,
          gd.id DESC
      ) AS survivor_id
      FROM guide_domains gd
     WHERE gd.domain_mode = 'MANAGED'
  ),
  duplicates AS (
    SELECT id, survivor_id FROM ranked_owner_domains WHERE rn > 1
  ),
  repoint_sessions AS (
    UPDATE guide_public_sessions gps
       SET domain_id = d.survivor_id
      FROM duplicates d
     WHERE gps.domain_id = d.id
  ),
  repoint_audits AS (
    UPDATE guide_domain_audit_events gdae
       SET domain_id = d.survivor_id
      FROM duplicates d
     WHERE gdae.domain_id = d.id
  )
  UPDATE guide_domains gd
     SET status = 'ARCHIVED',
         archived_at = COALESCE(gd.archived_at, CURRENT_TIMESTAMP),
         slug = substring(gd.slug FROM 1 FOR 18) || '-arch-' || substring(replace(gd.id::text, '-', '') FROM 1 FOR 6),
         updated_at = CURRENT_TIMESTAMP
    FROM duplicates d
   WHERE gd.id = d.id;
  -- D. CROSS-TENANT / CROSS-OWNER SLUG COLLISIONS:
  -- Rank active rows sharing lower(slug) by creation date. Earliest keeps base slug;
  -- subsequent rows receive a deterministic tenant-suffixed slug (max 32 chars).
  WITH ranked_slugs AS (
    SELECT
      gd.id,
      ROW_NUMBER() OVER (
        PARTITION BY lower(gd.slug)
        ORDER BY
          CASE WHEN gd.status = 'ACTIVE' THEN 0 WHEN gd.status = 'VERIFIED' THEN 1 ELSE 2 END ASC,
          gd.created_at ASC,
          gd.id ASC
      ) AS rn
      FROM guide_domains gd
     WHERE gd.domain_mode = 'MANAGED'
       AND gd.status = 'ACTIVE'
       AND gd.slug IS NOT NULL
  )
  UPDATE guide_domains gd
     SET slug = substring(trim(both '-' from gd.slug) FROM 1 FOR 25) || '-' || substring(replace(gd.tenant_id::text, '-', '') FROM 1 FOR 6),
         updated_at = CURRENT_TIMESTAMP
    FROM ranked_slugs rs
   WHERE gd.id = rs.id AND rs.rn > 1;

  -- Secondary tie-breaker if multiple assistants in the same tenant collided on the suffixed slug:
  WITH ranked_secondary AS (
    SELECT
      gd.id,
      ROW_NUMBER() OVER (
        PARTITION BY lower(gd.slug)
        ORDER BY gd.created_at ASC, gd.id ASC
      ) AS rn
      FROM guide_domains gd
     WHERE gd.domain_mode = 'MANAGED'
       AND gd.status = 'ACTIVE'
       AND gd.slug IS NOT NULL
  )
  UPDATE guide_domains gd
     SET slug = substring(trim(both '-' from gd.slug) FROM 1 FOR 19) || '-' || substring(replace(gd.assistant_id::text, '-', '') FROM 1 FOR 4),
         updated_at = CURRENT_TIMESTAMP
    FROM ranked_secondary rs
   WHERE gd.id = rs.id AND rs.rn > 1;

  -- Ensure any remaining inactive duplicate slugs are disambiguated:
  WITH ranked_inactive_slugs AS (
    SELECT
      gd.id,
      ROW_NUMBER() OVER (
        PARTITION BY lower(gd.slug)
        ORDER BY
          CASE WHEN gd.status = 'ACTIVE' THEN 0 WHEN gd.status = 'VERIFIED' THEN 1 ELSE 2 END ASC,
          gd.created_at ASC,
          gd.id ASC
      ) AS rn
      FROM guide_domains gd
     WHERE gd.domain_mode = 'MANAGED'
       AND gd.slug IS NOT NULL
  )
  UPDATE guide_domains gd
     SET slug = substring(trim(both '-' from gd.slug) FROM 1 FOR 18) || '-dup-' || substring(replace(gd.id::text, '-', '') FROM 1 FOR 6),
         updated_at = CURRENT_TIMESTAMP
    FROM ranked_inactive_slugs ris
   WHERE gd.id = ris.id AND ris.rn > 1;

  -- E. Invariant verification: Ensure zero duplicate lower(slug) remain among MANAGED rows
  SELECT count(*) INTO dup_count
    FROM (
      SELECT lower(slug)
        FROM guide_domains
       WHERE domain_mode = 'MANAGED' AND slug IS NOT NULL
       GROUP BY lower(slug)
      HAVING count(*) > 1
    ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Invariant check failed: % duplicate managed slug groups remain after convergence', dup_count;
  END IF;
END $$;

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

