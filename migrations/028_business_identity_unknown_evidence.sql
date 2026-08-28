-- Unknown/low-confidence source identity evidence must remain auditable while failing closed.
ALTER TABLE business_identity_source_evidence
  ALTER COLUMN normalized_detected_identity DROP NOT NULL;
