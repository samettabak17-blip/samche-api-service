-- Assistant-scoped semantic behavior recommendations remain reviewable and idempotent.
ALTER TABLE assistant_knowledge_recommendations
  ADD COLUMN IF NOT EXISTS semantic_fingerprint CHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_recommendations_semantic_fingerprint
  ON assistant_knowledge_recommendations (tenant_id, semantic_fingerprint)
  WHERE semantic_fingerprint IS NOT NULL;
