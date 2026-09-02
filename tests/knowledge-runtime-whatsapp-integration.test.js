import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('WhatsApp model path resolves active tenant persona after human-handoff gating and before provider invocation', () => {
  assert.match(appSource, /resolveChannelAssistantRuntime/);
  const humanGate = appSource.indexOf('if (whatsappInbox.duplicate || !whatsappInbox.shouldInvokeAi) return;');
  assert.ok(humanGate >= 0);
  const resolveRuntime = appSource.indexOf('resolveChannelAssistantRuntime({', humanGate);
  assert.ok(resolveRuntime > humanGate);
  assert.match(appSource, /scope: whatsappInbox\.integration,/);
  assert.match(appSource, /channelType: 'WHATSAPP'/);
  assert.match(appSource, /runtimeTenantContext = buildWhatsAppActivePersonaTenantContext\(/);
  assert.match(appSource, /resolveWhatsAppPersonaUnavailableResponse\(tenantContext\.communicationLanguage\)/);
  assert.ok(appSource.indexOf('callWpGemini(', resolveRuntime) > resolveRuntime);
  assert.match(appSource, /tenant: runtimeTenantContext,/);
});

test('WhatsApp Gemini failure telemetry is safe and identifies the provider contract without request content', () => {
  assert.match(appSource, /WHATSAPP_GEMINI_RUNTIME_FAILURE code=\$\{safeCode\} http_status=\$\{safeStatus\} model=\$\{runtimeModel\} endpoint_class=\$\{safeEndpointClass\}/);
  assert.doesNotMatch(appSource, /WHATSAPP_GEMINI_RUNTIME_FAILURE[^\n]*(?:prompt|systemInstruction|tenantId|credential|headers|url|message|cause|stack)/i);
});

test('WhatsApp runtime uses the platform-configured Vertex-compatible chat contract', () => {
  assert.match(appSource, /resolveModel: \(\) => googleGeminiProvider\.runtimeMetadata\(\)/);
  assert.match(appSource, /model: runtimeModel,\s+contents: \[\{ role: 'user', parts \}\],/);
  assert.doesNotMatch(appSource, /model: 'gemini-2\.5-pro'/);
  assert.doesNotMatch(appSource, /responseMimeType|responseSchema|thinkingConfig/);
});

