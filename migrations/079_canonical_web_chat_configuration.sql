-- Migration 079: Canonical Web Chat Appearance & Behavior Configuration
-- Stores tenant-scoped Web Chat appearance tokens, theme, and behavior settings idempotently.

ALTER TABLE channel_integrations
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_channel_integrations_config
  ON channel_integrations USING GIN (config)
  WHERE integration_type = 'WEB_CHAT';
