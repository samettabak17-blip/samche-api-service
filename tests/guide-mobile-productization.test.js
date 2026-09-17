import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserCdp, findBrowserBinary } from './helpers/browser-cdp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const htmlFixturePath = path.join(rootDir, 'public-guide', 'index.html');
const guideCssPath = path.join(rootDir, 'public-guide', 'guide.css');
const guideJsPath = path.join(rootDir, 'public-guide', 'guide.js');

let server;
let serverPort;
let baseUrl;
let browser;

const standardExperience = {
  brand_name: 'Blue Dune Desert Safari & Events',
  assistant_display_name: 'Blue Dune AI Concierge',
  assistant_status_label: 'Online',
  welcome_title: 'Welcome to Blue Dune AI Experience',
  welcome_message: 'Explore our safari packages, calculate custom event costs, or talk directly with our AI concierge.',
  modules: { guide: true, calculator: true, chat: true },
  theme: {
    primary_color: '#B45309',
    accent_color: '#F59E0B',
    background_color: '#0F172A',
    foreground_color: '#F8FAFC',
    surface_color: '#1E293B',
    border_color: '#334155',
    button_foreground: '#FFFFFF',
    corner_radius: 'MEDIUM',
  },
  roadmap: {
    title: 'Safari & Experience Roadmap',
    description: 'Select your preferred safari plan or ask for custom scheduling.',
    steps: [
      {
        id: 'step-1',
        title: 'Group Size & Logistics',
        fields: [
          { id: 'guest_count', label: 'Guest Count', input_type: 'NUMBER', min: 1, max: 200, required: true },
          { id: 'safari_type', label: 'Safari Package', input_type: 'SELECT', options: [{ label: 'VIP Evening Dune Safari', value: 'vip_evening' }, { label: 'Overnight Bedouin Camp', value: 'overnight' }] },
        ],
      },
    ],
  },
  interactive_tool: {
    title: 'Event & Safari Planning Calculator',
    description: 'Estimate your luxury desert experience planning budget instantly.',
    fields: [
      { id: 'guests', label: 'Number of Guests', input_type: 'NUMBER', min: 1, max: 500, required: true },
      { id: 'package_type', label: 'Experience Level', input_type: 'SELECT', options: [{ label: 'Standard Desert Safari', value: 'std' }, { label: 'Private VIP Luxury Camp', value: 'vip' }] },
      { id: 'bbq_dinner', label: 'Gourmet BBQ Dinner Included', input_type: 'BOOLEAN' },
      { id: 'quad_bike', label: 'Quad Biking & Dune Buggy', input_type: 'BOOLEAN' },
    ],
  },
  assistant_copy: {
    navigation_label: 'Assistant',
    intro: 'Ask about VIP private dining, group transport from Dubai hotels, or custom itineraries.',
  },
};

const arabicExperience = {
  ...standardExperience,
  language: 'ar',
  locale: 'ar',
  brand_name: 'بلو ديون لرحلات السفاري والفعاليات الفاخرة',
  assistant_display_name: 'مساعد بلو ديون الذكي',
  assistant_status_label: 'متصل الآن',
  welcome_title: 'مرحباً بكم في تجربة بلو ديون الذكية',
  welcome_message: 'استكشف باقات السفاري الصحراوية وخطط لفعاليتك القادمة.',
};

let currentExperience = standardExperience;

test('SETUP: Initialize Mock Server & Headless Browser for Guide Mobile Acceptance', async () => {
  const binary = findBrowserBinary();
  if (!fs.existsSync(binary)) {
    console.log('Skipping real browser tests: no browser binary found at', binary);
    return;
  }

  const htmlContent = fs.readFileSync(htmlFixturePath, 'utf8');
  const cssContent = fs.readFileSync(guideCssPath, 'utf8');
  const jsContent = fs.readFileSync(guideJsPath, 'utf8');

  server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/' || url.pathname === '/guide' || url.pathname === '/bluedune' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlContent);
      return;
    }

    if (url.pathname === '/guide/guide.css' || url.pathname === '/bluedune/guide/guide.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(cssContent);
      return;
    }

    if (url.pathname === '/guide/guide.js' || url.pathname === '/bluedune/guide/guide.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(jsContent);
      return;
    }

    if (url.pathname === '/guide/bootstrap' || url.pathname === '/bluedune/guide/bootstrap') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        conversation_session: 'guide_sess_test_123',
        experience: currentExperience,
      }));
      return;
    }

    if (url.pathname === '/guide/session-context' || url.pathname === '/bluedune/guide/session-context') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        context_saved: true,
        conversation_session: 'guide_sess_test_123',
      }));
      return;
    }

    if (url.pathname === '/chat' || url.pathname === '/bluedune/chat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        conversation_session: 'guide_sess_test_123',
        guide_events: [
          { type: 'SECTION', title: 'Blue Dune VIP Itinerary' },
          { type: 'TEXT_DELTA', text: 'We offer private 4x4 pickup directly from any hotel in Dubai, followed by sunset dune bashing and a 5-star desert banquet with live entertainment.' },
          { type: 'LIST', ordered: false, items: ['Private luxury 4x4 transport', 'Sunset photography & falconry show', 'Gourmet buffet with live BBQ stations'] },
          { type: 'TEXT_DELTA', text: 'For details, see https://bluedune.staging.samchecompany.com/packages/vip-safari-ultra-long-url-for-overflow-testing-verification' },
        ],
      }));
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

const mobileViewports = [
  { name: 'iPhone SE 1st Gen', width: 320, height: 568 },
  { name: 'Android Small (Galaxy S)', width: 360, height: 640 },
  { name: 'iPhone SE 2nd/3rd / iPhone 8', width: 375, height: 667 },
  { name: 'iPhone X / 11 Pro / Mini', width: 375, height: 812 },
  { name: 'iPhone 12 / 13 / 14', width: 390, height: 844 },
  { name: 'iPhone 14 Pro / 15 / 16', width: 393, height: 852 },
  { name: 'iPhone Plus / Max', width: 414, height: 896 },
  { name: 'iPhone Pro Max (14/15/16)', width: 430, height: 932 },
  { name: 'iPhone Landscape (667x375)', width: 667, height: 375 },
  { name: 'iPhone Landscape (844x390)', width: 844, height: 390 },
  { name: 'iPad / Tablet (768x1024)', width: 768, height: 1024 },
  { name: 'Desktop (1280x800)', width: 1280, height: 800 },
];

for (const vp of mobileViewports) {
  test(`MOBILE VIEWPORT (${vp.name} - ${vp.width}x${vp.height}): Zero Horizontal Overflow & Bounded UI`, async () => {
    if (!browser) return;
    currentExperience = standardExperience;

    await browser.setViewport({ width: vp.width, height: vp.height, isMobile: true });
    await browser.navigate(`${baseUrl}/bluedune`);
    await new Promise((r) => setTimeout(r, 500));

    const metrics = await browser.evaluate(`(() => {
      const doc = document.documentElement;
      const body = document.body;
      const shell = document.querySelector('.guide-shell');
      const canvas = document.querySelector('.guide-canvas');
      const header = document.querySelector('.guide-header');
      const hero = document.querySelector('.guide-hero');
      const nav = document.querySelector('.guide-navigation');
      const brand = document.querySelector('.guide-brand-name');

      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
        shellWidth: shell ? shell.getBoundingClientRect().width : 0,
        canvasWidth: canvas ? canvas.getBoundingClientRect().width : 0,
        headerWidth: header ? header.getBoundingClientRect().width : 0,
        heroWidth: hero ? hero.getBoundingClientRect().width : 0,
        navWidth: nav ? nav.getBoundingClientRect().width : 0,
        brandWidth: brand ? brand.getBoundingClientRect().width : 0,
        viewportWidth: window.innerWidth,
      };
    })()`);

    assert.ok(metrics.docScrollWidth <= metrics.docClientWidth + 1, `doc scrollWidth (${metrics.docScrollWidth}) exceeds clientWidth (${metrics.docClientWidth}) at ${vp.name}`);
    assert.ok(metrics.bodyScrollWidth <= metrics.bodyClientWidth + 1, `body scrollWidth (${metrics.bodyScrollWidth}) exceeds clientWidth (${metrics.bodyClientWidth}) at ${vp.name}`);
    assert.ok(metrics.canvasWidth <= vp.width + 1, `canvasWidth (${metrics.canvasWidth}) exceeds viewport (${vp.width}) at ${vp.name}`);
    assert.ok(metrics.headerWidth <= vp.width + 1, `headerWidth (${metrics.headerWidth}) exceeds viewport (${vp.width}) at ${vp.name}`);
  });
}
test('ASSISTANT MODULE & LONG CONTENT: Long URLs, Markdown Lists & Messages Do NOT Overflow', async () => {
  if (!browser) return;
  currentExperience = standardExperience;

  await browser.setViewport({ width: 375, height: 812, isMobile: true });
  await browser.navigate(`${baseUrl}/bluedune`);
  await new Promise((r) => setTimeout(r, 500));

  // Navigate to Assistant module
  await browser.evaluate(`(() => {
    const btn = document.querySelector('.guide-navigation__item[data-guide-module="AI_ASSISTANT"]');
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  // Type a question with long words and send
  await browser.evaluate(`(() => {
    const textarea = document.querySelector('.guide-chat-form textarea');
    if (textarea) {
      textarea.value = 'Can you show me the VIP desert itinerary with all package details?';
      const form = document.querySelector('.guide-chat-form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  })()`);

  // Wait for message events to render
  await new Promise((r) => setTimeout(r, 1500));

  const contentMetrics = await browser.evaluate(`(() => {
    const doc = document.documentElement;
    const body = document.body;
    const chat = document.querySelector('.guide-chat');
    const messages = document.querySelectorAll('.guide-message');

    let maxMsgWidth = 0;
    messages.forEach(m => {
      maxMsgWidth = Math.max(maxMsgWidth, m.getBoundingClientRect().width);
    });

    return {
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      chatWidth: chat ? chat.getBoundingClientRect().width : 0,
      maxMsgWidth,
      msgCount: messages.length,
      viewportWidth: window.innerWidth,
    };
  })()`);

  assert.ok(contentMetrics.docScrollWidth <= contentMetrics.docClientWidth + 1, 'Long content caused document horizontal overflow');
  assert.ok(contentMetrics.bodyScrollWidth <= contentMetrics.bodyClientWidth + 1, 'Long content caused body horizontal overflow');
  assert.ok(contentMetrics.maxMsgWidth <= 375, `Message bubble (${contentMetrics.maxMsgWidth}) exceeds viewport width`);
});

test('ARABIC RTL MOBILE EXPERIENCE: Complete RTL Direction, Alignment & Zero Overflow', async () => {
  if (!browser) return;
  currentExperience = arabicExperience;

  await browser.setViewport({ width: 390, height: 844, isMobile: true });
  await browser.navigate(`${baseUrl}/bluedune`);
  await new Promise((r) => setTimeout(r, 500));

  const rtlMetrics = await browser.evaluate(`(() => {
    const doc = document.documentElement;
    const body = document.body;
    const header = document.querySelector('.guide-header');
    const hero = document.querySelector('.guide-hero');
    const brand = document.querySelector('.guide-brand-name');
    const dir = doc.getAttribute('dir') || body.getAttribute('dir');
    const brandAlign = window.getComputedStyle(brand).textAlign;

    return {
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      dir,
      brandAlign,
      headerWidth: header ? header.getBoundingClientRect().width : 0,
      heroWidth: hero ? hero.getBoundingClientRect().width : 0,
      viewportWidth: window.innerWidth,
    };
  })()`);

  assert.equal(rtlMetrics.dir, 'rtl', 'Arabic experience must set dir="rtl" on documentElement');
  assert.ok(rtlMetrics.docScrollWidth <= rtlMetrics.docClientWidth + 1, 'Arabic RTL caused horizontal overflow');
  assert.ok(rtlMetrics.headerWidth <= 390 + 1, 'Arabic header exceeds viewport width');
});

test('VIRTUAL KEYBOARD SIMULATION: Reduced Viewport Height Preserves Composer Access', async () => {
  if (!browser) return;
  currentExperience = standardExperience;

  await browser.setViewport({ width: 390, height: 450, isMobile: true });
  await browser.navigate(`${baseUrl}/bluedune`);
  await new Promise((r) => setTimeout(r, 500));

  // Navigate to Assistant module
  await browser.evaluate(`(() => {
    const btn = document.querySelector('.guide-navigation__item[data-guide-module="AI_ASSISTANT"]');
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  const keyboardMetrics = await browser.evaluate(`(() => {
    const doc = document.documentElement;
    const form = document.querySelector('.guide-chat-form');
    const textarea = document.querySelector('.guide-chat-form textarea');
    const sendBtn = document.querySelector('.guide-chat-form__send');

    const formRect = form ? form.getBoundingClientRect() : null;
    const sendRect = sendBtn ? sendBtn.getBoundingClientRect() : null;

    return {
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      formTop: formRect ? formRect.top : 0,
      formBottom: formRect ? formRect.bottom : 0,
      sendBottom: sendRect ? sendRect.bottom : 0,
      windowHeight: window.innerHeight,
      isSendVisible: sendRect ? (sendRect.bottom <= window.innerHeight && sendRect.top >= 0) : false,
    };
  })()`);

  assert.ok(keyboardMetrics.docScrollWidth <= keyboardMetrics.docClientWidth + 1, 'Reduced height caused horizontal overflow');
  assert.ok(keyboardMetrics.isSendVisible, 'Send button must remain visible when virtual keyboard opens (reduced height)');
});

test('CLEANUP: Teardown Server & Headless Browser', async () => {
  if (browser) {
    try { await browser.close(); } catch (e) {}
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});


