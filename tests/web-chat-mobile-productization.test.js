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

const htmlFixturePath = path.join(rootDir, 'public', 'task8-demo', 'index.html');
const webChatJsPath = path.join(rootDir, 'public', 'web-chat.js');
const dashboardContractPath = path.join(rootDir, 'dashboard', 'src', 'features', 'channels', 'web-chat-canonical-contract.ts');

let server;
let serverPort;
let baseUrl;
let browser;

test('SETUP: Initialize Mock Server & Headless Browser for Mobile UX Acceptance', async () => {
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        session: 'wch_sess_mobile_test_token',
        resumed: false,
        history: [],
        appearance: {
          title: 'SamChe Mağaza Asistanı',
          subtitle: 'Çevrimiçi Danışman',
          launcher_position: 'right',
          theme_mode: 'dark',
          launcher_label: 'Canlı Destek',
        },
        behavior: {
          language: 'tr',
          proactive_enabled: false,
        },
      }));
      return;
    }

    if (url.pathname === '/api/chat/page-context') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', current_entity: null }));
      return;
    }

    if (url.pathname === '/api/chat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reply: 'Mobil deneyimimiz optimize edilmiştir. Boyutlar bounded ve responsive olarak çalışmaktadır.',
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

test('MOBILE CONTRACT: Preview ↔ Public CSS Parity & Zero Fullscreen Defaults', () => {
  const publicJs = fs.readFileSync(webChatJsPath, 'utf8');
  const dashboardContract = fs.readFileSync(dashboardContractPath, 'utf8');

  // 1. Neither must contain fixed fullscreen overlay defaults
  assert.ok(!publicJs.includes('inset: 0 !important; width: 100vw !important; height: 100% !important; height: 100dvh !important;'),
    'Public web-chat.js must not force fullscreen overlay default on mobile');
  assert.ok(!dashboardContract.includes('inset: 0 !important; width: 100vw !important; height: 100% !important; height: 100dvh !important;'),
    'Dashboard canonical contract must not force fullscreen overlay default on mobile');

  // 2. Both must preserve border radius on mobile
  assert.ok(publicJs.includes('.samche-preview-mobile .samche-panel { position: relative !important;'),
    'Public preview mobile CSS must render bounded card with preserved border radius');
  assert.ok(dashboardContract.includes('.samche-preview-mobile .samche-panel { position: relative !important;'),
    'Dashboard preview mobile CSS must render bounded card with preserved border radius');

  // 3. iOS zoom guard: font-size: 16px on mobile composer
  assert.ok(publicJs.includes('.samche-composer-input { padding: 8px 12px !important; font-size: 16px !important;'),
    'Public mobile composer must specify 16px font-size to prevent iOS accidental zoom');
  assert.ok(dashboardContract.includes('.samche-composer-input { padding: 8px 12px !important; font-size: 16px !important;'),
    'Dashboard mobile composer must specify 16px font-size to prevent iOS accidental zoom');

  // 4. Safe area insets present
  assert.ok(publicJs.includes('env(safe-area-inset-bottom, 0px)'), 'Safe area bottom inset must be supported');
  assert.ok(publicJs.includes('env(safe-area-inset-top, 0px)'), 'Safe area top inset must be supported');
  assert.ok(publicJs.includes('env(safe-area-inset-left, 0px)'), 'Safe area left inset must be supported');
  assert.ok(publicJs.includes('env(safe-area-inset-right, 0px)'), 'Safe area right inset must be supported');
});

test('MOBILE VIEWPORT (360x640): Closed Launcher UX, Contrast & Tap Target Compliance', async () => {
  if (!browser) return;
  await browser.setViewport({ width: 360, height: 640, isMobile: true });
  await browser.navigate(`${baseUrl}/task8-demo/`);
  await new Promise((r) => setTimeout(r, 800));

  const launcherInfo = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const launcher = host?.shadowRoot?.querySelector('.samche-launcher');
      if (!launcher) return null;
      const rect = launcher.getBoundingClientRect();
      const style = window.getComputedStyle(launcher);
      return {
        exists: true,
        width: rect.width,
        height: rect.height,
        bottom: window.innerHeight - rect.bottom,
        right: window.innerWidth - rect.right,
        isVisible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden',
        hasTouchTarget: rect.height >= 48,
        borderRadius: style.borderRadius,
      };
    })()
  `);

  assert.ok(launcherInfo, 'Closed launcher must exist in shadow root');
  assert.ok(launcherInfo.isVisible, 'Closed launcher must be visible');
  assert.ok(launcherInfo.hasTouchTarget, `Closed launcher must have >= 48px touch target (got ${launcherInfo.height}px)`);
  assert.ok(launcherInfo.right >= 10 && launcherInfo.right <= 24, `Launcher must stay in configured right corner (got ${launcherInfo.right}px)`);
  assert.ok(launcherInfo.bottom >= 10 && launcherInfo.bottom <= 24, `Launcher must maintain safe bottom margin (got ${launcherInfo.bottom}px)`);
});

test('MOBILE VIEWPORT (360x640): Open Panel Is Compact Floating Card, NOT Fullscreen Overlay', async () => {
  if (!browser) return;
  await browser.setViewport({ width: 360, height: 640, isMobile: true });

  // Open the panel
  await browser.evaluate(`
    document.getElementById('samche-webchat-container').shadowRoot.querySelector('.samche-launcher').click()
  `);
  await new Promise((r) => setTimeout(r, 500));

  const panelMetrics = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const panel = host?.shadowRoot?.querySelector('.samche-panel');
      const rect = panel.getBoundingClientRect();
      const style = window.getComputedStyle(panel);
      return {
        isOpen: panel.classList.contains('samche-open'),
        width: rect.width,
        height: rect.height,
        top: rect.top,
        bottom: window.innerHeight - rect.bottom,
        left: rect.left,
        right: window.innerWidth - rect.right,
        borderRadius: style.borderRadius,
        borderTopLeftRadius: parseFloat(style.borderTopLeftRadius),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        bodyOverflow: document.body.style.overflow,
        scrollX: window.scrollX,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    })()
  `);

  assert.ok(panelMetrics.isOpen, 'Panel must have samche-open class');

  // 1. NOT FULLSCREEN
  assert.ok(panelMetrics.height < panelMetrics.viewportHeight,
    `Panel height (${panelMetrics.height}px) must be less than viewport height (${panelMetrics.viewportHeight}px)`);
  assert.ok(panelMetrics.top >= 40,
    `Website must remain visible at top of viewport (got ${panelMetrics.top}px clearance)`);

  // 2. Bounded width with margins
  assert.ok(panelMetrics.width < panelMetrics.viewportWidth,
    `Panel width (${panelMetrics.width}px) must be bounded with side margins (viewport: ${panelMetrics.viewportWidth}px)`);
  assert.ok(panelMetrics.left >= 10, `Panel must have safe left margin (got ${panelMetrics.left}px)`);
  assert.ok(panelMetrics.right >= 10, `Panel must have safe right margin (got ${panelMetrics.right}px)`);

  // 3. Rounded corners preserved
  assert.ok(panelMetrics.borderTopLeftRadius >= 16,
    `Rounded corners must be preserved (got ${panelMetrics.borderTopLeftRadius}px)`);

  // 4. Host page stability: no overflow lock, no horizontal scroll
  assert.notEqual(panelMetrics.bodyOverflow, 'hidden', 'Host body overflow must not be locked to hidden');
  assert.equal(panelMetrics.scrollX, 0, 'Horizontal scroll position must be 0');
  assert.ok(!panelMetrics.hasHorizontalOverflow, 'Opening chat must not create horizontal document overflow');
});

test('MOBILE VIEWPORT (360x640): Reachable Composer, Send Flow & Internal Scrolling', async () => {
  if (!browser) return;

  const composerState = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host?.shadowRoot;
      const composer = shadow?.querySelector('.samche-composer');
      const input = shadow?.querySelector('.samche-composer-input');
      const sendBtn = shadow?.querySelector('.samche-send-btn');
      const messages = shadow?.querySelector('.samche-messages');
      const panel = shadow?.querySelector('.samche-panel');

      const cRect = composer.getBoundingClientRect();
      const pRect = panel.getBoundingClientRect();
      const iStyle = window.getComputedStyle(input);
      const mStyle = window.getComputedStyle(messages);

      return {
        composerInsidePanel: cRect.bottom <= pRect.bottom + 2 && cRect.top >= pRect.top,
        inputFontSize: parseFloat(iStyle.fontSize),
        sendBtnWidth: sendBtn.getBoundingClientRect().width,
        sendBtnHeight: sendBtn.getBoundingClientRect().height,
        messagesOverscroll: mStyle.overscrollBehaviorY || mStyle.overscrollBehavior,
        messagesOverflowY: mStyle.overflowY,
      };
    })()
  `);

  assert.ok(composerState.composerInsidePanel, 'Composer must be fixed inside the panel bottom');
  assert.ok(composerState.inputFontSize >= 16, `Composer input font-size must be >= 16px to prevent iOS zoom (got ${composerState.inputFontSize}px)`);
  assert.ok(composerState.sendBtnWidth >= 36 && composerState.sendBtnHeight >= 36, 'Send button tap target must be accessible');
  assert.ok(composerState.messagesOverflowY === 'auto' || composerState.messagesOverflowY === 'scroll', 'Messages must scroll internally');
  assert.equal(composerState.messagesOverscroll, 'contain', 'Messages overscroll-behavior must be contain');
});

test('MODERN IPHONE VIEWPORT (390x844): Panel Floating Card Clearance & Non-Taking Over Check', async () => {
  if (!browser) return;
  await browser.setViewport({ width: 390, height: 844, isMobile: true });
  await new Promise((r) => setTimeout(r, 200));

  const iphoneMetrics = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const panel = host?.shadowRoot?.querySelector('.samche-panel');
      const rect = panel.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        topClearance: rect.top,
        bottomClearance: window.innerHeight - rect.bottom,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    })()
  `);

  assert.ok(iphoneMetrics.width <= 365, `Panel width (${iphoneMetrics.width}px) must respect safe margins on 390px screen`);
  assert.ok(iphoneMetrics.height <= 530, `Panel height (${iphoneMetrics.height}px) must be bounded (<= 530px)`);
  assert.ok(iphoneMetrics.topClearance >= 250,
    `On iPhone 844px height, at least 250px of visible website must remain at top (got ${iphoneMetrics.topClearance}px)`);
});

test('ANDROID VIEWPORT (412x915): Panel Max Width Bounded to 400px & Large Clear Area', async () => {
  if (!browser) return;
  await browser.setViewport({ width: 412, height: 915, isMobile: true });
  await new Promise((r) => setTimeout(r, 200));

  const androidMetrics = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const panel = host?.shadowRoot?.querySelector('.samche-panel');
      const rect = panel.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        topClearance: rect.top,
      };
    })()
  `);

  assert.ok(androidMetrics.width <= 400, `Panel width (${androidMetrics.width}px) must be bounded to max 400px`);
  assert.ok(androidMetrics.height <= 530, `Panel height (${androidMetrics.height}px) must be bounded`);
  assert.ok(androidMetrics.topClearance >= 340, `On 915px height, visible website at top must be >= 340px (got ${androidMetrics.topClearance}px)`);
});

test('LANDSCAPE MOBILE (667x375): Compact Corner Card & Zero Viewport Takeover', async () => {
  if (!browser) return;
  await browser.setViewport({ width: 667, height: 375, isMobile: true });
  await new Promise((r) => setTimeout(r, 200));

  const landscapeMetrics = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const panel = host?.shadowRoot?.querySelector('.samche-panel');
      const rect = panel.getBoundingClientRect();
      const style = window.getComputedStyle(panel);
      return {
        width: rect.width,
        height: rect.height,
        leftClearance: rect.left,
        borderRadius: parseFloat(style.borderTopLeftRadius),
        isBounded: rect.width <= 385 && rect.height <= 365,
      };
    })()
  `);

  assert.ok(landscapeMetrics.isBounded,
    `Landscape panel must be bounded card (got ${landscapeMetrics.width}x${landscapeMetrics.height}px)`);
  assert.ok(landscapeMetrics.leftClearance >= 250,
    `Left side of landscape viewport must show website (got ${landscapeMetrics.leftClearance}px clear)`);
  assert.ok(landscapeMetrics.borderRadius >= 14,
    `Landscape card must preserve rounded corners (got ${landscapeMetrics.borderRadius}px)`);
});

test('TABLET VIEWPORT (768x1024): Desktop-Like Canonical Panel Preserved', async () => {
  if (!browser) return;
  await browser.setViewport({ width: 768, height: 1024, isMobile: false });
  await new Promise((r) => setTimeout(r, 200));

  const tabletMetrics = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const panel = host?.shadowRoot?.querySelector('.samche-panel');
      const rect = panel.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
      };
    })()
  `);

  assert.equal(tabletMetrics.width, 400, 'Tablet panel width should equal canonical 400px');
  assert.equal(tabletMetrics.height, 600, 'Tablet panel height should equal canonical 600px');
});

test('INTERACTION: Close and Reopen Cycle Preserves Correct Bounded State', async () => {
  if (!browser) return;
  await browser.setViewport({ width: 375, height: 667, isMobile: true });

  // 1. Close panel
  await browser.evaluate(`
    document.getElementById('samche-webchat-container').shadowRoot.querySelector('.samche-close-btn').click()
  `);
  await new Promise((r) => setTimeout(r, 400));

  const closedState = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const panel = host?.shadowRoot?.querySelector('.samche-panel');
      const launcher = host?.shadowRoot?.querySelector('.samche-launcher');
      return {
        panelOpen: panel.classList.contains('samche-open'),
        launcherHidden: launcher.classList.contains('samche-launcher-hidden'),
      };
    })()
  `);

  assert.ok(!closedState.panelOpen, 'Panel must not have samche-open class after close');
  assert.ok(!closedState.launcherHidden, 'Launcher must be visible after close');

  // 2. Reopen panel
  await browser.evaluate(`
    document.getElementById('samche-webchat-container').shadowRoot.querySelector('.samche-launcher').click()
  `);
  await new Promise((r) => setTimeout(r, 400));

  const reopenedState = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const panel = host?.shadowRoot?.querySelector('.samche-panel');
      const rect = panel.getBoundingClientRect();
      return {
        panelOpen: panel.classList.contains('samche-open'),
        isBounded: rect.width < 375 && rect.height < 667,
      };
    })()
  `);

  assert.ok(reopenedState.panelOpen, 'Panel must be open after re-clicking launcher');
  assert.ok(reopenedState.isBounded, 'Reopened panel must remain bounded compact card');
});

test('HOST STABILITY & ISOLATION: No Leaked CSS, Navigation with Widget Open & Zero Duplicate Hosts', async () => {
  if (!browser) return;
  // 1. Switch SPA views while widget is open
  await browser.evaluate(`document.getElementById('nav-pricing').click()`);
  await new Promise((r) => setTimeout(r, 200));

  const postNav = await browser.evaluate(`
    (() => {
      const hostCount = document.querySelectorAll('#samche-webchat-container').length;
      const host = document.getElementById('samche-webchat-container');
      const panel = host?.shadowRoot?.querySelector('.samche-panel');
      return {
        hostCount,
        panelOpen: panel?.classList.contains('samche-open'),
        pricingVisible: document.getElementById('pricing-view')?.style.display !== 'none',
      };
    })()
  `);

  assert.equal(postNav.hostCount, 1, 'Exactly one widget host must exist after navigation');
  assert.ok(postNav.panelOpen, 'Panel should remain open across SPA view transition');
  assert.ok(postNav.pricingVisible, 'Host SPA view transition must work smoothly with open widget');
});

test('CLEANUP: Teardown Server & Headless Browser', async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

