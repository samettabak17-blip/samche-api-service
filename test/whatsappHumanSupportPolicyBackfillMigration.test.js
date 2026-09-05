import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('WhatsApp human-support policy backfill is non-destructive and idempotent for enabled integrations only', () => {
  const sql = readFileSync(new URL('../migrations/062_backfill_whatsapp_human_support_policy.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
  assert.match(sql, /channel_integrations/i);
  assert.match(sql, /integration_type\s*=\s*'WHATSAPP'/i);
  assert.match(sql, /enabled\s*=\s*TRUE/i);
  assert.match(sql, /IS DISTINCT FROM/i);
  assert.match(sql, /whatsapp_response_templates/i);
  assert.match(sql, /human_support/i);
});
