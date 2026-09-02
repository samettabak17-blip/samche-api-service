-- Safe, non-content-bearing observability for an approval failure after its
-- primary transaction has rolled back. This table is not a workflow state and
-- cannot approve, reject, or mutate candidate provenance.
CREATE TABLE IF NOT EXISTS knowledge_candidate_approval_failure_diagnostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL,
  materialized_source_id UUID,
  original_source_id UUID,
  phase VARCHAR(80) NOT NULL,
  database_code VARCHAR(16),
  constraint_name VARCHAR(128),
  table_name VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidate_approval_failure_diagnostics_lookup
  ON knowledge_candidate_approval_failure_diagnostics (tenant_id, candidate_id, created_at DESC);
