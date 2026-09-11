-- Migration 080: Web Chat Branding Assets
-- Stores tenant-scoped Web Chat logo and branding assets with storage keys and extracted palettes.

CREATE TABLE IF NOT EXISTS tenant_web_chat_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_kind VARCHAR(32) NOT NULL DEFAULT 'LOGO' CHECK (asset_kind IN ('LOGO', 'ICON', 'AVATAR')),
  storage_key TEXT NOT NULL,
  mime_type VARCHAR(64) NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  extracted_palette JSONB DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenant_web_chat_assets_scope
  ON tenant_web_chat_assets (tenant_id, asset_kind, created_at DESC)
  WHERE status = 'ACTIVE';
