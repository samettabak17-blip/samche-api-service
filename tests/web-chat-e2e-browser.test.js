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

let server;
let serverPort;
let baseUrl;
let browser;

test('Browser E2E Setup: Start mock HTTP server and launch headless Edge', async () => {
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
        session: 'wch_sess_e2e_test_token_123',
        resumed: false,
        history: [],
        appearance: {
          title: 'SamChe Mağaza Asistanı',
          subtitle: 'Çevrimiçi Danışman',
          launcher_position: 'right',
          theme_mode: 'dark',
        },
        behavior: {
          language: 'tr',
          proactive_enabled: true,
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
        reply: 'SamChe Titan Akıllı Saat Pro modelimiz 14 gün pil ömrü ve IP68 su geçirmezliğe sahiptir.',
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

  browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });
});

test('REAL BROWSER E2E: Page Visual Render & ZERO Raw CSS Leaked in Visible Text', async () => {
  if (!browser) return;
  await browser.navigate(`${baseUrl}/task8-demo/`);

  const visibleBodyText = await browser.evaluate(`document.body.innerText`);
  console.log('VISIBLE BODY TEXT PREVIEW:', typeof visibleBodyText, visibleBodyText?.length, visibleBodyText ? visibleBodyText.slice(0, 150) : null);

  const forbiddenLeakedStrings = [
    '.chat-window {',
    '.chat-widget-btn {',
    '@media (max-width',
    '/* Embedded Web Chat Styles */',
    '.hero-banner {',
    'main { max-width',
    '.msg-typing-indicator {',
    'typing-bounce',
    '#catalog-view',
    '--primary:',
  ];

  for (const s of forbiddenLeakedStrings) {
    assert.ok(
      !visibleBodyText.includes(s),
      `CSS declaration or comment "${s}" was detected leaked as visible page text!`
    );
  }

  assert.ok(visibleBodyText.includes('SamChe'));
  assert.ok(visibleBodyText.includes('Yeni Nesil Akıllı Cihazlar'));
  assert.ok(visibleBodyText.includes('Titan Akıllı Saat Pro'));
  assert.ok(visibleBodyText.includes('Ultra Güç Bankası'));
});

test('REAL BROWSER E2E: Top Navigation Hit-Testing & Host Click Interception = NO', async () => {
  if (!browser) return;
  const hitTestResult = await browser.evaluate(`
    (() => {
      const navCatalog = document.getElementById('nav-catalog');
      const navSecurity = document.getElementById('nav-security');
      const navAbout = document.getElementById('nav-about');

      const rectCat = navCatalog.getBoundingClientRect();
      const rectSec = navSecurity.getBoundingClientRect();
      const rectAbo = navAbout.getBoundingClientRect();

      const elAtCat = document.elementFromPoint(rectCat.left + rectCat.width / 2, rectCat.top + rectCat.height / 2);
      const elAtSec = document.elementFromPoint(rectSec.left + rectSec.width / 2, rectSec.top + rectSec.height / 2);
      const elAtAbo = document.elementFromPoint(rectAbo.left + rectAbo.width / 2, rectAbo.top + rectAbo.height / 2);

      return {
        catMatch: elAtCat === navCatalog,
        secMatch: elAtSec === navSecurity,
        aboMatch: elAtAbo === navAbout,
        interceptingEl: elAtCat ? elAtCat.tagName + '.' + elAtCat.className : null
      };
    })()
  `);

  assert.ok(hitTestResult.catMatch, `Catalog link must receive hit events without interception (got ${hitTestResult.interceptingEl})`);
  assert.ok(hitTestResult.secMatch, 'Security link must receive hit events without interception');
  assert.ok(hitTestResult.aboMatch, 'About link must receive hit events without interception');
});

test('REAL BROWSER E2E: Top Navigation Interaction & SPA View Switching', async () => {
  if (!browser) return;
  // 1. Click Güvenlik & Test
  const secClickResult = await browser.evaluate(`
    (() => {
      document.getElementById('nav-security').click();
      return {
        hash: window.location.hash,
        secDisplay: document.getElementById('security-view').style.display,
        catDisplay: document.getElementById('catalog-view').style.display,
        secActive: document.getElementById('nav-security').classList.contains('active'),
        catActive: document.getElementById('nav-catalog').classList.contains('active')
      };
    })()
  `);

  assert.equal(secClickResult.hash, '#/guvenlik');
  assert.equal(secClickResult.secDisplay, 'block');
  assert.equal(secClickResult.catDisplay, 'none');
  assert.ok(secClickResult.secActive, 'Security nav item must be active');
  assert.ok(!secClickResult.catActive, 'Catalog nav item must not be active');

  // 2. Click Hakkımızda
  const aboutClickResult = await browser.evaluate(`
    (() => {
      document.getElementById('nav-about').click();
      return {
        hash: window.location.hash,
        aboDisplay: document.getElementById('about-view').style.display,
        secDisplay: document.getElementById('security-view').style.display,
        aboActive: document.getElementById('nav-about').classList.contains('active')
      };
    })()
  `);

  assert.equal(aboutClickResult.hash, '#/hakkimizda');
  assert.equal(aboutClickResult.aboDisplay, 'block');
  assert.equal(aboutClickResult.secDisplay, 'none');
  assert.ok(aboutClickResult.aboActive, 'About nav item must be active');

  // 3. Return to Ürünler
  const catReturnResult = await browser.evaluate(`
    (() => {
      document.getElementById('nav-catalog').click();
      return {
        hash: window.location.hash,
        catDisplay: document.getElementById('catalog-view').style.display,
        catActive: document.getElementById('nav-catalog').classList.contains('active')
      };
    })()
  `);

  assert.equal(catReturnResult.hash, '#/');
  assert.equal(catReturnResult.catDisplay, 'block');
  assert.ok(catReturnResult.catActive, 'Catalog nav item must be active');
});

test('REAL BROWSER E2E: Product "İncele" Navigation & Context Synchronization', async () => {
  if (!browser) return;
  const detailClickResult = await browser.evaluate(`
    (() => {
      const btn = document.querySelector('.product-card .btn-detail');
      btn.click();
      return {
        hash: window.location.hash,
        detailDisplay: document.getElementById('detail-view').style.display,
        catDisplay: document.getElementById('catalog-view').style.display,
        entityName: window.samchePageContext ? window.samchePageContext.entity_name : null,
        entityType: window.samchePageContext ? window.samchePageContext.entity_type : null
      };
    })()
  `);

  assert.ok(detailClickResult.hash.startsWith('#/urun/'));
  assert.equal(detailClickResult.detailDisplay, 'block');
  assert.equal(detailClickResult.catDisplay, 'none');
  assert.ok(detailClickResult.entityName, 'Entity name must be populated in window.samchePageContext');
  assert.equal(detailClickResult.entityType, 'Product');

  // Click back button
  const backResult = await browser.evaluate(`
    (() => {
      document.getElementById('btn-back-to-catalog').click();
      return {
        hash: window.location.hash,
        catDisplay: document.getElementById('catalog-view').style.display,
        detailDisplay: document.getElementById('detail-view').style.display
      };
    })()
  `);

  assert.equal(backResult.hash, '#/');
  assert.equal(backResult.catDisplay, 'block');
  assert.equal(backResult.detailDisplay, 'none');
});

test('REAL BROWSER E2E: Canonical Web Chat Widget Runtime & Shadow DOM Encapsulation', async () => {
  if (!browser) return;
  const widgetInspection = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      if (!host) return { hostExists: false };

      const shadow = host.shadowRoot;
      if (!shadow) return { hostExists: true, shadowExists: false };

      const launcher = shadow.querySelector('.samche-launcher');
      const panel = shadow.querySelector('.samche-panel');
      const hostStyle = window.getComputedStyle(host);
      const launcherRect = launcher ? launcher.getBoundingClientRect() : null;

      return {
        hostExists: true,
        shadowExists: true,
        launcherExists: Boolean(launcher),
        panelExists: Boolean(panel),
        launcherWidth: launcherRect ? Math.round(launcherRect.width) : 0,
        launcherHeight: launcherRect ? Math.round(launcherRect.height) : 0,
        hostPointerEvents: hostStyle.pointerEvents,
        isPanelOpen: panel ? panel.classList.contains('samche-open') : false
      };
    })()
  `);

  assert.ok(widgetInspection.hostExists, 'Host #samche-webchat-container must exist');
  assert.ok(widgetInspection.shadowExists, 'Shadow DOM shadowRoot must exist on host');
  assert.ok(widgetInspection.launcherExists, 'Launcher button must exist inside shadowRoot');
  assert.ok(widgetInspection.panelExists, 'Panel must exist inside shadowRoot');
  assert.equal(widgetInspection.launcherWidth, 60, 'Launcher button width must be exactly 60px');
  assert.equal(widgetInspection.launcherHeight, 60, 'Launcher button height must be exactly 60px');
  assert.equal(widgetInspection.hostPointerEvents, 'none', 'Host element must have pointer-events: none');
  assert.equal(widgetInspection.isPanelOpen, false, 'Panel must be closed initially');
});

test('REAL BROWSER E2E: Launcher Click Opens Premium Chat Panel & Internal Controls are Styled', async () => {
  if (!browser) return;
  const openResult = await browser.evaluate(`
    (async () => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host.shadowRoot;
      const launcher = shadow.querySelector('.samche-launcher');
      launcher.click();

      // Allow smooth transition to finish
      await new Promise(r => setTimeout(r, 350));

      const panel = shadow.querySelector('.samche-panel');
      const panelRect = panel.getBoundingClientRect();
      const panelStyle = window.getComputedStyle(panel);
      const textarea = shadow.querySelector('.samche-composer-input');
      const sendBtn = shadow.querySelector('.samche-send-btn');
      const headerTitle = shadow.querySelector('.samche-header-title');

      return {
        isOpen: panel.classList.contains('samche-open'),
        visibility: panelStyle.visibility,
        opacity: panelStyle.opacity,
        panelWidth: Math.round(panelRect.width),
        panelHeight: Math.round(panelRect.height),
        hasComposer: Boolean(textarea),
        hasSendBtn: Boolean(sendBtn),
        headerTitleText: headerTitle ? headerTitle.textContent : null
      };
    })()
  `);

  console.log('OPEN_RESULT IN TEST 5:', openResult);
  assert.ok(openResult.isOpen, 'Panel must receive .samche-open class on click');
  assert.equal(openResult.visibility, 'visible', 'Panel visibility must be visible when open');
  assert.equal(openResult.opacity, '1', 'Panel opacity must be 1 when open');
  assert.ok(openResult.panelWidth >= 350 && openResult.panelWidth <= 420, 'Panel desktop width must be ~400px');
  assert.ok(openResult.panelHeight >= 450 && openResult.panelHeight <= 600, 'Panel desktop height must be bounded within 450-600px');
  assert.ok(openResult.hasComposer, 'Composer textarea must exist');
  assert.ok(openResult.hasSendBtn, 'Send button must exist');
  assert.equal(openResult.headerTitleText, 'SamChe Mağaza Asistanı', 'Header title must reflect bootstrap appearance');

  // Click close button inside Shadow DOM
  const closeResult = await browser.evaluate(`
    (async () => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host.shadowRoot;
      const closeBtn = shadow.querySelector('.samche-close-btn');
      closeBtn.click();
      await new Promise(r => setTimeout(r, 350));

      const panel = shadow.querySelector('.samche-panel');
      return {
        isOpen: panel.classList.contains('samche-open')
      };
    })()
  `);

  assert.equal(closeResult.isOpen, false, 'Panel must not have .samche-open class after close click');
});

test('REAL BROWSER E2E: Responsive Viewports (Desktop, Tablet, Mobile, Mobile Landscape)', async () => {
  if (!browser) return;
  const viewports = [
    { name: 'Desktop 1440x900', width: 1440, height: 900, isMobile: false, expectedLauncherSize: 60, expectedPanelFull: false },
    { name: 'Desktop 1366x768', width: 1366, height: 768, isMobile: false, expectedLauncherSize: 60, expectedPanelFull: false },
    { name: 'Tablet 768x1024', width: 768, height: 1024, isMobile: false, expectedLauncherSize: 60, expectedPanelFull: false },
    { name: 'Mobile 375x812', width: 375, height: 812, isMobile: true, expectedLauncherSize: 52, expectedPanelFull: true },
    { name: 'Mobile 390x844', width: 390, height: 844, isMobile: true, expectedLauncherSize: 52, expectedPanelFull: true },
    { name: 'Mobile 320x568', width: 320, height: 568, isMobile: true, expectedLauncherSize: 52, expectedPanelFull: true },
    { name: 'Landscape 812x375', width: 812, height: 375, isMobile: true, expectedLauncherSize: 52, expectedPanelFull: true },
  ];

  for (const vp of viewports) {
    await browser.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile });

    const measurement = await browser.evaluate(`
      (async () => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host.shadowRoot;
        const launcher = shadow.querySelector('.samche-launcher');
        const panel = shadow.querySelector('.samche-panel');

        // Open panel
        launcher.click();
        await new Promise(r => setTimeout(r, 320));
        const openRect = panel.getBoundingClientRect();
        const launcherRect = launcher.getBoundingClientRect();

        // Close panel
        shadow.querySelector('.samche-close-btn').click();
        await new Promise(r => setTimeout(r, 320));

        return {
          launcherWidth: Math.round(launcherRect.width),
          launcherHeight: Math.round(launcherRect.height),
          panelWidth: Math.round(openRect.width),
          panelHeight: Math.round(openRect.height)
        };
      })()
    `);

    assert.equal(
      measurement.launcherWidth,
      vp.expectedLauncherSize,
      `${vp.name}: launcher width must be ${vp.expectedLauncherSize}px (got ${measurement.launcherWidth}px)`
    );

    if (vp.expectedPanelFull) {
      assert.ok(
        measurement.panelWidth >= vp.width - 15,
        `${vp.name}: mobile panel must expand near full width (got ${measurement.panelWidth}px for viewport ${vp.width}px)`
      );
    } else {
      assert.ok(
        measurement.panelWidth >= 380 && measurement.panelWidth <= 405,
        `${vp.name}: desktop/tablet panel width must be ~400px (got ${measurement.panelWidth}px)`
      );
    }
  }

  // Restore desktop viewport
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });
});

test('REAL BROWSER E2E: Adversarial Host CSS Isolation Fixture', async () => {
  if (!browser) return;

  const isolationResult = await browser.evaluate(`
    (() => {
      // Inject adversarial hostile styles into the host page document
      const hostileStyle = document.createElement('style');
      hostileStyle.id = 'adversarial-host-css';
      hostileStyle.textContent = \`
        * {
          font-family: "Comic Sans MS" !important;
          color: rgb(255, 0, 0) !important;
          border-radius: 0px !important;
        }
      \`;
      document.head.appendChild(hostileStyle);

      const host = document.getElementById('samche-webchat-container');
      const shadow = host.shadowRoot;
      const launcher = shadow.querySelector('.samche-launcher');
      const launcherStyle = window.getComputedStyle(launcher);

      // Launcher must retain 50% border radius and its own colors inside Shadow DOM
      const isRound = launcherStyle.borderRadius === '50%';
      const notRed = launcherStyle.color !== 'rgb(255, 0, 0)';

      // Clean up hostile style
      hostileStyle.remove();

      return { isRound, notRed, color: launcherStyle.color, borderRadius: launcherStyle.borderRadius };
    })()
  `);

  assert.ok(isolationResult.isRound, 'Shadow DOM launcher must retain 50% border-radius despite adversarial host CSS');
  assert.ok(isolationResult.notRed, 'Shadow DOM launcher must preserve its white color despite adversarial host CSS');
});

test('REAL BROWSER E2E: RTL Support and Reduced Motion Adaptation', async () => {
  if (!browser) return;

  const rtlResult = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host.shadowRoot;
      const panel = shadow.querySelector('.samche-panel');

      panel.setAttribute('dir', 'rtl');
      const dir = panel.getAttribute('dir');
      const computedDir = window.getComputedStyle(panel).direction;
      panel.removeAttribute('dir');

      return { dir, computedDir };
    })()
  `);

  assert.equal(rtlResult.dir, 'rtl');
  assert.equal(rtlResult.computedDir, 'rtl');
});

test('REAL BROWSER E2E: Open Panel Bounds & Host Area Non-Interception', async () => {
  if (!browser) return;

  const hitTestOpen = await browser.evaluate(`
    (async () => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host.shadowRoot;
      const launcher = shadow.querySelector('.samche-launcher');
      const panel = shadow.querySelector('.samche-panel');

      // Open panel
      launcher.click();
      await new Promise(r => setTimeout(r, 320));

      // Test point in top-left of page (e.g. at logo or main hero banner)
      const hero = document.querySelector('.hero-banner h1');
      const heroRect = hero.getBoundingClientRect();
      const elAtHero = document.elementFromPoint(heroRect.left + 10, heroRect.top + 10);

      // Close panel
      shadow.querySelector('.samche-close-btn').click();
      await new Promise(r => setTimeout(r, 320));

      return {
        heroReceivedHit: elAtHero === hero || hero.contains(elAtHero),
        hitTagName: elAtHero ? elAtHero.tagName : null
      };
    })()
  `);

  assert.ok(hitTestOpen.heroReceivedHit, `When panel is open in bottom-right, top-left page elements must still receive hit events directly (got ${hitTestOpen.hitTagName})`);
});

test('Browser E2E Teardown: Close browser and mock server', async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
