import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('AI Guide resolves active runtime knowledge only after its existing AI-handling gate', () => {
  const humanGate = appSource.indexOf('if (inboxState && !inboxState.shouldInvokeAi)');
  const resolveRuntime = appSource.indexOf('resolveAssistantRuntimeKnowledgeContext({', appSource.indexOf('app.post("/chat"'));
  assert.ok(humanGate >= 0);
  assert.ok(resolveRuntime > humanGate);
  assert.match(appSource, /tenantId: inboxState\.integration\.tenant_id,/);
  assert.match(appSource, /assistantId: inboxState\.integration\.assistant_id,/);
  assert.match(appSource, /appendRuntimeKnowledgeToSystemInstruction\(SAMCHEGUIDE_SYSTEM_PROMPT, runtimeKnowledge\)/);
});

