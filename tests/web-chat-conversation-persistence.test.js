import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  issuePublicWebChatSession,
  verifyPublicWebChatSession,
  PublicWebChatSessionError,
} from '../services/public-web-chat-session.js';
import {
  updateSessionBrowsingState,
  updateSessionBrowsingStateWithEntity,
  formatVisitorContextForHandoff,
} from '../services/contextual-intelligence-service.js';
import { evaluateVisitorIntent } from '../services/visitor-intent-service.js';
import '../public/web-chat.js';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const { SamcheChatPersistence, SamcheChatUX } = globalThis;

// ============================================================================
// 1. CLIENT STORAGE & MULTI-TAB SAFETY
// ============================================================================
test('SamcheChatPersistence: isolates session tokens by widgetKey deterministically', () => {
  assert.ok(SamcheChatPersistence, 'SamcheChatPersistence must be defined');
  const keyA = SamcheChatPersistence.getStorageKey('widget_tenant_a');
  const keyB = SamcheChatPersistence.getStorageKey('widget_tenant_b');

  assert.notEqual(keyA, keyB, 'Storage keys for different tenants must never collide');
  assert.match(keyA, /widget_tenant_a/);
  assert.match(keyB, /widget_tenant_b/);

  SamcheChatPersistence.storeSession('widget_tenant_a', 'token_a_123');
  SamcheChatPersistence.storeSession('widget_tenant_b', 'token_b_456');

  assert.equal(SamcheChatPersistence.getStoredSession('widget_tenant_a'), 'token_a_123');
  assert.equal(SamcheChatPersistence.getStoredSession('widget_tenant_b'), 'token_b_456');

  SamcheChatPersistence.clearStoredSession('widget_tenant_a');
  assert.equal(SamcheChatPersistence.getStoredSession('widget_tenant_a'), null);
  assert.equal(SamcheChatPersistence.getStoredSession('widget_tenant_b'), 'token_b_456');
  SamcheChatPersistence.clearStoredSession('widget_tenant_b');
});

test('SamcheChatPersistence: hydrateHistory appends completed messages directly without fake typing animation', () => {
  const rendered = [];
  const fakeContainer = {};
  const history = [
    { role: 'user', content: 'Merhaba, akıllı saat arıyorum' },
    { role: 'assistant', content: 'Titan Akıllı Saat Pro modelimiz mevcuttur.' },
    { sender_type: 'CUSTOMER', content: 'Su geçirmez mi?' },
    { sender_type: 'ASSISTANT', content: 'Evet, IP68 sertifikalıdır.' },
  ];

  const count = SamcheChatPersistence.hydrateHistory(fakeContainer, history, (role, text) => {
    rendered.push({ role, text });
  });

  assert.equal(count, 4);
  assert.equal(rendered.length, 4);
  assert.equal(rendered[0].role, 'user');
  assert.equal(rendered[0].text, 'Merhaba, akıllı saat arıyorum');
  assert.equal(rendered[1].role, 'bot');
  assert.equal(rendered[1].text, 'Titan Akıllı Saat Pro modelimiz mevcuttur.');
  assert.equal(rendered[2].role, 'user');
  assert.equal(rendered[3].role, 'bot');
});

// ============================================================================
// 2. SIGNED SESSION VERIFICATION & TENANT ISOLATION
// ============================================================================
test('Public Web Chat Session: cross-tenant session restore is strictly rejected', () => {
  const secret = 'shared-test-secret-key-12345';
  const sessionTenantA = issuePublicWebChatSession({ secret, widgetKey: 'widget_tenant_a' });
  const verified = verifyPublicWebChatSession(sessionTenantA.token, { secret });

  assert.equal(verified.widgetKey, 'widget_tenant_a');
  assert.notEqual(verified.widgetKey, 'widget_tenant_b', 'Session cannot match another tenant widget');
});

test('Public Web Chat Session: expired or tampered session is rejected safely', () => {
  const secret = 'shared-test-secret-key-12345';
  const expiredSession = issuePublicWebChatSession({
    secret,
    widgetKey: 'widget_test',
    now: 1000,
    ttlSeconds: 10,
  });

  assert.throws(
    () => verifyPublicWebChatSession(expiredSession.token, { secret, now: 2000 }),
    (err) => err instanceof PublicWebChatSessionError && err.code === 'WEB_CHAT_SESSION_EXPIRED',
  );

  const forgedToken = expiredSession.token.slice(0, -6) + 'xxxxxx';
  assert.throws(
    () => verifyPublicWebChatSession(forgedToken, { secret, now: 1005 }),
    (err) => err instanceof PublicWebChatSessionError && err.code === 'WEB_CHAT_SESSION_INVALID',
  );
});

// ============================================================================
// 3. SPA & REFRESH BROWSING CONTEXT (CURRENT ENTITY WINS)
// ============================================================================
test('Browsing state: SPA navigation updates current entity and preserves previous entity', () => {
  const productA = {
    entity_name: 'Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    canonical_url: '/urun/titan',
    attributes: { price: 2499 },
  };
  const productB = {
    entity_name: 'Ultra Güç Bankası 20000mAh',
    entity_type: 'PRODUCT',
    canonical_url: '/urun/powerbank',
    attributes: { price: 899 },
  };

  const state1 = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: productA,
  });
  assert.equal(state1.currentEntity.entity_name, 'Titan Akıllı Saat Pro');
  assert.equal(state1.previousEntities.length, 0);

  const state2 = updateSessionBrowsingState({
    currentState: state1,
    rawPageContext: productB,
  });
  assert.equal(state2.currentEntity.entity_name, 'Ultra Güç Bankası 20000mAh');
  assert.equal(state2.previousEntities.length, 1);
  assert.equal(state2.previousEntities[0].entity_name, 'Titan Akıllı Saat Pro');
});

test('Browsing state: Full refresh on current entity preserves current and previous entities', () => {
  const productA = {
    entity_name: 'Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    canonical_url: '/urun/titan',
  };
  const productB = {
    entity_name: 'Ultra Güç Bankası 20000mAh',
    entity_type: 'PRODUCT',
    canonical_url: '/urun/powerbank',
  };

  let state = updateSessionBrowsingState({ currentState: null, rawPageContext: productA });
  state = updateSessionBrowsingState({ currentState: state, rawPageContext: productB });

  const refreshedState = updateSessionBrowsingState({
    currentState: state,
    rawPageContext: productB,
  });

  assert.equal(refreshedState.currentEntity.entity_name, 'Ultra Güç Bankası 20000mAh');
  assert.equal(refreshedState.previousEntities.length, 1);
  assert.equal(refreshedState.previousEntities[0].entity_name, 'Titan Akıllı Saat Pro');
});

test('Browsing state: Full refresh on new entity C replaces stale entity and moves B to previous', () => {
  const productA = { entity_name: 'Titan Akıllı Saat Pro', entity_type: 'PRODUCT' };
  const productB = { entity_name: 'Ultra Güç Bankası 20000mAh', entity_type: 'PRODUCT' };
  const productC = { entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC', entity_type: 'PRODUCT' };

  let state = updateSessionBrowsingState({ currentState: null, rawPageContext: productA });
  state = updateSessionBrowsingState({ currentState: state, rawPageContext: productB });

  const stateC = updateSessionBrowsingState({ currentState: state, rawPageContext: productC });

  assert.equal(stateC.currentEntity.entity_name, 'SamChe Ses Pro Kablosuz Kulaklık ANC');
  assert.equal(stateC.previousEntities.length, 2);
  assert.equal(stateC.previousEntities[0].entity_name, 'Ultra Güç Bankası 20000mAh');
  assert.equal(stateC.previousEntities[1].entity_name, 'Titan Akıllı Saat Pro');
});

// ============================================================================
// 4. PROACTIVE CHAT SAFETY ACROSS REFRESH
// ============================================================================
test('Proactive safety: active conversation or dismissal cooldown blocks auto-open on refresh', () => {
  const intentWithConversation = evaluateVisitorIntent({
    pageContext: { path: '/urun/powerbank', page_type: 'product_detail' },
    currentEntity: { entity_name: 'Ultra Güç Bankası 20000mAh', entity_type: 'PRODUCT' },
    sessionBrowsing: { dwellSeconds: 30 },
    engagementState: {
      hasConversation: true,
      messageCount: 4,
    },
  });
  assert.equal(intentWithConversation.shouldAutoOpen, false);
  assert.equal(intentWithConversation.reason, 'ACTIVE_CONVERSATION');

  const intentWithDismissal = evaluateVisitorIntent({
    pageContext: { path: '/urun/powerbank', page_type: 'product_detail' },
    currentEntity: { entity_name: 'Ultra Güç Bankası 20000mAh', entity_type: 'PRODUCT' },
    sessionBrowsing: { dwellSeconds: 30 },
    engagementState: {
      dismissedAt: new Date().toISOString(),
    },
  });
  assert.equal(intentWithDismissal.shouldAutoOpen, false);
  assert.equal(intentWithDismissal.reason, 'DISMISSAL_COOLDOWN');
});


// ============================================================================
// 5. SERVER BACKEND RUNTIME CONTRACTS
// ============================================================================
test('app.js: POST /api/chat/bootstrap supports session resumption and history hydration', () => {
  assert.match(appSource, /app\.post\("\/api\/chat\/bootstrap"/);
  assert.match(appSource, /extractWebChatSessionToken\(req\)/);
  assert.match(appSource, /getWebChatPublicFeed\(/);
  assert.match(appSource, /loadWebChatSessionBrowsingState\(/);
  assert.match(appSource, /resumed:\s*true/);
  assert.match(appSource, /resumed:\s*false/);
  assert.match(appSource, /history/);
  assert.match(appSource, /browsing_state/);
  assert.match(appSource, /handling_mode/);
});

test('app.js: GET /api/chat/history supports signed Web Chat sessions', () => {
  assert.match(appSource, /app\.get\("\/api\/chat\/history"/);
  assert.match(appSource, /extractWebChatSessionToken\(req\)/);
  assert.match(appSource, /getWebChatPublicFeed\(/);
});

test('app.js: POST /api/chat persists inbound & outbound and protects human takeover', () => {
  assert.match(appSource, /persistWebChatInbound\(/);
  assert.match(appSource, /persistAssistantResponseIfCurrent\(/);
  assert.match(appSource, /webChatInboundState && !webChatInboundState\.shouldInvokeAi/);
  assert.match(appSource, /Temsilcimiz şu anda görüşmede, mesajınız iletildi/);
});

// ============================================================================
// 6. NO TENANT SPECIFIC CODE IN PERSISTENCE
// ============================================================================
test('NO_TENANT_SPECIFIC_CODE: zero customer-name conditionals in persistence engine', () => {
  assert.doesNotMatch(appSource, /if\s*\(.*tenant.*===.*['"](?:samche|customer|client)/i);
  assert.doesNotMatch(appSource, /if\s*\(.*widget_key.*===.*['"]wch_staging_task8_demo['"]\)/);
});

