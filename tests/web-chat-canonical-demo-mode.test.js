import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDemoEntryIntent,
  normalizeDemoModeConfig,
  formatWhatsAppDemoIntroduction,
  formatWebChatDemoWelcome,
  formatGuideDemoWelcome,
  buildDemoRuntimeGuidance,
} from '../services/tenant-demo-mode-service.js';
import {
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';

const samcheTechDemoConfig = normalizeDemoModeConfig({
  enabled: true,
  platform_name: 'SamChe AI',
  business_name: 'SamChe Technology',
  business_type: 'e-commerce store',
  business_context: 'For this demonstration, SamChe Technology represents an e-commerce electronics and consumer tech store.',
  disclosure: 'This is an e-commerce demonstration experience powered by SamChe AI.',
  transition_behavior: 'continue_as_tenant_assistant',
  welcome_title: 'Welcome to the SamChe AI Demo',
  webchat_welcome: "Welcome to the SamChe AI Demo\n\nYou're exploring SamChe Technology, an e-commerce demo powered by SamChe AI. I can help you discover and compare products, answer questions about the products you're viewing, and assist with orders, delivery, returns and other support questions.\n\nTry one of the examples below or ask me anything.",
  scenarios: [
    { id: 'compare_products', label: 'Compare products', prompt: 'Can you compare the top products in your catalog?' },
    { id: 'choose_product', label: 'Help me choose a product', prompt: 'Help me choose the right product for my needs.' },
    { id: 'order_status', label: 'Where is my order?', prompt: 'Where is my order and how can I track it?' },
    { id: 'product_problem', label: 'I have a problem with a product', prompt: 'I have a problem with a product I received.' },
    { id: 'return_policy', label: 'What is your return policy?', prompt: 'What is your return and refund policy?' },
  ],
  translations: {
    tr: {
      welcome_title: 'SamChe AI Demosuna Hoş Geldiniz',
      webchat_welcome: "SamChe AI Demosuna Hoş Geldiniz\n\nSamChe AI tarafından desteklenen bir e-ticaret demosu olan SamChe Teknoloji'yi keşfediyorsunuz. Ürünleri keşfetmenize ve karşılaştırmanıza, görüntülediğiniz ürünlerle ilgili soruları yanıtlamanıza ve siparişler, teslimat, iadeler ve diğer destek sorularında yardımcı olabilirim.\n\nAşağıdaki örneklerden birini deneyin veya bana herhangi bir şey sorun.",
      chips: ['Ürünleri karşılaştır', 'Ürün seçmeme yardım et', 'Siparişim nerede?', 'Ürünümle ilgili bir sorun var', 'İade politikanız nedir?'],
    },
    ar: {
      welcome_title: 'مرحباً بكم في عرض SamChe AI التجريبي',
      webchat_welcome: "مرحباً بكم في عرض SamChe AI التجريبي\n\nأنت تستكشف الآن SamChe Technology، وهو عرض تجريبي للتجارة الإلكترونية مدعوم بـ SamChe AI. يمكنني مساعدتك في استكشاف المنتجات ومقارنتها، والإجابة على الأسئلة المتعلقة بالمنتجات التي تتصفحها، والمساعدة في الطلبات والتوصيل والإرجاع واستفسارات الدعم الأخرى.\n\nجرّب أحد الأمثلة أدناه أو اسألني أي شيء.",
      chips: ['مقارنة المنتجات', 'ساعدني في اختيار منتج', 'أين طلبي؟', 'لدي مشكلة في منتج', 'ما هي سياسة الإرجاع؟'],
    },
  },
});

const blueDuneDemoConfig = normalizeDemoModeConfig({
  enabled: true,
  platform_name: 'SamChe AI',
  business_name: 'Blue Dune',
  business_type: 'event management company',
  business_context: 'For this demonstration, Blue Dune represents an event management company.',
  disclosure: 'This is a demonstration experience powered by SamChe AI.',
  transition_behavior: 'continue_as_tenant_assistant',
  scenarios: [
    { id: 'plan_event', label: 'Plan an Event', prompt: "I'm planning a corporate event for 150 guests in Dubai. Can you help?" },
    { id: 'ask_services', label: 'Ask About Services', prompt: 'I need help choosing the right event service.' },
    { id: 'customer_support', label: 'Try Customer Support', prompt: 'I have a problem with an existing booking.' },
    { id: 'request_human', label: 'Request a Human', prompt: 'I want to speak to a human.' },
  ],
});

test('1. demo_mode enabled e-commerce tenant receives configured demo welcome and starter questions', () => {
  const welcomeEn = formatWebChatDemoWelcome({ demoMode: samcheTechDemoConfig, language: 'en' });
  assert.equal(welcomeEn.welcome_title, 'Welcome to the SamChe AI Demo');
  assert.ok(welcomeEn.welcome_message.includes('Welcome to the SamChe AI Demo'));
  assert.ok(welcomeEn.welcome_message.includes("You're exploring SamChe Technology, an e-commerce demo powered by SamChe AI."));
  assert.ok(welcomeEn.welcome_message.includes('I can help you discover and compare products, answer questions about the products you\'re viewing, and assist with orders, delivery, returns and other support questions.'));
  assert.ok(welcomeEn.welcome_message.includes('Try one of the examples below or ask me anything.'));
  assert.deepEqual(welcomeEn.chips, [
    'Compare products',
    'Help me choose a product',
    'Where is my order?',
    'I have a problem with a product',
    'What is your return policy?',
  ]);

  const welcomeTr = formatWebChatDemoWelcome({ demoMode: samcheTechDemoConfig, language: 'tr' });
  assert.equal(welcomeTr.welcome_title, 'SamChe AI Demosuna Hoş Geldiniz');
  assert.ok(welcomeTr.welcome_message.includes("SamChe AI tarafından desteklenen bir e-ticaret demosu olan SamChe Teknoloji'yi keşfediyorsunuz."));
  assert.deepEqual(welcomeTr.chips, [
    'Ürünleri karşılaştır',
    'Ürün seçmeme yardım et',
    'Siparişim nerede?',
    'Ürünümle ilgili bir sorun var',
    'İade politikanız nedir?',
  ]);

  const welcomeAr = formatWebChatDemoWelcome({ demoMode: samcheTechDemoConfig, language: 'ar' });
  assert.equal(welcomeAr.welcome_title, 'مرحباً بكم في عرض SamChe AI التجريبي');
  assert.ok(welcomeAr.welcome_message.includes('SamChe Technology، وهو عرض تجريبي للتجارة الإلكترونية'));
  assert.deepEqual(welcomeAr.chips, [
    'مقارنة المنتجات',
    'ساعدني في اختيار منتج',
    'أين طلبي؟',
    'لدي مشكلة في منتج',
    'ما هي سياسة الإرجاع؟',
  ]);
});

test('2. non-demo tenant receives pure white-label greeting with zero demo disclosure', () => {
  const disabledConfig = normalizeDemoModeConfig({ enabled: false });
  assert.equal(disabledConfig.enabled, false);

  const welcome = formatWebChatDemoWelcome({ demoMode: disabledConfig, language: 'en' });
  assert.equal(welcome, null);

  const persona = {
    available: true,
    companyIdentity: 'TechStore LLC',
    assistantIdentity: 'TechStore Assistant',
    demoMode: disabledConfig,
    profile: { company_display_name: 'TechStore LLC', industry: 'Consumer Electronics' },
    configuration: { assistant_identity: 'TechStore Assistant' },
  };

  const sysInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'Standard shipping: 2-3 business days.',
  });

  assert.ok(!sysInstruction.toLowerCase().includes('samche ai demo'));
  assert.ok(!sysInstruction.includes('DEMO MODE OPERATING INSTRUCTION'));
  assert.ok(sysInstruction.includes('RUNTIME IDENTITY: You are TechStore Assistant, the AI assistant for TechStore LLC.'));
});

test('3. Blue Dune and SamChe Technology configurations remain isolated with zero cross-tenant leakage', () => {
  const blueDuneWelcome = formatWebChatDemoWelcome({ demoMode: blueDuneDemoConfig, language: 'en' });
  const samcheTechWelcome = formatWebChatDemoWelcome({ demoMode: samcheTechDemoConfig, language: 'en' });

  // Blue Dune receives event management welcome and event planning chips
  assert.ok(blueDuneWelcome.welcome_message.includes('Blue Dune AI — an event management assistant'));
  assert.ok(blueDuneWelcome.chips.includes('Plan an Event'));
  assert.ok(!blueDuneWelcome.welcome_message.includes('e-commerce'));
  assert.ok(!blueDuneWelcome.chips.includes('Compare products'));

  // SamChe Technology receives e-commerce welcome and product starter questions
  assert.ok(samcheTechWelcome.welcome_message.includes('e-commerce demo powered by SamChe AI'));
  assert.ok(samcheTechWelcome.chips.includes('Compare products'));
  assert.ok(samcheTechWelcome.chips.includes('What is your return policy?'));
  assert.ok(!samcheTechWelcome.welcome_message.includes('event management'));
  assert.ok(!samcheTechWelcome.chips.includes('Plan an Event'));
});

test('4. demo introduction does not repeat on subsequent conversation turns in system prompt', () => {
  const persona = {
    available: true,
    companyIdentity: 'SamChe Technology',
    assistantIdentity: 'SamChe Tech Assistant',
    demoMode: samcheTechDemoConfig,
    profile: { company_display_name: 'SamChe Technology', industry: 'E-Commerce' },
    configuration: { assistant_identity: 'SamChe Tech Assistant' },
  };

  const sysInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: 'AirPure HEPA Filter AED 219.00.',
  });

  assert.ok(sysInstruction.includes('DEMO MODE OPERATING INSTRUCTION:'));
  assert.ok(sysInstruction.includes('Do NOT repeat or advertise SamChe AI branding in your ongoing business answers'));
  assert.ok(sysInstruction.includes('RUNTIME IDENTITY: You are SamChe Tech Assistant, the AI assistant for SamChe Technology.'));
});

test('5. demo-entry intent detection correctly identifies semantic demo inquiries across EN/TR/AR', () => {
  assert.equal(isDemoEntryIntent('I want to try the SamChe AI demo'), true);
  assert.equal(isDemoEntryIntent('SamChe AI demosunu denemek istiyorum'), true);
  assert.equal(isDemoEntryIntent('أريد تجربة عرض SamChe AI التجريبي'), true);
  assert.equal(isDemoEntryIntent('try demo'), true);
  assert.equal(isDemoEntryIntent('Can I test the demo?'), true);

  // Regular business inquiries must NOT trigger demo entry intent
  assert.equal(isDemoEntryIntent('Compare products'), false);
  assert.equal(isDemoEntryIntent('Where is my order?'), false);
  assert.equal(isDemoEntryIntent('What is your return policy?'), false);
  assert.equal(isDemoEntryIntent('How much is the AirPure HEPA Purifier?'), false);
});

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserCdp, findBrowserBinary } from './helpers/browser-cdp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const htmlFixturePath = path.join(rootDir, 'public', 'task8-demo', 'index.html');
const webChatJsPath = path.join(rootDir, 'public', 'web-chat.js');

let server;
let serverPort;
let baseUrl;
let browser;
let chatRequests = [];

test('SETUP: Initialize Mock Server & Headless Browser for Demo Mode Acceptance', async () => {
  const binary = findBrowserBinary();
  if (!fs.existsSync(binary)) {
    console.log('Skipping real browser tests: no browser binary found at', binary);
    return;
  }

  const htmlContent = fs.readFileSync(htmlFixturePath, 'utf8');
  const jsContent = fs.readFileSync(webChatJsPath, 'utf8');

  server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/task8-demo/' || url.pathname === '/task8-demo/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlContent);
      return;
    }

    if (url.pathname === '/web-chat.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(jsContent);
      return;
    }

    if (url.pathname === '/api/chat/bootstrap') {
      const demoWelcome = formatWebChatDemoWelcome({ demoMode: samcheTechDemoConfig, language: 'en' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        session: 'wch_sess_demo_mode_test',
        resumed: false,
        history: [
          {
            role: 'assistant',
            content: demoWelcome.welcome_message,
            message_type: 'INITIAL_GREETING',
            is_greeting: true,
            id: 'greeting_wch_sess_demo_mode_test',
          }
        ],
        appearance: {
          title: 'SamChe Technology',
          subtitle: 'Online | SamChe AI',
          launcher_position: 'right',
          theme_mode: 'dark',
          launcher_label: 'SamChe Support',
        },
        behavior: {
          language: 'en',
          proactive_enabled: false,
        },
        demo_mode: samcheTechDemoConfig,
        quick_questions: demoWelcome.chips,
      }));
      return;
    }

    if (url.pathname === '/api/chat/reset') {
      const demoWelcome = formatWebChatDemoWelcome({ demoMode: samcheTechDemoConfig, language: 'en' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        cleared: true,
        session: 'wch_sess_demo_mode_test',
        history: [
          {
            role: 'assistant',
            content: demoWelcome.welcome_message,
            message_type: 'INITIAL_GREETING',
            is_greeting: true,
            id: 'greeting_reset_123',
          }
        ],
        appearance: {
          title: 'SamChe Technology',
          greeting: demoWelcome.welcome_message,
        },
        demo_mode: samcheTechDemoConfig,
        quick_questions: demoWelcome.chips,
      }));
      return;
    }

    if (url.pathname === '/api/chat') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        chatRequests.push(parsed);

        let reply = 'I can help you explore our full product catalog.';
        if (parsed.message === 'Compare products') {
          reply = 'Here is a comparison of our top electronics:\n• SamChe Titan Smart Watch Pro (AED 399)\n• Ultra Power Bank (AED 149)';
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          reply,
          response: reply,
          text: reply,
          session: 'wch_sess_demo_mode_test',
        }));
      });
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      baseUrl = `http://127.0.0.1:${serverPort}`;
      resolve();
    });
  });

  try {
    browser = await BrowserCdp.launch({ headless: true });
  } catch (err) {
    console.log('Skipping browser tests: failed to launch browser:', err.message);
  }
});

test('6. Fresh WebChat opens with canonical e-commerce demo welcome and 5 clickable starter chips', async () => {
  if (!browser) return;

  await browser.setViewport({ width: 390, height: 844, isMobile: true });
  await browser.navigate(`${baseUrl}/task8-demo/`);
  await new Promise((r) => setTimeout(r, 800));

  // Open the chat widget
  await browser.evaluate(`(() => {
    const host = document.getElementById('samche-webchat-container');
    const launcher = host?.shadowRoot?.querySelector('.samche-launcher');
    if (launcher) launcher.click();
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  const chatState = await browser.evaluate(`(() => {
    const host = document.getElementById('samche-webchat-container');
    const root = host?.shadowRoot;
    const msgs = root?.querySelectorAll('.samche-msg-bot');
    const chips = root?.querySelectorAll('.samche-chip');
    const firstMsgText = msgs && msgs.length > 0 ? msgs[0].textContent : '';
    const chipLabels = Array.from(chips || []).map(c => c.textContent.trim());

    return {
      firstMsgText,
      chipLabels,
      chipCount: chips ? chips.length : 0,
    };
  })()`);

  // Verify initial welcome contains demo disclosure
  assert.ok(chatState.firstMsgText.includes('Welcome to the SamChe AI Demo'));
  assert.ok(chatState.firstMsgText.includes('SamChe Technology, an e-commerce demo powered by SamChe AI'));

  // Verify all 5 starter questions are present
  assert.equal(chatState.chipCount, 5);
  assert.deepEqual(chatState.chipLabels, [
    'Compare products',
    'Help me choose a product',
    'Where is my order?',
    'I have a problem with a product',
    'What is your return policy?',
  ]);
});

test('7. Clicking a starter chip enters normal message pipeline and receives AI response', async () => {
  if (!browser) return;
  chatRequests = [];

  // Click the "Compare products" chip
  await browser.evaluate(`(() => {
    const host = document.getElementById('samche-webchat-container');
    const root = host?.shadowRoot;
    const chips = root?.querySelectorAll('.samche-chip');
    const compareChip = Array.from(chips || []).find(c => c.textContent.trim() === 'Compare products');
    if (compareChip) compareChip.click();
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  // Verify message was sent to API
  assert.equal(chatRequests.length, 1);
  assert.equal(chatRequests[0].message, 'Compare products');

  // Verify assistant response rendered in UI
  const messagesState = await browser.evaluate(`(() => {
    const host = document.getElementById('samche-webchat-container');
    const root = host?.shadowRoot;
    const userMsgs = root?.querySelectorAll('.samche-msg-user');
    const botMsgs = root?.querySelectorAll('.samche-msg-bot');
    return {
      userMsgCount: userMsgs ? userMsgs.length : 0,
      botMsgCount: botMsgs ? botMsgs.length : 0,
      lastUserMsg: userMsgs && userMsgs.length > 0 ? userMsgs[userMsgs.length - 1].textContent : '',
      lastBotMsg: botMsgs && botMsgs.length > 0 ? botMsgs[botMsgs.length - 1].textContent : '',
    };
  })()`);

  assert.equal(messagesState.userMsgCount, 1);
  assert.equal(messagesState.lastUserMsg, 'Compare products');
  assert.ok(messagesState.lastBotMsg.includes('comparison of our top electronics'));
});

test('8. Clear Conversation resets and restores fresh demo welcome and 5 starter chips', async () => {
  if (!browser) return;

  // Click clear conversation button and confirm
  await browser.evaluate(`(() => {
    const host = document.getElementById('samche-webchat-container');
    const root = host?.shadowRoot;
    const clearBtn = root?.querySelector('.samche-header-clear-btn');
    if (clearBtn) clearBtn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 200));

  // Click confirm proceed button in dialog
  await browser.evaluate(`(() => {
    const host = document.getElementById('samche-webchat-container');
    const root = host?.shadowRoot;
    const proceedBtn = root?.querySelector('.samche-confirm-proceed');
    if (proceedBtn) proceedBtn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  const resetState = await browser.evaluate(`(() => {
    const host = document.getElementById('samche-webchat-container');
    const root = host?.shadowRoot;
    const botMsgs = root?.querySelectorAll('.samche-msg-bot');
    const userMsgs = root?.querySelectorAll('.samche-msg-user');
    const chips = root?.querySelectorAll('.samche-chip');
    const firstMsgText = botMsgs && botMsgs.length > 0 ? botMsgs[0].textContent : '';
    const chipLabels = Array.from(chips || []).map(c => c.textContent.trim());

    return {
      botMsgCount: botMsgs ? botMsgs.length : 0,
      userMsgCount: userMsgs ? userMsgs.length : 0,
      firstMsgText,
      chipLabels,
      chipCount: chips ? chips.length : 0,
    };
  })()`);

  assert.equal(resetState.userMsgCount, 0, 'User messages must be cleared');
  assert.equal(resetState.botMsgCount, 1, 'Exactly one initial greeting must remain');
  assert.ok(resetState.firstMsgText.includes('Welcome to the SamChe AI Demo'));
  assert.equal(resetState.chipCount, 5, '5 starter chips must be restored after clear conversation');
  assert.deepEqual(resetState.chipLabels, [
    'Compare products',
    'Help me choose a product',
    'Where is my order?',
    'I have a problem with a product',
    'What is your return policy?',
  ]);
});

test('CLEANUP: Teardown Server & Headless Browser', async () => {
  if (browser) {
    try { await browser.close(); } catch (e) {}
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});


