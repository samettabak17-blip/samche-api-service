import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('Web Chat bootstrap resolves opaque widget identity server-side before shared runtime retrieval', () => {
  assert.match(source, /app\.post\("\/api\/chat\/bootstrap"/);
  assert.match(source, /resolvePublicWebChatIntegration\(\{ database: pool, widgetKey/);
  assert.match(source, /issuePublicWebChatSession\(/);
  assert.match(source, /verifyPublicWebChatSession\(/);
  assert.match(source, /assistantId: webChatIntegration\.assistant_id,/);
  assert.match(source, /tenantId: webChatIntegration\.tenant_id,/);
  assert.match(source, /appendRuntimeKnowledgeToSystemInstruction\(/);
  assert.doesNotMatch(source, /req\.body\.tenant_id|req\.body\.assistant_id/);
});

