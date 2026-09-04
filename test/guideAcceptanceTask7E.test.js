import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  GuideConversationError,
  canonicalGuideResponseEvents,
  normalizeGuideConversationRequest,
  issueGuideResumeSession,
  resolveGuideResumeSession,
} from '../services/guide-conversation-service.js';

const jsSource = fs.readFileSync(new URL('../public-guide/guide.js', import.meta.url), 'utf8');
const cssSource = fs.readFileSync(new URL('../public-guide/guide.css', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('TASK 7E Defect 1: Assistant runtime normalization accepts ASSISTANT and AI_ASSISTANT without 400 failure', () => {
  const reqFromClient = normalizeGuideConversationRequest({ module: 'ASSISTANT', text: 'Hello, need help' });
  assert.equal(reqFromClient.module, 'AI_ASSISTANT');
  assert.equal(reqFromClient.text, 'Hello, need help');

  const reqAiAssistant = normalizeGuideConversationRequest({ module: 'AI_ASSISTANT', text: 'Hello, need help' });
  assert.equal(reqAiAssistant.module, 'AI_ASSISTANT');
  assert.equal(reqAiAssistant.text, 'Hello, need help');

  const reqRoadmap = normalizeGuideConversationRequest({ module: 'ROADMAP', text: 'Corporate event plan' });
  assert.equal(reqRoadmap.module, 'ROADMAP');
  assert.equal(reqRoadmap.text, 'Corporate event plan');

  assert.throws(() => normalizeGuideConversationRequest({ module: 'MALICIOUS_MODULE', text: 'test' }), GuideConversationError);
  assert.match(appSource, /normalizeGuideConversationRequest\(\{\s*module:\s*req\.body\?\.guide_module\s*\|\|\s*'AI_ASSISTANT'/);

  const events = canonicalGuideResponseEvents('We can help configure your service package with full timeline planning.');
  assert.ok(events.length >= 3);
  assert.equal(events[0].type, 'MESSAGE_START');
  assert.equal(events[events.length - 1].type, 'MESSAGE_COMPLETE');
});

test('TASK 7E Defect 2: Reminder bubble is anchored directly to ASSISTANT nav item', () => {
  assert.match(jsSource, /guide-navigation__slot/);
  assert.match(jsSource, /slot\.dataset\.guideSlot = module/);
  assert.match(jsSource, /querySelector\('\.guide-navigation__slot\[data-guide-slot="AI_ASSISTANT"\]'\)/);
  assert.match(cssSource, /\.guide-navigation__slot\{position:relative;/);
  assert.match(cssSource, /\.guide-assistant-reminder\{position:absolute;bottom:calc\(100% \+ 6px\);left:50%;transform:translateX\(-50%\);/);
  assert.match(cssSource, /\.guide-assistant-reminder::after\{content:"";position:absolute;bottom:-5px;left:50%;transform:translateX\(-50%\) rotate\(45deg\);/);
  assert.match(cssSource, /max-width:min\(180px,calc\(100vw - 32px\)\)/);
});

test('TASK 7E Defect 3: Zero page-level scrollbars and compacted controls', () => {
  assert.match(cssSource, /\.guide-module\{display:flex;flex-direction:column;min-width:0;flex:1;min-height:0;overflow:hidden/);
  assert.match(cssSource, /\.guide-module-layer\{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden/);
  assert.match(cssSource, /\.guide-tool-form\{display:flex;flex-direction:column;flex:1;min-height:0;margin-top:\.35rem;padding:8px 10px;overflow:hidden/);
  assert.doesNotMatch(cssSource, /\.guide-tool-form\{[^}]*overflow-y:auto/);
  assert.doesNotMatch(cssSource, /\.guide-module\{[^}]*overflow-y:auto/);
  assert.match(cssSource, /\.guide-conversation-board\{[^}]*overflow-y:auto/);
  assert.match(cssSource, /\.guide-chat-messages\{[^}]*overflow-y:auto/);
  assert.match(cssSource, /\.guide-module__title\{margin:0;font-size:18px;/);
  assert.match(cssSource, /\.guide-field input,\.guide-field select\{width:100%;height:34px;min-height:34px;/);
  assert.match(cssSource, /\.guide-field--boolean\{display:flex;align-items:center;gap:6px;min-height:34px;height:34px;/);
  assert.match(cssSource, /\.guide-button\{display:inline-flex;height:32px;min-height:32px;/);
  assert.match(cssSource, /\.guide-roadmap-composer\{width:100%;height:52px;min-height:52px;/);
});

test('TASK 7E Tenant and session isolation is preserved', async () => {
  const stateByHash = new Map();
  const database = {
    query: async (sql, values) => {
      if (sql.includes('INSERT INTO guide_public_sessions')) {
        stateByHash.set(values[0], { token_hash: values[0], session_id: values[1], tenant_id: values[2], assistant_id: values[3], channel_id: values[4], domain_id: values[5], experience_version: values[6], preview_mode: values[7], expires_at: values[8] });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('FROM guide_public_sessions')) {
        const row = stateByHash.get(values[0]);
        const matches = row && row.tenant_id === values[1] && row.assistant_id === values[2] && row.channel_id === values[3] && row.domain_id === values[4] && row.experience_version === values[5] && row.preview_mode === values[6];
        return { rowCount: matches ? 1 : 0, rows: matches ? [row] : [] };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const scopeTenantA = { domain_id: 'dom-1', tenant_id: 'tenant-a', assistant_id: 'asst-1', channel_id: 'chan-1' };
  const session = await issueGuideResumeSession({ database, scope: scopeTenantA, experienceVersion: 1, previewMode: false });
  assert.ok(session.token);

  const scopeTenantB = { ...scopeTenantA, tenant_id: 'tenant-b' };
  const crossTenantResolve = await resolveGuideResumeSession({ database, token: session.token, scope: scopeTenantB, experienceVersion: 1, previewMode: false });
  assert.equal(crossTenantResolve, null);
});
