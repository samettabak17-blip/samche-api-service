import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('conversation list projection joins tenant-scoped CRM contacts before selecting contact fields', async () => {
  const source = await readFile(new URL('../routes/conversationRoutes.js', import.meta.url), 'utf8');
  const listProjection = source.slice(source.indexOf("router.get('/:tenantId/conversations',"), source.indexOf("router.get('/:tenantId/conversations/human-attention-summary'"));
  assert.match(listProjection, /LEFT JOIN crm_contacts contact ON contact\.id = c\.contact_id AND contact\.tenant_id = c\.tenant_id/);
  assert.match(listProjection, /contact\.display_name AS contact_display_name/);
});
