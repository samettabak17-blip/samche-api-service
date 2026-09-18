-- Migration 087: Canonical Visual AI Foundation
-- Adds durable visual generation jobs, tenant visual AI configuration,
-- and extends conversation resources to support VISUAL_AI_GENERATED media.
-- Preserves strict tenant isolation, idempotency, and non-regression for Tasks 1-8.

BEGIN;

-- 1. Extend conversation_resources source_type constraint to include VISUAL_AI_GENERATED
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'conversation_resources'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) LIKE '%source_type%'
       )
  LOOP
    EXECUTE format('ALTER TABLE conversation_resources DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE conversation_resources
    ADD CONSTRAINT ck_conversation_resources_source_type
      CHECK (source_type IN ('UPLOAD', 'WHATSAPP_MEDIA', 'AGENT_UPLOAD', 'URL', 'VISUAL_AI_GENERATED'));
END $$;

-- 2. Create durable visual generation jobs table
CREATE TABLE IF NOT EXISTS visual_ai_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  message_id UUID,
  target_resource_id UUID NOT NULL,
  reference_resource_id UUID,
  reference_url TEXT,
  prompt_instruction TEXT NOT NULL,
  grounding_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider VARCHAR(64) NOT NULL DEFAULT 'MOCK',
  model VARCHAR(128) NOT NULL DEFAULT 'mock-visual-v1',
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  generated_resource_id UUID,
  last_error_code VARCHAR(80),
  failure_details JSONB,
  cost_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_visual_ai_jobs_tenant_idempotency UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT fk_visual_ai_jobs_conversation
    FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES conversations(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_visual_ai_jobs_target_resource
    FOREIGN KEY (target_resource_id, tenant_id)
    REFERENCES conversation_resources(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_visual_ai_jobs_reference_resource
    FOREIGN KEY (reference_resource_id, tenant_id)
    REFERENCES conversation_resources(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_visual_ai_jobs_generated_resource
    FOREIGN KEY (generated_resource_id, tenant_id)
    REFERENCES conversation_resources(id, tenant_id)
    ON DELETE SET NULL
);

-- Compound uniqueness and indexes for worker claiming and tenant-isolated operations
CREATE INDEX IF NOT EXISTS idx_visual_ai_jobs_claim
  ON visual_ai_generation_jobs (status, available_at, locked_until, created_at ASC)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE INDEX IF NOT EXISTS idx_visual_ai_jobs_conversation
  ON visual_ai_generation_jobs (tenant_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_ai_jobs_tenant_status
  ON visual_ai_generation_jobs (tenant_id, status, created_at DESC);

-- 3. Create tenant_visual_ai_config table
CREATE TABLE IF NOT EXISTS tenant_visual_ai_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  max_monthly_generations INTEGER NOT NULL DEFAULT 50,
  allowed_styles JSONB NOT NULL DEFAULT '["CONCEPT_PREVIEW"]'::jsonb,
  custom_disclaimer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
