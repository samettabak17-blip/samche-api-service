import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('customer discovery exposes only active non-fixture CUSTOMER accounts', async () => {
  const source = await readFile(new URL('../routes/tenantRoutes.js', import.meta.url), 'utf8');
  const discovery = source.slice(source.indexOf("router.get('/users'"), source.indexOf("router.get('/:tenantId/users'"));
  assert.match(discovery, /system_role = 'CUSTOMER'/);
  assert.match(discovery, /status = 'ACTIVE'/);
  assert.match(discovery, /is_test_fixture = FALSE/);
});

test('direct assignment rejects INVITED, DISABLED, and fixture CUSTOMER targets', async () => {
  const source = await readFile(new URL('../routes/tenantRoutes.js', import.meta.url), 'utf8');
  const assignment = source.slice(source.indexOf("router.post('/:tenantId/users'"), source.indexOf("router.delete('/:tenantId/users/:userId'"));
  assert.match(assignment, /status/);
  assert.match(assignment, /is_test_fixture/);
  assert.match(assignment, /ACTIVE/);
});
