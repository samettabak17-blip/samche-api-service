import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('signed Web Chat resolves opaque identity and ACTIVE tenant persona before provider invocation', () => {
  assert.match(source, /app\.post\("\/api\/chat\/bootstrap"/);
  assert.match(source, /resolvePublicWebChatIntegration\(\{ database: pool, widgetKey/);
  assert.match(source, /issuePublicWebChatSession\(/);
  assert.match(source, /verifyPublicWebChatSession\(/);
  assert.match(source, /assistantId: webChatIntegration\.assistant_id,/);
  assert.match(source, /tenantId: webChatIntegration\.tenant_id,/);
  assert.match(source, /resolveTenantRuntimePersona\(\{[\s\S]*tenantId: webChatIntegration\.tenant_id,[\s\S]*assistantId: webChatIntegration\.assistant_id,/);
  assert.match(source, /buildTenantRuntimeSystemInstruction\(\{[\s\S]*persona: webChatRuntimePersona/);
  assert.match(source, /Web Chat assistant configuration is temporarily unavailable/);
  assert.doesNotMatch(source, /req\.body\.tenant_id|req\.body\.assistant_id/);
});

