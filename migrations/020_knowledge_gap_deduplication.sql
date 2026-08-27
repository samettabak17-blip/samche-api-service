-- Task 6: deduplicate review-only knowledge gaps without weakening tenant scope.
ALTER TABLE knowledge_gaps
  ADD COLUMN IF NOT EXISTS dedupe_key CHAR(64),
  ADD COLUMN IF NOT EXISTS signal_type VARCHAR(48),
  ADD COLUMN IF NOT EXISTS last_detected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing gaps remain valid. A deterministic legacy key prevents duplicate active review rows.
UPDATE knowledge_gaps
   SET dedupe_key = encode(digest(
         COALESCE(assistant_id::text, 'WORKSPACE') || '|' || lower(regexp_replace(normalized_question, '\\s+', ' ', 'g')),
         'sha256'
       ), 'hex')
 WHERE dedupe_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_gaps_tenant_dedupe
  ON knowledge_gaps (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_tenant_assistant_review
  ON knowledge_gaps (tenant_id, assistant_id, status, last_detected_at DESC);

