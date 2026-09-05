-- Durable Guide sessions keep their server-authorized Experience provenance.
-- This migration is additive and its backfill only fills NULL values.
ALTER TABLE guide_public_sessions
  ADD COLUMN IF NOT EXISTS experience_version_id UUID,
  ADD COLUMN IF NOT EXISTS authorization_source VARCHAR(24),
  ADD COLUMN IF NOT EXISTS session_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_guide_public_sessions_authorization_source') THEN
    ALTER TABLE guide_public_sessions
      ADD CONSTRAINT chk_guide_public_sessions_authorization_source
      CHECK (authorization_source IS NULL OR authorization_source IN ('PUBLIC', 'PRIVATE_PREVIEW'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_guide_public_sessions_status') THEN
    ALTER TABLE guide_public_sessions
      ADD CONSTRAINT chk_guide_public_sessions_status
      CHECK (session_status IN ('ACTIVE', 'REVOKED', 'EXPIRED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_guide_public_sessions_experience_version') THEN
    ALTER TABLE guide_public_sessions
      ADD CONSTRAINT fk_guide_public_sessions_experience_version
      FOREIGN KEY (experience_version_id) REFERENCES guide_experience_versions(id);
  END IF;
END $$;

UPDATE guide_public_sessions AS session
   SET experience_version_id = experience.id
  FROM guide_experience_versions AS experience
 WHERE session.experience_version_id IS NULL
   AND experience.tenant_id = session.tenant_id
   AND experience.assistant_id = session.assistant_id
   AND experience.version = session.experience_version;

UPDATE guide_public_sessions
   SET authorization_source = CASE WHEN preview_mode THEN 'PRIVATE_PREVIEW' ELSE 'PUBLIC' END
 WHERE authorization_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_guide_public_sessions_authorized_scope
  ON guide_public_sessions (tenant_id, assistant_id, channel_id, domain_id, experience_version_id, session_status, expires_at);
