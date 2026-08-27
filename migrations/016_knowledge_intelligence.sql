-- Task 6: additive, tenant-scoped Knowledge Intelligence foundation.
-- The extension is available on staging PostgreSQL (pgvector 0.8.1).
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE knowledge_base_documents
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(32) NOT NULL DEFAULT 'MANUAL'
    CHECK (source_type IN ('MANUAL', 'DOCUMENT', 'CONVERSATION_CANDIDATE')),
  ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(127),
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes > 0),
  ADD COLUMN IF NOT EXISTS storage_key VARCHAR(512),
  ADD COLUMN IF NOT EXISTS content_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS processing_status VARCHAR(24) NOT NULL DEFAULT 'READY'
    CHECK (processing_status IN ('UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DISABLED')),
  ADD COLUMN IF NOT EXISTS indexing_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (indexing_status IN ('PENDING', 'INDEXING', 'READY', 'FAILED', 'DISABLED')),
  ADD COLUMN IF NOT EXISTS analysis_status VARCHAR(24) NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (analysis_status IN ('NOT_REQUESTED', 'PROCESSING', 'READY', 'FAILED')),
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processing_error_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS knowledge_source_assistants (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL,
  assistant_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_id, assistant_id),
  CONSTRAINT fk_knowledge_source_assistants_source
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_source_assistants_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  section_title VARCHAR(255),
  source_page INTEGER CHECK (source_page IS NULL OR source_page > 0),
  normalized_text TEXT NOT NULL,
  text_hash CHAR(64) NOT NULL,
  token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
  embedding vector(1536),
  embedding_provider VARCHAR(32) NOT NULL DEFAULT 'OPENAI',
  embedding_model VARCHAR(128) NOT NULL,
  embedding_version VARCHAR(64) NOT NULL,
  embedding_dimensions INTEGER NOT NULL DEFAULT 1536,
  index_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (index_status IN ('PENDING', 'INDEXING', 'READY', 'FAILED', 'SUPERSEDED', 'DISABLED')),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, source_id, embedding_model, embedding_version, chunk_index, text_hash),
  CONSTRAINT fk_knowledge_chunks_source
    FOREIGN KEY (source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_knowledge_chunk_embedding_dimensions
    CHECK (embedding_dimensions = 1536)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_runtime
  ON knowledge_base_documents (tenant_id, enabled, status, processing_status, indexing_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_source_assistants_lookup
  ON knowledge_source_assistants (tenant_id, assistant_id, source_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_status
  ON knowledge_chunks (tenant_id, source_id, is_active, index_status);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE is_active = TRUE AND index_status = 'READY';

CREATE TABLE IF NOT EXISTS knowledge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID,
  candidate_type VARCHAR(32) NOT NULL
    CHECK (candidate_type IN ('FAQ', 'POLICY', 'PROCEDURE', 'PRODUCT', 'SERVICE', 'PRICING', 'OBJECTION_HANDLING', 'TERMINOLOGY', 'KNOWLEDGE_GAP')),
  proposed_title VARCHAR(255) NOT NULL,
  proposed_content TEXT NOT NULL,
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status VARCHAR(24) NOT NULL DEFAULT 'NEEDS_REVIEW'
    CHECK (status IN ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  pii_redaction_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (pii_redaction_status IN ('PENDING', 'PASSED', 'REDACTED', 'REJECTED')),
  evidence_summary TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  approved_source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_knowledge_candidates_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_knowledge_candidates_approved_source
    FOREIGN KEY (approved_source_id, tenant_id)
    REFERENCES knowledge_base_documents(id, tenant_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS knowledge_candidate_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID NOT NULL,
  channel_type VARCHAR(32) NOT NULL,
  sender_type VARCHAR(32) NOT NULL CHECK (sender_type IN ('CUSTOMER', 'ASSISTANT', 'AGENT', 'SYSTEM')),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_knowledge_candidate_evidence_candidate
    FOREIGN KEY (candidate_id, tenant_id)
    REFERENCES knowledge_candidates(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_candidate_evidence_conversation
    FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_knowledge_candidate_evidence_message
    FOREIGN KEY (message_id, tenant_id)
    REFERENCES conversation_messages(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID,
  normalized_question TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'NEEDS_REVIEW'
    CHECK (status IN ('DRAFT', 'NEEDS_REVIEW', 'RESOLVED', 'DISMISSED')),
  suggested_candidate_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_knowledge_gaps_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_knowledge_gaps_candidate
    FOREIGN KEY (suggested_candidate_id, tenant_id)
    REFERENCES knowledge_candidates(id, tenant_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_review
  ON knowledge_candidates (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_candidate_evidence_candidate
  ON knowledge_candidate_evidence (tenant_id, candidate_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_review
  ON knowledge_gaps (tenant_id, status, occurrence_count DESC);

CREATE TABLE IF NOT EXISTS business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  approved_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id),
  UNIQUE (id, tenant_id)
);

CREATE TABLE IF NOT EXISTS business_profile_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  profile_id UUID NOT NULL,
  profile_data JSONB NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  generated_by VARCHAR(32) NOT NULL DEFAULT 'AI',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_business_profile_versions_profile
    FOREIGN KEY (profile_id, tenant_id)
    REFERENCES business_profiles(id, tenant_id)
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_business_profiles_approved_version'
  ) THEN
    ALTER TABLE business_profiles
      ADD CONSTRAINT fk_business_profiles_approved_version
      FOREIGN KEY (approved_version_id, tenant_id)
      REFERENCES business_profile_versions(id, tenant_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS assistant_knowledge_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  recommendation_data JSONB NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(24) NOT NULL DEFAULT 'NEEDS_REVIEW'
    CHECK (status IN ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'APPLIED', 'SUPERSEDED')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assistant_knowledge_recommendations_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_business_profile_versions_review
  ON business_profile_versions (tenant_id, profile_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_knowledge_recommendations_review
  ON assistant_knowledge_recommendations (tenant_id, assistant_id, status, created_at DESC);