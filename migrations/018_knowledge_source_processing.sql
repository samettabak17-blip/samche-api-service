-- Task 6: durable, tenant-scoped processing jobs for canonical knowledge sources.
-- This migration is additive and only runs after the pgvector foundation migrations.
ALTER TABLE knowledge_base_documents
  ADD COLUMN IF NOT EXISTS extraction_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS extraction_method VARCHAR(32),
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS knowledge_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL,
  job_type VARCHAR(32) NOT NULL DEFAULT 'INDEX_SOURCE'
    CHECK (job_type IN ('INDEX_SOURCE')),
  content_hash CHAR(64) NOT NULL,
  embedding_model VARCHAR(128) NOT NULL,
  embedding_version VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  last_error_code VARCHAR(80),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, source_id, job_type, content_hash, embedding_model, embedding_version),
  CONSTRAINT fk_knowledge_processing_jobs_source
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_claim
  ON knowledge_processing_jobs (status, available_at, created_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_knowledge_processing_jobs_source
  ON knowledge_processing_jobs (tenant_id, source_id, status, created_at DESC);
