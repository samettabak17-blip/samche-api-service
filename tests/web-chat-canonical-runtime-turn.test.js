import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  validateAndNormalizePageContext,
  updateSessionBrowsingState,
  buildContextualIntelligencePromptSection,
} from '../services/contextual-intelligence-service.js';
import {
  issuePublicWebChatSession,
  verifyPublicWebChatSession,
} from '../services/public-web-chat-session.js';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const webChatSource = fs.readFileSync(new URL('../public/web-chat.js', import.meta.url), 'utf8');
const demoHtmlSource = fs.readFileSync(new URL('../public/task8-demo/index.html', import.meta.url), 'utf8');

test('REGRESSION CONTRACT: app.js /api/chat returns JSON on all runtime paths and never unformatted plain text', () => {
  const chatRoute = appSource.slice(appSource.indexOf('app.post("/api/chat"'), appSource.indexOf('app.get("/webhook"'));

  // Ensure JSON response methods are used
  assert.match(chatRoute, /res\.json\(\{\s*reply:\s*aiReply/);
  assert.match(chatRoute, /res\.status\(200\)\.json\(\{\s*reply:\s*limitationReply/);
  assert.match(chatRoute, /res\.status\(200\)\.json\(\{\s*reply:\s*["']Temsilcimiz/);
  assert.match(chatRoute, /res\.status\(500\)\.json\(\{/);

  // Assert NO legacy raw text sends remain in the Web Chat handler
  assert.doesNotMatch(chatRoute, /res\.send\(aiReply\)/);
  assert.doesNotMatch(chatRoute, /res\.send\(limitationReply\)/);
  assert.doesNotMatch(chatRoute, /res\.status\(200\)\.send\(/);
  assert.doesNotMatch(chatRoute, /res\.status\(500\)\.send\(/);
});

test('REGRESSION CONTRACT: app.js accepts both req.body.page_context and top-level context payload', () => {
  const chatRoute = appSource.slice(appSource.indexOf('app.post("/api/chat"'), appSource.indexOf('app.get("/webhook"'));
  assert.match(chatRoute, /const rawContextPayload = req\.body\?\.page_context \|\|/);
  assert.match(chatRoute, /rawPageContext: rawContextPayload/);
});

test('REGRESSION CONTRACT: public/web-chat.js safely handles JSON, text fallback, and sends page_context', () => {
  // handleSend sends page_context
  assert.match(webChatSource, /page_context:\s*ctx/);

  // handleSend reads text then JSON.parses safely without uncaught SyntaxError
  assert.match(webChatSource, /var rawText = await res\.text\(\);/);
  assert.match(webChatSource, /JSON\.parse\(rawText\)/);

  // SPA listener tracks full URL (hash + query + pathname) for SPAs
  assert.match(webChatSource, /window\.location\.hash/);
});

test('REGRESSION CONTRACT: public/task8-demo/index.html catalog view exposes visible products in page context & JSON-LD', () => {
  // Catalog context provides visible products
  assert.match(demoHtmlSource, /visible_products:\s*PRODUCTS\.map/);
  assert.match(demoHtmlSource, /SamChe Teknoloji Mağazası Ürün Kataloğu/);

  // JSON-LD schema uses ItemList for catalog view
  assert.match(demoHtmlSource, /"@type":\s*"ItemList"/);
  assert.match(demoHtmlSource, /itemListElement/);
});

test('REGRESSION CONTRACT: Canonical session roundtrip and catalog context prompt generation', () => {
  const secret = 'test-secret-key-at-least-32-chars-long-123456';
  const session = issuePublicWebChatSession({
    widgetKey: 'wch_staging_task8_demo',
    secret,
  });

  assert.ok(session.token);
  assert.ok(session.sessionId);

  const verified = verifyPublicWebChatSession(session.token, { secret });
  assert.equal(verified.widgetKey, 'wch_staging_task8_demo');
  assert.equal(verified.sessionId, session.sessionId);

  const catalogContext = {
    url: 'https://samche-api-staging.onrender.com/task8-demo/',
    path: '/task8-demo/',
    title: 'SamChe Teknoloji Mağazası - Akıllı Cihazlar & Aksesuarlar',
    entity_type: 'Catalog',
    entity_name: 'SamChe Teknoloji Mağazası',
    entity_id: '/task8-demo/',
    summary: 'SamChe Teknoloji Mağazası Ürün Kataloğu: Titan Akıllı Saat Pro (2.499 TL), Ultra Güç Bankası 20.000 mAh (899 TL), SamChe Ses Pro Kablosuz Kulaklık ANC (1.799 TL), FIDO2 U2F Donanım Güvenlik Anahtarı (649 TL)',
    attributes: {
      visible_products: [
        'Titan Akıllı Saat Pro (2.499 TL)',
        'Ultra Güç Bankası 20.000 mAh (899 TL)',
        'SamChe Ses Pro Kablosuz Kulaklık ANC (1.799 TL)',
        'FIDO2 U2F Donanım Güvenlik Anahtarı (649 TL)',
      ],
      categories: ['Giyilebilir Teknoloji', 'Şarj Cihazları', 'Ses Sistemleri', 'Güvenlik & Donanım'],
      total_products: 4,
    },
  };

  const state = updateSessionBrowsingState({ currentState: null, rawPageContext: catalogContext });
  assert.ok(state.currentEntity);
  assert.equal(state.currentEntity.entity_name, 'SamChe Teknoloji Mağazası');

  const promptSection = buildContextualIntelligencePromptSection({
    currentEntity: state.currentEntity,
    previousEntities: state.previousEntities,
    channelType: 'WEB_CHAT',
  });

  // Prompt must contain the catalog products for grounding
  assert.ok(promptSection.includes('Titan Akıllı Saat Pro'));
  assert.ok(promptSection.includes('Ultra Güç Bankası 20.000 mAh'));
  assert.ok(promptSection.includes('SamChe Ses Pro Kablosuz Kulaklık ANC'));
  assert.ok(promptSection.includes('FIDO2 U2F Donanım Güvenlik Anahtarı'));
  assert.ok(promptSection.includes('MANDATORY SAFETY & GROUNDING POLICY'));
});
