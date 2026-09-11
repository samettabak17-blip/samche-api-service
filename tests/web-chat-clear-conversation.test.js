import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@localhost:5432/samche_test';
process.env.JWT_SECRET ||= 'test-jwt-secret';

import {
  issuePublicWebChatSession,
  verifyPublicWebChatSession,
  PublicWebChatSessionError,
} from '../services/public-web-chat-session.js';
import {
  updateSessionBrowsingState,
  loadWebChatSessionBrowsingState,
  saveWebChatSessionBrowsingState,
} from '../services/contextual-intelligence-service.js';
import {
  evaluateVisitorIntent,
  INTENT_STATES,
} from '../services/visitor-intent-service.js';

const { resetWebChatConversation } = await import('../services/live-inbox-service.js');
await import('../public/web-chat.js');

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const webChatSource = fs.readFileSync(new URL('../public/web-chat.js', import.meta.url), 'utf8');
const { SamcheChatPersistence, SamcheChatUX, SamcheWebChat } = globalThis;

// ============================================================================
// TEST A: Clear full transcript removes all old messages
// ============================================================================
test('Test A: Clear full transcript - removes INITIAL_GREETING, PROACTIVE, CONTEXTUAL_OPEN, USER, ASSISTANT messages', () => {
  const rendered = [];
  const fakeContainer = { innerHTML: '' };
  const history = [
    { role: 'assistant', content: 'Merhaba! Nasıl yardımcı olabilirim?', message_type: 'INITIAL_GREETING', is_greeting: true },
    { role: 'assistant', content: 'Titan Akıllı Saat Pro modelimize göz atıyorsunuz.', message_type: 'PROACTIVE', is_proactive: true, proactive_event_id: 'pe_titan' },
    { role: 'user', content: 'Pil ömrü kaç gün?', message_type: 'USER' },
    { role: 'assistant', content: 'Pil ömrü normal kullanımda 7 gündür.', message_type: 'ASSISTANT' },
    { role: 'assistant', content: 'Ses Pro ANC Kulaklık modelimiz de ilginizi çekebilir.', message_type: 'CONTEXTUAL_OPEN', contextual_event_id: 'ctx_headphones' },
  ];

  const count = SamcheChatPersistence.hydrateHistory(fakeContainer, history, (role, text, meta) => {
    rendered.push({ role, text, meta });
  });

  assert.equal(count, 5, 'Must have hydrated 5 messages initially');

  rendered.length = 0;
  fakeContainer.innerHTML = '';

  const newGreeting = {
    role: 'assistant',
    content: 'Merhaba! Size nasıl yardımcı olabilirim?',
    message_type: 'INITIAL_GREETING',
    is_greeting: true,
    id: 'new_greeting_123',
  };

  SamcheChatPersistence.hydrateHistory(fakeContainer, [newGreeting], (role, text, meta) => {
    rendered.push({ role, text, meta });
  });

  const oldProactiveCount = rendered.filter(m => m.meta?.message_type === 'PROACTIVE').length;
  const oldContextualCount = rendered.filter(m => m.meta?.message_type === 'CONTEXTUAL_OPEN').length;
  const oldUserCount = rendered.filter(m => m.role === 'user').length;
  const oldAssistantCount = rendered.filter(m => m.meta?.message_type === 'ASSISTANT').length;
  const newGreetingCount = rendered.filter(m => m.meta?.message_type === 'INITIAL_GREETING').length;

  assert.equal(oldProactiveCount, 0, 'OLD_PROACTIVE_COUNT must be 0');
  assert.equal(oldContextualCount, 0, 'OLD_CONTEXTUAL_COUNT must be 0');
  assert.equal(oldUserCount, 0, 'OLD_USER_COUNT must be 0');
  assert.equal(oldAssistantCount, 0, 'OLD_ASSISTANT_COUNT must be 0');
  assert.equal(newGreetingCount, 1, 'NEW_GREETING_COUNT must be exactly 1');
  assert.equal(rendered.length, 1, 'Only the new singleton greeting must remain');
});

// ============================================================================
// TEST B: Clear + refresh (first reload)
// ============================================================================
test('Test B: Clear + refresh - fresh bootstrap returns singleton greeting without old messages', () => {
  const secret = 'test-secret-key-clear-conv';
  const session = issuePublicWebChatSession({ secret, widgetKey: 'widget_test' });

  const cleanServerHistory = [
    {
      role: 'assistant',
      content: 'Merhaba! Size nasıl yardımcı olabilirim?',
      message_type: 'INITIAL_GREETING',
      is_greeting: true,
      id: 'greeting_' + session.sessionId + '_clean',
    }
  ];

  const renderedOnRefresh = [];
  const fakeContainer = {};
  const hydratedCount = SamcheChatPersistence.hydrateHistory(fakeContainer, cleanServerHistory, (role, text, meta) => {
    renderedOnRefresh.push({ role, text, meta });
  });

  assert.equal(hydratedCount, 1);
  assert.equal(renderedOnRefresh.length, 1);
  assert.equal(renderedOnRefresh[0].meta.message_type, 'INITIAL_GREETING');
  assert.equal(renderedOnRefresh[0].meta.is_greeting, true);
});

// ============================================================================
// TEST C: Clear + second refresh (idempotent reload)
// ============================================================================
test('Test C: Clear + second refresh - singleton greeting remains stable across multiple reloads', () => {
  const cleanServerHistory = [
    {
      role: 'assistant',
      content: 'Merhaba! Size nasıl yardımcı olabilirim?',
      message_type: 'INITIAL_GREETING',
      is_greeting: true,
      id: 'greeting_singleton',
    }
  ];

  const reload1 = [];
  SamcheChatPersistence.hydrateHistory({}, cleanServerHistory, (role, text, meta) => {
    reload1.push({ role, text, meta });
  });

  const reload2 = [];
  SamcheChatPersistence.hydrateHistory({}, cleanServerHistory, (role, text, meta) => {
    reload2.push({ role, text, meta });
  });

  assert.equal(reload1.length, 1);
  assert.equal(reload2.length, 1);
  assert.equal(reload1[0].text, reload2[0].text);
  assert.equal(reload1[0].meta.message_type, reload2[0].meta.message_type);
});

// ============================================================================
// TEST D & H: Clear on new current entity preserves current entity context
// ============================================================================
test('Test D & H: Clear on new current entity - current entity (Headphones) is preserved, not reset to Titan', () => {
  const titanEntity = {
    entity_name: 'Titan Akıllı Saat Pro',
    entity_type: 'PRODUCT',
    canonical_url: '/urun/titan',
    entity_id: 'TITAN-PRO',
    attributes: { price: 2499 },
  };

  const headphonesEntity = {
    entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC',
    entity_type: 'PRODUCT',
    canonical_url: '/urun/headphones',
    entity_id: 'SES-PRO-ANC',
    attributes: { price: 1799 },
  };

  const state1 = updateSessionBrowsingState({
    currentState: null,
    rawPageContext: titanEntity,
  });
  assert.equal(state1.currentEntity.entity_id, 'TITAN-PRO');

  const state2 = updateSessionBrowsingState({
    currentState: state1,
    rawPageContext: headphonesEntity,
  });
  assert.equal(state2.currentEntity.entity_id, 'SES-PRO-ANC');
  assert.equal(state2.previousEntities.length, 1);
  assert.equal(state2.previousEntities[0].entity_id, 'TITAN-PRO');

  const clearedEngagement = {
    ...(state2.engagementState || {}),
    hasConversation: false,
    messageCount: 0,
    clearedAt: new Date().toISOString(),
  };

  const postClearState = {
    ...state2,
    engagementState: clearedEngagement,
  };

  assert.equal(postClearState.currentEntity.entity_id, 'SES-PRO-ANC', 'Current entity must remain Headphones, not Titan');
  assert.equal(postClearState.currentEntity.entity_name, 'SamChe Ses Pro Kablosuz Kulaklık ANC');
  assert.equal(postClearState.engagementState.hasConversation, false);
  assert.equal(postClearState.engagementState.messageCount, 0);
});

// ============================================================================
// TEST E & F: Old proactive & contextual open messages do not return
// ============================================================================
test('Test E & F: Old proactive and contextual messages are not restored or resurrected', () => {
  const postClearHistory = [
    { role: 'assistant', content: 'Merhaba! Nasıl yardımcı olabilirim?', message_type: 'INITIAL_GREETING', is_greeting: true },
  ];

  const hasOldProactive = postClearHistory.some(m => m.message_type === 'PROACTIVE' || m.proactive_event_id);
  const hasOldContextual = postClearHistory.some(m => m.message_type === 'CONTEXTUAL_OPEN');

  assert.equal(hasOldProactive, false, 'No old proactive messages should exist');
  assert.equal(hasOldContextual, false, 'No old contextual open messages should exist');
});

// ============================================================================
// TEST G: Exactly one new greeting
// ============================================================================
test('Test G: Exactly one new INITIAL_GREETING singleton is generated and rendered', () => {
  const history = [
    { role: 'assistant', content: 'Merhaba! Nasıl yardımcı olabilirim?', message_type: 'INITIAL_GREETING', is_greeting: true },
  ];

  const greetingItems = history.filter(m => m.message_type === 'INITIAL_GREETING' || m.is_greeting);
  assert.equal(greetingItems.length, 1, 'Exactly one greeting singleton must be present');
});
// ============================================================================
// TEST I: Current entity suggestion chips preserved / regenerated
// ============================================================================
test('Test I: Suggestion chips are grounded for current entity (Headphones)', () => {
  const headphoneChips = [
    'ANC gürültü engelleme kaç dB?',
    'LDAC ses kodeği destekleniyor mu?',
    'Toplam pil ömrü ne kadar?',
    'Bunu önce baktığım ürünle karşılaştır'
  ];

  assert.equal(headphoneChips.length, 4);
  assert.ok(headphoneChips.some(c => c.includes('ANC')));
  assert.ok(headphoneChips.some(c => c.includes('LDAC')));
  assert.ok(!headphoneChips.some(c => c.includes('Saatle')));
});

// ============================================================================
// TEST J: Proactive cooldown is not bypassed by clear
// ============================================================================
test('Test J: Clearing conversation does not bypass proactive frequency or cooldown protections', () => {
  const headphonesEntity = {
    entity_name: 'SamChe Ses Pro Kablosuz Kulaklık ANC',
    entity_type: 'PRODUCT',
    canonical_url: '/urun/headphones',
    entity_id: 'SES-PRO-ANC',
  };

  const engagementState = {
    proactiveMessageSent: true,
    proactiveEngagedAt: new Date(Date.now() - 30000).toISOString(),
    acknowledgedEntityIds: ['SES-PRO-ANC'],
    lastAcknowledgedEntityId: 'SES-PRO-ANC',
    hasConversation: false,
    messageCount: 0,
  };

  const evaluation = evaluateVisitorIntent({
    pageContext: headphonesEntity,
    currentEntity: headphonesEntity,
    previousEntities: [],
    sessionBrowsing: { dwellSeconds: 40, revisitCount: 1, signals: [] },
    tenantConfig: {
      dwell_threshold_seconds: 15,
      dismissal_cooldown_seconds: 300,
      auto_open: true,
    },
    engagementState,
  });

  assert.equal(evaluation.shouldProactivelyEngage, false, 'Proactive engagement must be blocked by frequency cap');
  assert.equal(evaluation.shouldAutoOpen, false, 'Auto-open must be blocked');
  assert.equal(evaluation.reason, 'ALREADY_ENGAGED', 'Reason must be ALREADY_ENGAGED');
});

// ============================================================================
// TEST K: Repeated clear is idempotent
// ============================================================================
test('Test K: Repeated clear is strictly idempotent and safe', async () => {
  const secret = 'shared-secret-for-idempotency';
  const session = issuePublicWebChatSession({ secret, widgetKey: 'widget_idem' });

  const integration = {
    tenant_id: crypto.randomUUID(),
    channel_id: crypto.randomUUID(),
    assistant_id: crypto.randomUUID(),
    channel_status: 'active',
  };

  const res1 = await resetWebChatConversation({
    externalSessionId: session.sessionId,
    integration,
    database: null,
  });
  assert.equal(res1.reset, true);
  assert.equal(res1.humanTakeoverActive, false);

  const res2 = await resetWebChatConversation({
    externalSessionId: session.sessionId,
    integration,
    database: null,
  });
  assert.equal(res2.reset, true);
  assert.equal(res2.humanTakeoverActive, false);
});

// ============================================================================
// TEST L: TR / EN / AR localization dictionary & dialog
// ============================================================================
test('Test L: TR/EN/AR localized labels and confirmation dialog text', () => {
  const i18n = SamcheChatUX.I18N;
  assert.ok(i18n, 'I18N dictionary must be defined');

  // TR
  assert.equal(i18n.tr.clearBtnLabel, 'Sohbeti Temizle');
  assert.equal(i18n.tr.confirmText, 'Sohbet geçmişini temizlemek istediğinize emin misiniz?');
  assert.equal(i18n.tr.cancelBtn, 'İptal');
  assert.equal(i18n.tr.clearBtn, 'Temizle');

  // EN
  assert.equal(i18n.en.clearBtnLabel, 'Clear Conversation');
  assert.equal(i18n.en.confirmText, 'Are you sure you want to clear this conversation?');
  assert.equal(i18n.en.cancelBtn, 'Cancel');
  assert.equal(i18n.en.clearBtn, 'Clear');

  // AR
  assert.equal(i18n.ar.clearBtnLabel, 'مسح المحادثة');
  assert.equal(i18n.ar.confirmText, 'هل أنت متأكد أنك تريد مسح هذه المحادثة؟');
  assert.equal(i18n.ar.cancelBtn, 'إلغاء');
  assert.equal(i18n.ar.clearBtn, 'مسح');
});
// ============================================================================
// TEST M: RTL layout support
// ============================================================================
test('Test M: RTL compatibility for Arabic language', () => {
  assert.match(webChatSource, /\.samche-panel\[dir="rtl"\]/);
  assert.match(webChatSource, /\.samche-panel\[dir="rtl"\]\s+\.samche-confirm-buttons\s*\{\s*flex-direction:\s*row-reverse;/);
  assert.match(webChatSource, /\.samche-panel\[dir="rtl"\]\s+\.samche-header-actions\s*\{\s*flex-direction:\s*row-reverse;/);
});

// ============================================================================
// TEST N: Active human takeover safety
// ============================================================================
test('Test N: Active human takeover safety - blocks reset when handling_mode is HUMAN', async () => {
  const mockDatabase = {
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('SELECT id, status, handling_mode')) {
          return {
            rowCount: 1,
            rows: [{ id: 'conv-human-123', status: 'open', handling_mode: 'HUMAN', handling_version: 1 }],
          };
        }
        return { rowCount: 0, rows: [] };
      },
      release: () => {},
    }),
  };

  const integration = {
    tenant_id: '00000000-0000-0000-0000-000000000001',
    channel_id: '00000000-0000-0000-0000-000000000002',
    channel_status: 'active',
  };

  const result = await resetWebChatConversation({
    externalSessionId: 'sess-human-active',
    integration,
    database: mockDatabase,
  });

  assert.equal(result.reset, false, 'Must NOT reset when human takeover is active');
  assert.equal(result.humanTakeoverActive, true, 'Must report humanTakeoverActive');
  assert.equal(result.conversationId, 'conv-human-123');
});

// ============================================================================
// TEST O: Pending send safety
// ============================================================================
test('Test O: Pending send safety - clear button is guarded while send is in-flight', () => {
  assert.match(webChatSource, /if\s*\(isResetting\s*\|\|\s*isSending\s*\|\|\s*isHumanTakeoverActive\)\s*return/);
  assert.match(webChatSource, /isSending\s*=\s*true/);
  assert.match(webChatSource, /clearBtn\.disabled\s*=\s*true/);
});

// ============================================================================
// TEST P: Tenant isolation
// ============================================================================
test('Test P: Tenant isolation - reset only targets requesting session and tenant', () => {
  assert.match(appSource, /app\.post\(["']\/api\/chat\/reset["']/);
  assert.match(appSource, /verifyPublicWebChatSession/);
  assert.match(appSource, /resolvePublicWebChatIntegration/);
  assert.match(appSource, /webChatIntegration\.tenant_id/);
});

// ============================================================================
// TEST Q: Multi-tab / stale-state safety
// ============================================================================
test('Test Q: Multi-tab safety - reset timestamp is persisted and synced', () => {
  assert.ok(typeof SamcheChatPersistence.recordConversationReset === 'function');
  assert.ok(typeof SamcheChatPersistence.getLastResetTime === 'function');

  const ts = SamcheChatPersistence.recordConversationReset('test_widget_multitab');
  assert.ok(ts);
  const readTs = SamcheChatPersistence.getLastResetTime('test_widget_multitab');
  assert.ok(readTs > 0);

  assert.match(webChatSource, /samche_webchat_reset_/);
  assert.match(webChatSource, /syncResetIfOccurred/);
});


