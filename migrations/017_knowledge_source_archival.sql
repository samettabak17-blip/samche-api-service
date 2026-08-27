-- Add ARCHIVED without rewriting an already-applied knowledge foundation migration.
ALTER TABLE knowledge_base_documents
  DROP CONSTRAINT IF EXISTS knowledge_base_documents_processing_status_check;

ALTER TABLE knowledge_base_documents
  ADD CONSTRAINT knowledge_base_documents_processing_status_check
  CHECK (processing_status IN ('UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DISABLED', 'ARCHIVED'));

ALTER TABLE knowledge_base_documents
  DROP CONSTRAINT IF EXISTS knowledge_base_documents_indexing_status_check;

ALTER TABLE knowledge_base_documents
  ADD CONSTRAINT knowledge_base_documents_indexing_status_check
  CHECK (indexing_status IN ('PENDING', 'INDEXING', 'READY', 'FAILED', 'DISABLED', 'ARCHIVED'));

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_archival
  ON knowledge_base_documents (tenant_id, enabled, processing_status, updated_at DESC);