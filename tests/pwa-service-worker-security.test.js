import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('service worker rejects external and malformed notification deep links', async () => {
  const source = await readFile(new URL('../dashboard/public/service-worker.js', import.meta.url), 'utf8');
  assert.match(source, /function isAllowedDashboardPath/);
  assert.match(source, /UUID/);
  assert.match(source, /safeDeepLink\(payload\.deepLink\)/);
  assert.doesNotMatch(source, /payload\.deepLink\.startsWith\('\/app\/'\)/);
});
