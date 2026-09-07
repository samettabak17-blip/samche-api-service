import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('push capability never returns VAPID private material and requires a complete server configuration', async () => {
  const source = await readFile(new URL('../routes/pushNotificationRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /VAPID_SUBJECT/);
  assert.match(source, /const configured = Boolean\(publicKey && privateKey && subject\)/);
  assert.doesNotMatch(source, /privateKey:/);
  assert.doesNotMatch(source, /VAPID_PRIVATE_KEY[^\n]*res\.json/);
});
