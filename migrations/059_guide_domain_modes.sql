-- Distinguish platform-managed Guide hostnames from customer-owned domains.
-- Hostname uniqueness and tenant/assistant ownership remain global invariants.
ALTER TABLE guide_domains
  ADD COLUMN IF NOT EXISTS domain_mode VARCHAR(16) NOT NULL DEFAULT 'CUSTOM';

ALTER TABLE guide_domains
  DROP CONSTRAINT IF EXISTS ck_guide_domain_mode;

ALTER TABLE guide_domains
  ADD CONSTRAINT ck_guide_domain_mode
  CHECK (domain_mode IN ('MANAGED', 'CUSTOM'));
