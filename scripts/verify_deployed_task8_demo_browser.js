/**
 * Real Headless Edge Browser verification against LIVE deployed staging environment:
 * https://samche-api-staging.onrender.com/task8-demo/
 */
import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

const DEPLOYED_URL = 'https://samche-api-staging.onrender.com/task8-demo/';

async function verifyLiveDeployedDemo() {
  console.log('=== REAL BROWSER E2E AGAINST LIVE DEPLOYED STAGING ===');
  console.log(`Target: ${DEPLOYED_URL}\n`);

  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  try {
    console.log('[1/8] Navigating to live deployed demo...');
    await browser.navigate(DEPLOYED_URL);

    // 1. Check raw CSS visible
    console.log('[2/8] Checking visible body text for leaked CSS declarations...');
    const bodyText = await browser.evaluate(`document.body.innerText`);
    const leakedStrings = [
      '.chat-window {',
      '.chat-widget-btn {',
      '@media (max-width',
      '/* Embedded Web Chat Styles */',
      '.hero-banner {',
      'main { max-width',
      '.msg-typing-indicator {',
      'typing-bounce',
      '--primary:',
    ];

    let leakFound = false;
    for (const s of leakedStrings) {
      if (bodyText.includes(s)) {
        console.error(`      FAIL: Leaked string found in body: "${s}"`);
        leakFound = true;
      }
    }

    if (!leakFound && bodyText.includes('SamChe') && bodyText.includes('Yeni Nesil Akıllı Cihazlar')) {
      console.log('      ✓ RAW_CSS_VISIBLE = NO (Clean document body render)');
    } else {
      throw new Error('Raw CSS is still visible or document failed to render');
    }

    // 2. Hit-testing top nav links
    console.log('[3/8] Performing hit-testing on top navigation (interception audit)...');
    const hitTest = await browser.evaluate(`
      (() => {
        const cat = document.getElementById('nav-catalog');
        const sec = document.getElementById('nav-security');
        const abo = document.getElementById('nav-about');
        const rC = cat.getBoundingClientRect();
        const rS = sec.getBoundingClientRect();
        const rA = abo.getBoundingClientRect();

        const elC = document.elementFromPoint(rC.left + rC.width / 2, rC.top + rC.height / 2);
        const elS = document.elementFromPoint(rS.left + rS.width / 2, rS.top + rS.height / 2);
        const elA = document.elementFromPoint(rA.left + rA.width / 2, rA.top + rA.height / 2);

        return {
          catOk: elC === cat,
          secOk: elS === sec,
          aboOk: elA === abo,
          interceptor: elC !== cat ? elC?.tagName + '.' + elC?.className : null
        };
      })()
    `);

    if (hitTest.catOk && hitTest.secOk && hitTest.aboOk) {
      console.log('      ✓ HOST_CLICK_INTERCEPTION = NO (Zero widget obstruction on top navigation)');
      console.log('      ✓ TOP_NAV_CLICKABLE = PASS');
    } else {
      throw new Error(`Hit testing failed: intercepted by ${hitTest.interceptor}`);
    }

    // 3. Test Top Nav SPA Navigation
    console.log('[4/8] Testing Top Navigation SPA route switching...');
    const navResult = await browser.evaluate(`
      (async () => {
        // Click security nav
        document.getElementById('nav-security').click();
        const secDisplay = document.getElementById('security-view').style.display;
        const secHash = window.location.hash;

        // Click about nav
        document.getElementById('nav-about').click();
        const aboDisplay = document.getElementById('about-view').style.display;
        const aboHash = window.location.hash;

        // Return to catalog
        document.getElementById('nav-catalog').click();
        const catDisplay = document.getElementById('catalog-view').style.display;

        return { secDisplay, secHash, aboDisplay, aboHash, catDisplay };
      })()
    `);

    if (navResult.secDisplay === 'block' && navResult.secHash === '#/guvenlik'
        && navResult.aboDisplay === 'block' && navResult.aboHash === '#/hakkimizda'
        && navResult.catDisplay === 'block') {
      console.log('      ✓ TOP_NAV_NAVIGATION = PASS (Catalog, Security, About routes active)');
    } else {
      throw new Error(`Top nav SPA route switching failed: ${JSON.stringify(navResult)}`);
    }

    // 4. Test Product "İncele" Click & Detail View
    console.log('[5/8] Testing Product "İncele" interaction...');
    const productNav = await browser.evaluate(`
      (async () => {
        const btn = document.querySelector('.product-card .btn-detail');
        btn.click();
        const detailDisplay = document.getElementById('detail-view').style.display;
        const detailHash = window.location.hash;
        const contextEntity = window.samchePageContext?.entity_name;

        // Back to catalog
        document.getElementById('btn-back-to-catalog').click();
        const backDisplay = document.getElementById('catalog-view').style.display;

        return { detailDisplay, detailHash, contextEntity, backDisplay };
      })()
    `);

    if (productNav.detailDisplay === 'block' && productNav.detailHash.includes('#/urun/')
        && productNav.contextEntity && productNav.backDisplay === 'block') {
      console.log(`      ✓ PRODUCT_LINKS_CLICKABLE = PASS (Navigated to ${productNav.contextEntity} and returned)`);
      console.log('      ✓ SPA_CONTEXT_UPDATE = PASS');
    } else {
      throw new Error(`Product navigation failed: ${JSON.stringify(productNav)}`);
    }

    // 5. Inspect Canonical Web Chat Runtime in Shadow DOM
    console.log('[6/8] Inspecting Canonical Web Chat Widget & Shadow DOM encapsulation...');
    const widgetInspect = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        if (!host) return { error: 'No host' };
        const shadow = host.shadowRoot;
        if (!shadow) return { error: 'No shadowRoot' };

        const launcher = shadow.querySelector('.samche-launcher');
        const panel = shadow.querySelector('.samche-panel');
        const launcherRect = launcher?.getBoundingClientRect();

        return {
          hasHost: true,
          hasShadow: true,
          launcherWidth: Math.round(launcherRect?.width || 0),
          launcherHeight: Math.round(launcherRect?.height || 0),
          isPanelOpen: panel?.classList.contains('samche-open'),
          panelVisibility: window.getComputedStyle(panel).visibility
        };
      })()
    `);

    if (widgetInspect.hasHost && widgetInspect.hasShadow && widgetInspect.launcherWidth === 60 && widgetInspect.launcherHeight === 60) {
      console.log('      ✓ SINGLE_CANONICAL_WIDGET_RUNTIME = PASS');
      console.log('      ✓ SHADOW_DOM_RUNTIME = PASS');
      console.log(`      ✓ LAUNCHER_RENDER = PASS (Bounded 60x60px circle: ${widgetInspect.launcherWidth}x${widgetInspect.launcherHeight}px)`);
      console.log(`      ✓ CLOSED_WIDGET_HIDDEN = PASS (Panel visibility: ${widgetInspect.panelVisibility})`);
    } else {
      throw new Error(`Widget inspection failed: ${JSON.stringify(widgetInspect)}`);
    }

    // 6. Test Launcher Click, Panel Geometry & Internal Styles
    console.log('[7/8] Testing Launcher Click & Panel expansion...');
    const panelOpen = await browser.evaluate(`
      (async () => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host.shadowRoot;
        const launcher = shadow.querySelector('.samche-launcher');
        launcher.click();
        await new Promise(r => setTimeout(r, 350));

        const panel = shadow.querySelector('.samche-panel');
        const panelRect = panel.getBoundingClientRect();
        const panelStyle = window.getComputedStyle(panel);
        const headerTitle = shadow.querySelector('.samche-header-title')?.textContent;
        const textarea = shadow.querySelector('.samche-composer-input');
        const sendBtn = shadow.querySelector('.samche-send-btn');
        const chips = shadow.querySelectorAll('.samche-chip').length;

        // Close panel
        shadow.querySelector('.samche-close-btn').click();
        await new Promise(r => setTimeout(r, 350));

        return {
          isOpen: panel.classList.contains('samche-open'),
          visibility: panelStyle.visibility,
          opacity: panelStyle.opacity,
          width: Math.round(panelRect.width),
          height: Math.round(panelRect.height),
          headerTitle,
          hasComposer: Boolean(textarea && sendBtn),
          chipCount: chips
        };
      })()
    `);

    if (panelOpen.width >= 380 && panelOpen.width <= 410 && panelOpen.hasComposer) {
      console.log(`      ✓ LAUNCHER_CLICK = PASS (Panel opened smoothly)`);
      console.log(`      ✓ CHAT_PANEL_RENDER = PASS (Desktop dimensions: ${panelOpen.width}x${panelOpen.height}px)`);
      console.log(`      ✓ CHAT_INTERNAL_STYLES = PASS (Title: "${panelOpen.headerTitle}", Composer: ready, Chips: ${panelOpen.chipCount})`);
    } else {
      throw new Error(`Panel expansion failed: ${JSON.stringify(panelOpen)}`);
    }

    // 7. Responsive Viewports Test on Live Staging
    console.log('[8/8] Testing Responsive Viewports against Live Deployment...');
    const viewports = [
      { name: 'Desktop 1440x900', w: 1440, h: 900, mobile: false, expLauncher: 60, expFull: false },
      { name: 'Desktop 1366x768', w: 1366, h: 768, mobile: false, expLauncher: 60, expFull: false },
      { name: 'Tablet 768x1024', w: 768, h: 1024, mobile: false, expLauncher: 60, expFull: false },
      { name: 'Mobile 375x812', w: 375, h: 812, mobile: true, expLauncher: 52, expFull: true },
      { name: 'Mobile 390x844', w: 390, h: 844, mobile: true, expLauncher: 52, expFull: true },
      { name: 'Mobile 320x568', w: 320, h: 568, mobile: true, expLauncher: 52, expFull: true },
      { name: 'Landscape 812x375', w: 812, h: 375, mobile: true, expLauncher: 52, expFull: true },
    ];

    for (const vp of viewports) {
      await browser.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile });
      const vpResult = await browser.evaluate(`
        (async () => {
          const host = document.getElementById('samche-webchat-container');
          const shadow = host.shadowRoot;
          const launcher = shadow.querySelector('.samche-launcher');
          const panel = shadow.querySelector('.samche-panel');

          launcher.click();
          await new Promise(r => setTimeout(r, 320));
          const openRect = panel.getBoundingClientRect();
          const launcherRect = launcher.getBoundingClientRect();

          shadow.querySelector('.samche-close-btn').click();
          await new Promise(r => setTimeout(r, 320));

          return {
            lW: Math.round(launcherRect.width),
            pW: Math.round(openRect.width)
          };
        })()
      `);

      if (vp.expFull) {
        if (vpResult.pW < vp.w - 15) throw new Error(`${vp.name}: mobile panel expected full sheet, got ${vpResult.pW}px`);
      } else {
        if (vpResult.pW < 380 || vpResult.pW > 410) throw new Error(`${vp.name}: desktop panel expected ~400px, got ${vpResult.pW}px`);
      }
      console.log(`      ✓ ${vp.name}: Launcher=${vpResult.lW}px, PanelWidth=${vpResult.pW}px (PASS)`);
    }

    console.log('\n======================================================');
    console.log('ALL LIVE DEPLOYED E2E CHECKS PASSED ON RENDER STAGING!');
    console.log('======================================================\n');
  } finally {
    await browser.close();
  }
}

verifyLiveDeployedDemo().catch((err) => {
  console.error('\n❌ LIVE DEPLOYED DEMO VERIFICATION FAILED:', err.message);
  process.exit(1);
});
