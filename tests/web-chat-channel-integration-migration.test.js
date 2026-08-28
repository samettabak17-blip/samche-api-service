import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('channel integration constraint supports signed Web Chat without weakening known types', async () => {
  const sql = await readFile(new URL('../migrations/023_web_chat_channel_integration.sql', import.meta.url), 'utf8');
  assert.match(sql, /channel_integrations/);
  assert.match(sql, /integration_type IN \('SAMCHEGUIDE', 'WHATSAPP', 'WEB_CHAT'\)/);
  assert.match(sql, /ck_channel_integrations_type/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});
