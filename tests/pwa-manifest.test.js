import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Dashboard manifest is installable and remains scoped to the authenticated application', async () => {
  const manifest = JSON.parse(await readFile(new URL('../dashboard/public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith('/') && icon.type === 'image/png'));
});
