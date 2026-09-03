import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('mapped AI Guide resolves ACTIVE tenant persona after its existing AI-handling gate', () => {
  const humanGate = appSource.indexOf('if (inboxState && !inboxState.shouldInvokeAi)');
  const resolveRuntime = appSource.indexOf('resolveAssistantRuntimeKnowledgeContext({', appSource.indexOf('app.post("/chat"'));
  assert.ok(humanGate >= 0);
  assert.ok(resolveRuntime > humanGate);
  assert.match(appSource, /tenantId: inboxState\.integration\.tenant_id,/);
  assert.match(appSource, /assistantId: inboxState\.integration\.assistant_id,/);
  assert.match(appSource, /resolveTenantRuntimePersona\(\{[\s\S]*tenantId: inboxState\.integration\.tenant_id,[\s\S]*assistantId: inboxState\.integration\.assistant_id,/);
  assert.match(appSource, /runtimeSystemInstruction = buildTenantRuntimeSystemInstruction\(\{/);
  assert.match(appSource, /AI Guide assistant configuration is temporarily unavailable/);
});

test('AI Guide plan resolves mapped ACTIVE tenant persona instead of defaulting to a UAE SamChe plan', () => {
  const planStart = appSource.indexOf('app.post("/plan"');
  const chatStart = appSource.indexOf('app.post("/chat"', planStart);
  const planSource = appSource.slice(planStart, chatStart);
  assert.match(planSource, /resolveGuideRuntimeScope\(req\)/);
  assert.match(planSource, /resolveTenantRuntimePersona/);
  assert.match(planSource, /buildTenantRuntimeSystemInstruction/);
  assert.doesNotMatch(planSource, /structured, strategic UAE business setup proposal|SAMCHEGUIDE_SYSTEM_PROMPT/);
});

