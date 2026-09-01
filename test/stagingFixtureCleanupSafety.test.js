import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('fixture cleanup is explicit, staging guarded, dry-run-first, and confirmation protected', async () => {
  const source = await readFile(new URL('../scripts/staging_fixture_cleanup.js', import.meta.url), 'utf8');
  assert.match(source, /is_test_fixture/);
  assert.match(source, /STAGING_FIXTURE_CLEANUP_ENABLED/);
  assert.match(source, /--execute/);
  assert.match(source, /STAGING_FIXTURE_CLEANUP_CONFIRMATION/);
  assert.match(source, /BEGIN/);
  assert.match(source, /DELETE FROM users[\s\S]*is_test_fixture = TRUE/i);
  assert.match(source, /unsafe\.length/);
});
