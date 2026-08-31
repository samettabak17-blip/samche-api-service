-- Task 6 Slice 3: tenant-scoped, versioned image extraction segments.
CREATE TABLE IF NOT EXISTS knowledge_source_extraction_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL,
  extraction_version VARCHAR(32) NOT NULL,
  extraction_hash CHAR(64) NOT NULL,
  segment_order INTEGER NOT NULL CHECK (segment_order >= 0),
  role VARCHAR(16) NOT NULL CHECK (role IN ('BUSINESS', 'CUSTOMER', 'UNKNOWN')),
  role_confidence NUMERIC(4,3) NOT NULL CHECK (role_confidence >= 0 AND role_confidence <= 1),
  normalized_text TEXT NOT NULL,
  extraction_method VARCHAR(128) NOT NULL,
  source_locator JSONB,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_knowledge_image_segments_source
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_image_segments_current_order
  ON knowledge_source_extraction_segments (tenant_id, source_id, segment_order)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_knowledge_image_segments_source_history
  ON knowledge_source_extraction_segments (tenant_id, source_id, extraction_hash, segment_order);
