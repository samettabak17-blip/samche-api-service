import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('staging audit schema accepts the persisted first-agent acknowledgement event', () => {
  const migration = readFileSync(
    new URL('../migrations/012_human_support_acknowledgement_audit.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /conversation_audit_events/);
  assert.match(migration, /HUMAN_SUPPORT_ACKNOWLEDGED/);
  assert.match(migration, /DROP CONSTRAINT/i);
  assert.match(migration, /ADD CONSTRAINT/i);
});
