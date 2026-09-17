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

test('ASSISTANT KEYBOARD OPEN: Internal Chat Regions Remain Usable Without Outer Document Locking', async () => {
  if (!browser) return;
  currentExperience = standardExperience;

  await browser.setViewport({ width: 390, height: 844, isMobile: true });
  await browser.navigate(`${baseUrl}/bluedune`);
  await new Promise((r) => setTimeout(r, 500));

  // Navigate to Assistant module
  await browser.evaluate(`(() => {
    const btn = document.querySelector('.guide-navigation__item[data-guide-module="AI_ASSISTANT"]');
    if (btn) btn.click();
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  // Simulate a keyboard-open visual viewport without prescribing implementation pixels.
  await browser.evaluate(`(() => {
    const textarea = document.querySelector('.guide-chat-form textarea');
    if (textarea) textarea.focus();
  })()`);
  await browser.setViewport({ width: 390, height: 494, isMobile: true });
  await new Promise((r) => setTimeout(r, 400));

  const keyboardOpenMetrics = await browser.evaluate(`(() => {
    const shell = document.querySelector('.guide-shell');
    const header = document.querySelector('.guide-header');
    const form = document.querySelector('.guide-chat-form');
    const nav = document.querySelector('.guide-navigation');
    const messages = document.querySelector('.guide-chat-messages');
    return {
      shellTop: shell.getBoundingClientRect().top,
      shellHeight: shell.getBoundingClientRect().height,
      headerTop: header.getBoundingClientRect().top,
      headerBottom: header.getBoundingClientRect().bottom,
      formTop: form.getBoundingClientRect().top,
      formBottom: form.getBoundingClientRect().bottom,
      navBottom: nav.getBoundingClientRect().bottom,
      navTop: nav.getBoundingClientRect().top,
      messagesTop: messages.getBoundingClientRect().top,
      messagesBottom: messages.getBoundingClientRect().bottom,
      messagesScrollHeight: messages ? messages.scrollHeight : 0,
      messagesClientHeight: messages ? messages.clientHeight : 0,
      documentOverflow: getComputedStyle(document.documentElement).overflowY,
      bodyOverflow: getComputedStyle(document.body).overflowY,
      shellPosition: getComputedStyle(shell).position,
      messagesHeight: messages ? messages.getBoundingClientRect().height : 0,
      scrollY: window.scrollY,
      windowHeight: window.innerHeight,
    };
  })()`);

  assert.equal(keyboardOpenMetrics.shellPosition, 'static', 'Assistant must not move the outer document with a fixed shell');
  assert.equal(keyboardOpenMetrics.scrollY, 0, 'Keyboard handling must not force document scrolling');
  assert.ok(keyboardOpenMetrics.headerTop >= 0 && keyboardOpenMetrics.headerBottom <= keyboardOpenMetrics.windowHeight, 'Header must remain within the visible region');
  assert.ok(keyboardOpenMetrics.messagesHeight > 0 && keyboardOpenMetrics.messagesBottom > keyboardOpenMetrics.messagesTop, 'Message viewport must retain positive usable height');
  assert.ok(keyboardOpenMetrics.formTop >= keyboardOpenMetrics.messagesBottom - 1, 'Composer must follow the message viewport');
  assert.ok(keyboardOpenMetrics.formBottom <= keyboardOpenMetrics.navTop + 1, 'Composer must not overlap navigation');
  assert.ok(keyboardOpenMetrics.navBottom <= keyboardOpenMetrics.windowHeight + 1, 'Navigation must remain visible');
  assert.ok(keyboardOpenMetrics.messagesScrollHeight >= keyboardOpenMetrics.messagesClientHeight, 'Message area must remain independently scrollable');
  assert.notEqual(keyboardOpenMetrics.documentOverflow, 'hidden', 'Assistant must not lock document overflow globally');
  assert.notEqual(keyboardOpenMetrics.bodyOverflow, 'hidden', 'Assistant must not lock body overflow globally');
});

test('KEYBOARD CLOSE: Assistant Restores Stable Full-height Layout', async () => {
  if (!browser) return;

  // Blur textarea and restore viewport (keyboard closes: 494 -> 844)
  await browser.evaluate(`(() => {
    const textarea = document.querySelector('.guide-chat-form textarea');
    if (textarea) textarea.blur();
  })()`);
  await browser.setViewport({ width: 390, height: 844, isMobile: true });
  await new Promise((r) => setTimeout(r, 400));

  const restoredMetrics = await browser.evaluate(`(() => {
    const shell = document.querySelector('.guide-shell');
    const header = document.querySelector('.guide-header');
    const nav = document.querySelector('.guide-navigation');
    return {
      shellTop: shell.getBoundingClientRect().top,
      shellHeight: shell.getBoundingClientRect().height,
      headerTop: header.getBoundingClientRect().top,
      navBottom: nav.getBoundingClientRect().bottom,
      windowHeight: window.innerHeight,
      scrollY: window.scrollY,
    };
  })()`);

  assert.ok(restoredMetrics.headerTop >= 0, 'Header top must restore inside the viewport');
  assert.ok(restoredMetrics.shellTop >= 0, 'Shell top must restore inside the viewport');
  assert.equal(restoredMetrics.scrollY, 0, 'Window scrollY must be 0 after keyboard close');
  assert.ok(restoredMetrics.shellHeight >= restoredMetrics.headerTop, 'Shell must restore a usable height');
  assert.ok(restoredMetrics.navBottom <= restoredMetrics.windowHeight + 1, `Navigation must restore inside the viewport: ${JSON.stringify(restoredMetrics)}`);
});

test('REPEATED FOCUS/BLUR CYCLES: Zero Drift or Accumulated Viewport Offset', async () => {
  if (!browser) return;

  for (let cycle = 1; cycle <= 5; cycle++) {
    // Open keyboard
    await browser.evaluate(`(() => {
      const textarea = document.querySelector('.guide-chat-form textarea');
      if (textarea) textarea.focus();
    })()`);
    await browser.setViewport({ width: 390, height: 494, isMobile: true });
    await new Promise((r) => setTimeout(r, 80));

    // Close keyboard
    await browser.evaluate(`(() => {
      const textarea = document.querySelector('.guide-chat-form textarea');
      if (textarea) textarea.blur();
    })()`);
    await browser.setViewport({ width: 390, height: 844, isMobile: true });
    await new Promise((r) => setTimeout(r, 80));
  }

  const cycleMetrics = await browser.evaluate(`(() => {
    const shell = document.querySelector('.guide-shell');
    const header = document.querySelector('.guide-header');
    const nav = document.querySelector('.guide-navigation');
    return {
      shellTop: shell.getBoundingClientRect().top,
      shellHeight: shell.getBoundingClientRect().height,
      headerTop: header.getBoundingClientRect().top,
      navBottom: nav.getBoundingClientRect().bottom,
      windowHeight: window.innerHeight,
      scrollY: window.scrollY,
    };
  })()`);

  assert.ok(cycleMetrics.headerTop >= 0, 'Header must not drift above the viewport after 5 cycles');
  assert.ok(cycleMetrics.shellTop >= 0, 'Shell must not drift above the viewport after 5 cycles');
  assert.equal(cycleMetrics.scrollY, 0, 'Window scrollY must be exactly 0 after 5 focus/blur cycles');
  assert.ok(cycleMetrics.shellHeight > 0 && cycleMetrics.navBottom <= cycleMetrics.windowHeight + 1, `No unusable height drift after 5 cycles: ${JSON.stringify(cycleMetrics)}`);
});

test('SURFACE SWITCHING: Assistant Keyboard State Does Not Infect Planning or Roadmap Scrolling', async () => {
  if (!browser) return;

  await browser.evaluate(`document.querySelector('.guide-chat-form textarea')?.focus()`);
  await browser.setViewport({ width: 390, height: 494, isMobile: true });
  await new Promise((r) => setTimeout(r, 100));
  const metrics = await browser.evaluate(`(() => {
    const result = {};
    for (const module of ['INTERACTIVE_TOOL', 'ROADMAP', 'AI_ASSISTANT']) {
      document.querySelector('[data-guide-module="' + module + '"]')?.click();
      const shell = document.querySelector('.guide-shell');
      const canvas = document.querySelector('.guide-canvas');
      result[module] = {
        active: document.querySelector('.guide-module-layer:not([hidden])')?.className || '',
        position: getComputedStyle(shell).position,
        canvasOverflow: getComputedStyle(canvas).overflow,
        bodyOverflow: getComputedStyle(document.body).overflowY,
      };
    }
    return result;
  })()`);
  assert.equal(metrics.INTERACTIVE_TOOL.position, 'static', 'Planning must use normal document flow');
  assert.equal(metrics.ROADMAP.position, 'static', 'Roadmap must use normal document flow');
  assert.notEqual(metrics.INTERACTIVE_TOOL.bodyOverflow, 'hidden', 'Planning must retain document scrolling');
  assert.notEqual(metrics.ROADMAP.bodyOverflow, 'hidden', 'Roadmap must retain document scrolling');
  assert.match(metrics.AI_ASSISTANT.active, /assistant/, 'Assistant must restore its own active layer');
});

test('PLANNING AND ROADMAP FOCUS: Native Document Flow Keeps Focused Controls Reachable', async () => {
  if (!browser) return;

  const metrics = await browser.evaluate(`(() => {
    const result = {};
    const inspect = (module, prepare) => {
      document.querySelector('[data-guide-module="' + module + '"]')?.click();
      prepare();
      const control = document.querySelector(module === 'INTERACTIVE_TOOL' ? '.guide-tool-form input, .guide-tool-form select' : '.guide-structured-details input, .guide-structured-details select');
      control?.focus();
      const rect = control?.getBoundingClientRect();
      const nav = document.querySelector('.guide-navigation').getBoundingClientRect();
      const shell = document.querySelector('.guide-shell');
      result[module] = {
        controlTop: rect?.top ?? -1,
        controlBottom: rect?.bottom ?? -1,
        viewportHeight: window.innerHeight,
        navigationTop: nav.top,
        shellPosition: getComputedStyle(shell).position,
        documentScrollHeight: document.documentElement.scrollHeight,
        documentClientHeight: document.documentElement.clientHeight,
      };
    };
    inspect('INTERACTIVE_TOOL', () => {});
    inspect('ROADMAP', () => document.querySelector('.guide-structured-details summary')?.click());
    return result;
  })()`);

  for (const module of ['INTERACTIVE_TOOL', 'ROADMAP']) {
    const value = metrics[module];
    assert.equal(value.shellPosition, 'static', `${module} must stay in normal document flow`);
    assert.ok(value.controlTop >= 0 && value.controlBottom <= value.viewportHeight, `${module} focused control must remain visible`);
    assert.ok(value.navigationTop >= value.controlBottom, `${module} navigation must not cover the focused control`);
    assert.ok(value.documentScrollHeight >= value.documentClientHeight, `${module} document must remain scrollable or fit naturally`);
  }
});

test('CLEANUP: Teardown Server & Headless Browser', async () => {
  if (browser) {
    const processClosed = browser.proc?.exitCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => browser.proc.once('close', resolve));
    try { await browser.send('Browser.close'); } catch (e) { try { await browser.close(); } catch (closeError) {} }
    await processClosed;
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});


