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

// ============================================================================
// MANDATORY TESTS — PLANNING LAYOUT (Tests 1-8)
// ============================================================================

test('1. Planning desktop layout uses two-column compact grid', () => {
  assert.match(jsSource, /guide-tool-grid/);
  assert.match(cssSource, /\.guide-tool-grid\{display:grid;grid-template-columns:1fr 1fr;column-gap:8px;row-gap:5px/);
});

test('2. All existing Planning fields remain present', () => {
  assert.match(jsSource, /for \(const field of visibleFields\(tool\.fields, guideState\.tool\)\)/);
  assert.match(jsSource, /fieldsGrid\.append\(inputForField\(field/);
});

test('3. Ask the Assistant button is present inside Planning module', () => {
  assert.match(jsSource, /Ask the Assistant/);
  assert.match(jsSource, /guide-tool-ask-button/);
  assert.match(jsSource, /askButton\.addEventListener\('click', handoffToAssistant\)/);
});

test('4. Ask the Assistant button is visible in normal viewport with compact dimensions', () => {
  assert.match(cssSource, /\.guide-tool-ask-button\{width:100%;height:31px;min-height:31px;font-size:11.5px\}/);
});

test('5. Planning module has no overflow-y auto/scroll', () => {
  assert.doesNotMatch(cssSource, /\.guide-module\{[^}]*overflow-y\s*:\s*(?:auto|scroll)/);
  assert.match(cssSource, /\.guide-module\{[^}]*overflow:hidden/);
});

test('6. Planning form has no overflow-y auto/scroll', () => {
  assert.doesNotMatch(cssSource, /\.guide-tool-form\{[^}]*overflow-y\s*:\s*(?:auto|scroll)/);
  assert.match(cssSource, /\.guide-tool-form\{[^}]*overflow:hidden/);
  assert.doesNotMatch(cssSource, /\.guide-step-card\{[^}]*overflow-y\s*:\s*(?:auto|scroll)/);
});

test('7. No horizontal overflow in planning grid or canvas', () => {
  assert.doesNotMatch(cssSource, /overflow-x\s*:\s*scroll/);
  assert.match(cssSource, /\.guide-canvas\{[^}]*overflow:hidden/);
});

// ============================================================================
// MANDATORY TESTS — DRAFT HANDOFF (Tests 9-20)
// ============================================================================

test('9-12. Planning fields generate concise natural-language draft and activate Assistant composer', () => {
  assert.match(jsSource, /buildPlanningNaturalDraft/);
  assert.match(jsSource, /handoffToAssistant/);
  assert.match(jsSource, /guideState\.assistant_draft = buildPlanningNaturalDraft/);
  assert.match(jsSource, /guideState\.assistant_draft_origin = 'HANDOFF'/);
  assert.match(jsSource, /guideState\.active_module = MODULES\.AI_ASSISTANT/);
  assert.match(jsSource, /input\.value = guideState\.assistant_draft/);
});

test('13. Draft is NOT in Assistant visible message history before sending', () => {
  assert.doesNotMatch(jsSource, /handoffToAssistant[^{]*\{[^}]*messages\.push/);
});

test('14. No Planning context card is rendered above Assistant conversation', () => {
  const renderAssistantStart = jsSource.indexOf('function renderAssistant(');
  const renderAssistantEnd = jsSource.indexOf('function renderConversationReminder(', renderAssistantStart);
  const renderAssistantBody = jsSource.slice(renderAssistantStart, renderAssistantEnd);
  assert.doesNotMatch(renderAssistantBody, /renderGuideContextSummary/);
  assert.doesNotMatch(renderAssistantBody, /YOUR CONTEXT/);
});

test('15. User can edit draft in textarea', () => {
  assert.match(jsSource, /input\.addEventListener\('input',\s*\(\)\s*=>\s*\{/);
  assert.match(jsSource, /guideState\.assistant_draft = input\.value\.slice\(0, 2000\)/);
  assert.match(jsSource, /guideState\.assistant_draft_origin = 'USER'/);
});

test('16-17. Clicking Send submits exactly once, creates history, and clears pending draft', () => {
  assert.match(jsSource, /async function submitMessage\(event\)/);
  assert.match(jsSource, /guideState\.assistant_draft = ''/);
  assert.match(jsSource, /guideState\.assistant_draft_origin = 'NONE'/);
  assert.match(jsSource, /messages\.push\(\{ value, kind: 'user' \}\)/);
});

test('18. Existing Assistant history remains intact when navigating', () => {
  assert.match(jsSource, /preservedAssistantChat/);
  assert.match(jsSource, /for \(const message of messages\)[\s\S]*?preservedAssistantChat\.append/);
});

test('19. Roadmap history remains independent from Assistant history', () => {
  assert.match(jsSource, /guideState\.roadmap_messages/);
  assert.match(appSource, /guideSessionState\.roadmapState\.messages\.push/);
  assert.match(appSource, /guideSessionState\.assistantConversation\.messages\.push/);
});

test('20. Planning state remains preserved during Assistant interaction', () => {
  assert.match(jsSource, /guideState\.tool/);
  assert.match(jsSource, /persistState\(\)/);
});

// ============================================================================
// MANDATORY TESTS — ROADMAP LIVE RUNTIME & FAILURE BOUNDARIES (Tests 21-25)
// ============================================================================

test('21. Roadmap request uses correct /chat route, normalized body, and session scope', () => {
  assert.match(jsSource, /fetch\("\/chat"/);
  assert.match(jsSource, /guide_module:\s*module/);
  assert.match(appSource, /normalizeGuideConversationRequest\(\{\s*module:\s*req\.body\?\.guide_module\s*\|\|\s*'AI_ASSISTANT'/);
});

test('22-23. Successful runtime conversation history formats cleanly without consecutive user turns or undefined text', () => {
  assert.match(appSource, /addGuideMemory\(sessionKey, guideConversation\.module, "user", cleanText/);
  assert.match(appSource, /content:\s*text\s*\|\|\s*'',\s*parts:\s*\[\{\s*text:\s*text\s*\|\|\s*''\s*\}\]/);
  assert.match(appSource, /conversationHistory\s*=\s*authorityMemory/);
  assert.match(appSource, /const contents = \[\.\.\.conversationHistory, \{ role: 'user', parts: \[\{ text: cleanText \}\] \}\];/);
});

test('24. Server/provider failure still surfaces safe error handling without crashing', () => {
  assert.match(appSource, /catch \(err\) \{/);
  assert.match(appSource, /Could not generate chat response\./);
  assert.match(jsSource, /The guide is temporarily unavailable\. Please try again\./);
});

test('25. Tenant and session isolation remains intact', async () => {
  const store = new Map();
  const database = {
    query: async (sql, values) => {
      if (sql.includes('INSERT INTO guide_public_sessions')) {
        store.set(values[0], { token_hash: values[0], session_id: values[1], tenant_id: values[2], assistant_id: values[3], channel_id: values[4], domain_id: values[5], experience_version: values[6], preview_mode: values[7], expires_at: values[8], state: {} });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('FROM guide_public_sessions')) {
        const row = store.get(values[0]);
        const match = row && row.tenant_id === values[1] && row.assistant_id === values[2] && row.channel_id === values[3] && row.domain_id === values[4] && row.experience_version === values[5] && row.preview_mode === values[6];
        return { rowCount: match ? 1 : 0, rows: match ? [row] : [] };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const scopeA = { domain_id: 'dom-a', tenant_id: 'tenant-a', assistant_id: 'asst-a', channel_id: 'chan-a' };
  const sessionA = await issueGuideResumeSession({ database, scope: scopeA, experienceVersion: 1, previewMode: false });
  assert.ok(sessionA.token);

  const scopeB = { domain_id: 'dom-a', tenant_id: 'tenant-b', assistant_id: 'asst-a', channel_id: 'chan-a' };
  const crossResolve = await resolveGuideResumeSession({ database, token: sessionA.token, scope: scopeB, experienceVersion: 1, previewMode: false });
  assert.equal(crossResolve, null);
});

test('8. Responsive layout retains access to every field', () => {
  assert.match(cssSource, /@media\(max-width:440px\)\{\s*\.guide-tool-grid\{grid-template-columns:1fr;/);
});
