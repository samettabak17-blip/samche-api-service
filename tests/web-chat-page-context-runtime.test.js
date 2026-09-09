import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('app.js exposes POST /api/chat/page-context with signed session verification', () => {
  assert.match(appSource, /app\.post\("\/api\/chat\/page-context"/);
  assert.match(appSource, /verifyPublicWebChatSession\(suppliedWebChatSession/);
  assert.match(appSource, /resolvePublicWebChatIntegration\(\{/);
  assert.match(appSource, /updateSessionBrowsingState\(\{/);
  assert.match(appSource, /saveWebChatSessionBrowsingState\(\{/);
  assert.match(appSource, /logContextualObservability\('PAGE_CONTEXT_RECEIVED'/);
  assert.match(appSource, /logContextualObservability\('PAGE_CONTEXT_VALIDATED'/);
  assert.match(appSource, /logContextualObservability\('CURRENT_ENTITY_RESOLVED'/);
  assert.match(appSource, /logContextualObservability\('PREVIOUS_ENTITY_COUNT'/);
});

test('app.js integrates page context into POST /api/chat system instruction', () => {
  assert.match(appSource, /loadWebChatSessionBrowsingState\(\{/);
  assert.match(appSource, /buildContextualIntelligencePromptSection\(\{/);
  assert.match(appSource, /logContextualObservability\('PAGE_CONTEXT_USED'/);
  assert.match(appSource, /contextualIntelligence:\s*webChatContextualSection/);
  assert.doesNotMatch(appSource, /req\.body\.tenant_id|req\.body\.assistant_id/);
});

test('app.js shares canonical page context with AI Guide runtime', () => {
  assert.match(appSource, /buildGuidePageContextSummary\(/);
  assert.match(appSource, /contextualIntelligence:\s*guidePageContextSummary/);
});

test('public/web-chat.js static asset is served', () => {
  assert.match(appSource, /app\.get\('\/web-chat\.js'/);
  assert.ok(fs.existsSync(new URL('../public/web-chat.js', import.meta.url)));
});

test('app.js exposes canonical proactive visitor intent endpoints', () => {
  assert.match(appSource, /app\.post\("\/api\/chat\/evaluate-intent"/);
  assert.match(appSource, /app\.post\("\/api\/chat\/dismiss-proactive"/);
  assert.match(appSource, /evaluateVisitorIntent\(\{/);
  assert.match(appSource, /proactive_engagement:\s*\{/);
  assert.match(appSource, /updateWebChatSessionEngagementState\(\{/);
  assert.match(appSource, /extractWebChatSessionToken\(req\)/);
});

