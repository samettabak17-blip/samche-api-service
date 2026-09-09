-- Migration 078: Canonical Web Chat Proactive Engagement & High-Intent Activation
-- Provides tenant-scoped session engagement state tracking for high-intent auto-open,
-- frequency capping, and dismissal cooldown.

ALTER TABLE web_chat_public_sessions
  ADD COLUMN IF NOT EXISTS engagement_state JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_web_chat_public_sessions_engagement
  ON web_chat_public_sessions (tenant_id, session_id);
