-- Shared multimodal conversation resources (staging)
-- Files are stored only through the configured durable provider; PostgreSQL retains safe metadata and processing state.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_conversation_messages_id_tenant'
       AND conrelid = 'conversation_messages'::regclass
  ) THEN
    ALTER TABLE conversation_messages
      ADD CONSTRAINT uq_conversation_messages_id_tenant UNIQUE (id, tenant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS conversation_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('UPLOAD', 'WHATSAPP_MEDIA', 'URL')),
  media_category VARCHAR(24) NOT NULL CHECK (media_category IN ('DOCUMENT', 'IMAGE', 'LINK')),
  original_filename VARCHAR(255),
  mime_type VARCHAR(127),
  size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes > 0),
  storage_key VARCHAR(512),
  source_reference VARCHAR(255),
  source_url TEXT,
  content_hash CHAR(64),
  extraction_hash CHAR(64),
  extracted_text TEXT,
  processing_status VARCHAR(24) NOT NULL DEFAULT 'UPLOADING'
    CHECK (processing_status IN ('UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'UNSUPPORTED')),
  processing_method VARCHAR(48),
  failure_code VARCHAR(80),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_conversation_resources_id_tenant UNIQUE (id, tenant_id),
  CONSTRAINT fk_conversation_resources_conversation
    FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_conversation_resources_message
    FOREIGN KEY (message_id, tenant_id)
    REFERENCES conversation_messages(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_conversation_resource_source
    CHECK (
      (source_type = 'URL' AND source_url IS NOT NULL AND storage_key IS NULL)
      OR
      (source_type IN ('UPLOAD', 'WHATSAPP_MEDIA') AND storage_key IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_resources_source_reference
  ON conversation_resources(tenant_id, source_type, source_reference)
  WHERE source_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_resources_message
  ON conversation_resources(tenant_id, conversation_id, message_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_conversation_resources_processing
  ON conversation_resources(tenant_id, processing_status, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_conversation_resources_content_hash
  ON conversation_resources(tenant_id, content_hash)
  WHERE content_hash IS NOT NULL;
