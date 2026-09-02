import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('WhatsApp model path resolves active tenant persona after human-handoff gating and before provider invocation', () => {
  assert.match(appSource, /import \{[^}]*resolveTenantRuntimePersona[^}]*\} from ["']\.\/services\/tenant-runtime-persona-service\.js["']/);
  const humanGate = appSource.indexOf('if (whatsappInbox.duplicate || !whatsappInbox.shouldInvokeAi) return;');
  assert.ok(humanGate >= 0);
  const resolveRuntime = appSource.indexOf('resolveAssistantRuntimeKnowledgeContext({', humanGate);
  assert.ok(resolveRuntime > humanGate);
  assert.match(appSource, /tenantId: whatsappInbox\.integration\.tenant_id,/);
  assert.match(appSource, /assistantId: whatsappInbox\.integration\.assistant_id,/);
  const resolvePersona = appSource.indexOf('resolveTenantRuntimePersona({', humanGate);
  assert.ok(resolvePersona > humanGate);
  assert.match(appSource, /runtimeTenantContext = buildWhatsAppActivePersonaTenantContext\(/);
  assert.match(appSource, /resolveWhatsAppPersonaUnavailableResponse\(tenantContext\.communicationLanguage\)/);
  assert.ok(appSource.indexOf('callWpGemini(', resolvePersona) > resolvePersona);
  assert.match(appSource, /tenant: runtimeTenantContext,/);
});

test('WhatsApp Gemini failure telemetry is safe and identifies the provider contract without request content', () => {
  assert.match(appSource, /WHATSAPP_GEMINI_RUNTIME_FAILURE code=\$\{safeCode\} http_status=\$\{safeStatus\} model=\$\{WHATSAPP_GEMINI_MODEL\} endpoint_class=\$\{safeEndpointClass\}/);
  assert.doesNotMatch(appSource, /WHATSAPP_GEMINI_RUNTIME_FAILURE[^\n]*(?:prompt|systemInstruction|tenantId|credential|headers|url|message|cause|stack)/i);
});

