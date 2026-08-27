import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('WhatsApp model path resolves and applies only active runtime knowledge context after human-handoff gating', () => {
  assert.match(appSource, /import \{[^}]*applyRuntimeKnowledgeContext[^}]*resolveAssistantRuntimeKnowledgeContext[^}]*\} from ["']\.\/services\/knowledge-runtime-context-service\.js["']/);
  const humanGate = appSource.indexOf('if (whatsappInbox.duplicate || !whatsappInbox.shouldInvokeAi) return;');
  assert.ok(humanGate >= 0);
  const resolveRuntime = appSource.indexOf('resolveAssistantRuntimeKnowledgeContext({', humanGate);
  assert.ok(resolveRuntime > humanGate);
  assert.match(appSource, /tenantId: whatsappInbox\.integration\.tenant_id,/);
  assert.match(appSource, /assistantId: whatsappInbox\.integration\.assistant_id,/);
  assert.match(appSource, /runtimeTenantContext = applyRuntimeKnowledgeContext\(tenantContext, runtimeKnowledge\)/);
  assert.match(appSource, /tenant: runtimeTenantContext,/);
});

