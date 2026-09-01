import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('OWNER invitation management exposes tenant-scoped status, resend, and revoke endpoints', async () => {
  const routes = await readFile(new URL('../routes/tenantRoutes.js', import.meta.url), 'utf8');
  assert.match(routes, /router\.get\('\/:tenantId\/invitations',/);
  assert.match(routes, /router\.post\('\/:tenantId\/invitations\/:invitationId\/resend',/);
  assert.match(routes, /router\.post\('\/:tenantId\/invitations\/:invitationId\/revoke',/);
});
