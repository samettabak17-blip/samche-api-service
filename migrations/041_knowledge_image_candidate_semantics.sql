-- Task 6: semantic classification metadata for canonical image-derived candidates.
ALTER TABLE knowledge_candidates
  ADD COLUMN IF NOT EXISTS image_semantic_version VARCHAR(16);

ALTER TABLE knowledge_candidate_image_evidence
  ADD COLUMN IF NOT EXISTS semantic_category VARCHAR(64),
  ADD COLUMN IF NOT EXISTS canonical_text TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_knowledge_image_evidence_semantic_category') THEN
    ALTER TABLE knowledge_candidate_image_evidence
      ADD CONSTRAINT chk_knowledge_image_evidence_semantic_category
      CHECK (semantic_category IS NULL OR semantic_category IN (
        'DURABLE_BUSINESS_FACT', 'ASSISTANT_BEHAVIOR_OR_QUALIFICATION',
        'CUSTOMER_SPECIFIC_CONTEXT', 'TRANSIENT_CONVERSATION',
        'DURABLE_POLICY_OR_COMMITMENT_CANDIDATE', 'UNSAFE_OR_AMBIGUOUS'
      ));
  END IF;
END $$;
