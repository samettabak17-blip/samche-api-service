import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('public invitation routes are registered without authentication and use bounded raw JSON middleware', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const auth = await readFile(new URL('../routes/authRoutes.js', import.meta.url), 'utf8');
  assert.match(app, /express\.raw\(\{[^}]*limit:\s*'4kb'/s);
  assert.match(auth, /\/invitations\/validate/);
  assert.match(auth, /\/invitations\/accept/);
  assert.match(auth, /acceptInvitation/);
});
