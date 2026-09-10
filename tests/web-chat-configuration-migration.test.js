import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('migration 078: web chat proactive engagement migration is safe and idempotent', async () => {
  const sql = await readFile(new URL('../migrations/078_canonical_web_chat_proactive_engagement.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE web_chat_public_sessions/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS engagement_state JSONB/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/i);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('migration 079: canonical web chat configuration migration is safe and idempotent', async () => {
  const sql = await readFile(new URL('../migrations/079_canonical_web_chat_configuration.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE channel_integrations/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS config JSONB/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_channel_integrations_config/i);
  assert.match(sql, /WHERE integration_type = 'WEB_CHAT'/i);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});
