import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/006_conversation_resources.sql', import.meta.url), 'utf8');

test('conversation resource migration defines tenant-scoped resource ownership and processing state', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS conversation_resources/);
  assert.match(migration, /FOREIGN KEY \(conversation_id, tenant_id\)/);
  assert.match(migration, /FOREIGN KEY \(message_id, tenant_id\)/);
  assert.match(migration, /processing_status IN \('UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'UNSUPPORTED'\)/);
  assert.match(migration, /source_type IN \('UPLOAD', 'WHATSAPP_MEDIA', 'URL'\)/);
});
