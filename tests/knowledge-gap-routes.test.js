import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('knowledge gap routes are tenant scoped and candidate creation is tenant-admin only', async () => {
 const source = await readFile(new URL('../routes/knowledgeIntelligenceRoutes.js', import.meta.url), 'utf8');
 assert.match(source, /knowledge-intelligence\/gaps', requireTenantAccess/);
 assert.match(source, /gaps\/:gapId\/candidate', requireTenantAccess, requireTenantAdmin/);
 assert.match(source, /WHERE tenant_id = \$1/);
 assert.match(source, /redacted_question/);
});

