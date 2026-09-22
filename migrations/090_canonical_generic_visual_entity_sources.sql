-- Migration 090: Canonical Generic Visual and Entity Knowledge Sources
-- Additive, tenant-scoped schema for generic entity and visual reference media management.
-- Preserves strict tenant isolation, backward compatibility, and idempotency.

BEGIN;

-- 1. Extend knowledge_base_documents source_type constraint safely
DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'knowledge_base_documents'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE knowledge_base_documents DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
  END LOOP;

  ALTER TABLE knowledge_base_documents
    ADD CONSTRAINT ck_knowledge_base_documents_source_type
      CHECK (source_type IN ('MANUAL', 'DOCUMENT', 'CONVERSATION_CANDIDATE', 'IMAGE', 'VISUAL_ENTITY', 'CATALOG'));
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

-- 2. Create knowledge_entities table
CREATE TABLE IF NOT EXISTS knowledge_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_id UUID REFERENCES knowledge_base_documents(id) ON DELETE CASCADE,
  business_identity_id UUID REFERENCES business_identities(id) ON DELETE SET NULL,
  candidate_id UUID REFERENCES knowledge_candidates(id) ON DELETE SET NULL,
  entity_type VARCHAR(64) NOT NULL DEFAULT 'GENERIC',
  name VARCHAR(255) NOT NULL,
  external_code VARCHAR(128),
  description TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  textual_evidence TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence >= 0 AND confidence <= 1),
  approval_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED')),
  is_runtime_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entities_tenant_runtime
  ON knowledge_entities (tenant_id, is_runtime_eligible, approval_status);

CREATE INDEX IF NOT EXISTS idx_knowledge_entities_tenant_source
  ON knowledge_entities (tenant_id, source_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_entities_tenant_code
  ON knowledge_entities (tenant_id, external_code)
  WHERE external_code IS NOT NULL;

-- 3. Create knowledge_entity_media table
CREATE TABLE IF NOT EXISTS knowledge_entity_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
  source_id UUID REFERENCES knowledge_base_documents(id) ON DELETE CASCADE,
  media_type VARCHAR(32) NOT NULL DEFAULT 'IMAGE' CHECK (media_type IN ('IMAGE')),
  mime_type VARCHAR(64) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  storage_key VARCHAR(512) NOT NULL,
  original_filename VARCHAR(255),
  file_size_bytes BIGINT,
  content_hash CHAR(64),
  media_role VARCHAR(32) NOT NULL DEFAULT 'PRIMARY_REFERENCE'
    CHECK (media_role IN ('PRIMARY_REFERENCE', 'SECONDARY_REFERENCE', 'SWATCH', 'CONTEXT_VIEW', 'CANDIDATE_GRAPHIC', 'UNCERTAIN_ASSOCIATION')),
  page_number INTEGER,
  bounding_box JSONB,
  approval_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED')),
  is_runtime_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence >= 0 AND confidence <= 1),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entity_media_tenant_entity
  ON knowledge_entity_media (tenant_id, entity_id, is_runtime_eligible, approval_status);

CREATE INDEX IF NOT EXISTS idx_knowledge_entity_media_tenant_source
  ON knowledge_entity_media (tenant_id, source_id);

COMMIT;
