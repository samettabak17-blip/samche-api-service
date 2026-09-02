-- Portable metadata for tenant-owned public Guide branding assets. Object
-- storage keys stay server-side; public Guide responses receive only opaque IDs.
CREATE TABLE IF NOT EXISTS guide_experience_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  asset_kind VARCHAR(16) NOT NULL CHECK (asset_kind IN ('LOGO', 'AVATAR')),
  storage_key TEXT NOT NULL UNIQUE,
  mime_type VARCHAR(64) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_guide_experience_asset_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_guide_experience_assets_scope
  ON guide_experience_assets (tenant_id, assistant_id, created_at DESC)
  WHERE status='ACTIVE';
