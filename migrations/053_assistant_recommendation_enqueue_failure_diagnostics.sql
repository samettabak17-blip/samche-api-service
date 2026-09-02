-- Safe operational metadata for failures before an assistant recommendation
-- generation job is accepted. This table is not workflow state.
CREATE TABLE IF NOT EXISTS knowledge_assistant_recommendation_enqueue_failure_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  business_profile_version_id UUID NOT NULL,
  phase VARCHAR(48) NOT NULL,
  database_code VARCHAR(16),
  constraint_name VARCHAR(128),
  entity_name VARCHAR(128),
  internal_error_code VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assistant_recommendation_enqueue_failure_diagnostics_lookup
  ON knowledge_assistant_recommendation_enqueue_failure_diagnostics
  (tenant_id, assistant_id, business_profile_version_id, created_at DESC);
