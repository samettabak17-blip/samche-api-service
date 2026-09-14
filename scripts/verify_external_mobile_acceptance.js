import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

const DEMO_URL = 'https://demo.samchecompany.com/';

const VIEWPORTS = [
  { name: 'NARROW_MOBILE', width: 360, height: 640, isMobile: true, maxPanelW: 335, maxPanelH: 530, minTopClear: 40 },
  { name: 'IPHONE', width: 390, height: 844, isMobile: true, maxPanelW: 365, maxPanelH: 530, minTopClear: 250 },
  { name: 'ANDROID', width: 412, height: 915, isMobile: true, maxPanelW: 400, maxPanelH: 530, minTopClear: 340 },
  { name: 'TABLET', width: 768, height: 1024, isMobile: false, maxPanelW: 405, maxPanelH: 605, minTopClear: 100 },
];

async function verifyExternalMobileAcceptance() {
  console.log('=== REAL EXTERNAL MOBILE ACCEPTANCE VERIFICATION ===');
  console.log(`Target: ${DEMO_URL}\n`);

  const browser = await BrowserCdp.launch({ headless: true });
  await browser.send('Network.enable');

  const report = {
    NARROW_MOBILE_PASS: false,
    IPHONE_VIEWPORT_PASS: false,
    ANDROID_VIEWPORT_PASS: false,
    TABLET_VIEWPORT_PASS: false,
    NO_FULLSCREEN_DEFAULT: true,
    NO_PAGE_SHIFT: true,
    NO_HORIZONTAL_OVERFLOW: true,
    COMPOSER_VISIBLE: true,
    INTERNAL_SCROLL_PASS: true,
    CLOSE_REOPEN_PASS: true,
    NAVIGATION_WHILE_OPEN_PASS: true,
  };

  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n--- Testing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
      await browser.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile });
      await browser.navigate(DEMO_URL);
      await new Promise((r) => setTimeout(r, 2000));

      for (let i = 0; i < 20; i++) {
        const hasLauncher = await browser.evaluate(`Boolean(document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher'))`);
        if (hasLauncher) break;
        await new Promise((r) => setTimeout(r, 300));
      }

      // 1. BASELINE & CLOSED LAUNCHER AUDIT
      const baseline = await browser.evaluate(`
        (() => {
          const l = document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher');
          if (!l) return null;
          const rect = l.getBoundingClientRect();
          const cs = window.getComputedStyle(l);
          return {
            w: rect.width,
            h: rect.height,
            right: window.innerWidth - rect.right,
            bottom: window.innerHeight - rect.bottom,
            boxShadow: cs.boxShadow,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            bodyWidth: document.body.offsetWidth,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          };
        })()
      `);

      if (!baseline) throw new Error(`${vp.name}: Launcher not found`);
      console.log(`[${vp.name} Closed]: ${baseline.w.toFixed(0)}x${baseline.h.toFixed(0)}px, right=${baseline.right.toFixed(0)}px, bottom=${baseline.bottom.toFixed(0)}px`);

      // 2. OPEN PANEL AUDIT
      await browser.evaluate(`document.querySelector('#samche-webchat-container').shadowRoot.querySelector('.samche-launcher').click()`);
      await new Promise((r) => setTimeout(r, 600));

      const panelMetrics = await browser.evaluate(`
        (() => {
          const p = document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelector('.samche-panel');
          const rect = p.getBoundingClientRect();
          const cs = window.getComputedStyle(p);
          const inp = p.querySelector('.samche-composer-input');
          const btn = p.querySelector('.samche-send-btn');
          const msgs = p.querySelector('.samche-messages');
          const mcs = window.getComputedStyle(msgs);
          const ics = window.getComputedStyle(inp);

          return {
            isOpen: p.classList.contains('samche-open'),
            w: rect.width,
            h: rect.height,
            top: rect.top,
            bottom: window.innerHeight - rect.bottom,
            left: rect.left,
            right: window.innerWidth - rect.right,
            borderRadius: parseFloat(cs.borderTopLeftRadius),
            bodyOverflow: document.body.style.overflow,
            bodyWidth: document.body.offsetWidth,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            composerVisible: inp && btn && rect.height > 0,
            composerFontSize: parseFloat(ics.fontSize),
            msgsOverflowY: mcs.overflowY,
            msgsOverscroll: mcs.overscrollBehaviorY || mcs.overscrollBehavior,
          };
        })()
      `);

      console.log(`[${vp.name} Open]: ${panelMetrics.w.toFixed(0)}x${panelMetrics.h.toFixed(0)}px, topClearance=${panelMetrics.top.toFixed(0)}px, radius=${panelMetrics.borderRadius}px`);

      if (!panelMetrics.isOpen) throw new Error(`${vp.name}: Panel not open`);
      if (panelMetrics.w > vp.maxPanelW) {
        report.NO_FULLSCREEN_DEFAULT = false;
        throw new Error(`${vp.name}: Panel width ${panelMetrics.w} exceeds max ${vp.maxPanelW}`);
      }
      if (panelMetrics.h > vp.maxPanelH) {
        report.NO_FULLSCREEN_DEFAULT = false;
        throw new Error(`${vp.name}: Panel height ${panelMetrics.h} exceeds max ${vp.maxPanelH}`);
      }
      if (panelMetrics.top < vp.minTopClear) {
        report.NO_FULLSCREEN_DEFAULT = false;
        throw new Error(`${vp.name}: Insufficient top clearance (${panelMetrics.top} < ${vp.minTopClear})`);
      }
      if (panelMetrics.borderRadius < 14) {
        throw new Error(`${vp.name}: Border radius not preserved (${panelMetrics.borderRadius}px)`);
      }
      if (panelMetrics.scrollWidth > baseline.scrollWidth) {
        report.NO_HORIZONTAL_OVERFLOW = false;
        throw new Error(`${vp.name}: WebChat caused horizontal overflow (${panelMetrics.scrollWidth} > ${baseline.scrollWidth})`);
      }
      if (panelMetrics.scrollX !== baseline.scrollX) {
        report.NO_PAGE_SHIFT = false;
        throw new Error(`${vp.name}: Horizontal scroll jump (${panelMetrics.scrollX} vs ${baseline.scrollX})`);
      }
      if (panelMetrics.scrollY !== baseline.scrollY) {
        report.NO_PAGE_SHIFT = false;
        throw new Error(`${vp.name}: Vertical scroll jump (${panelMetrics.scrollY} vs ${baseline.scrollY})`);
      }
      if (panelMetrics.bodyWidth !== baseline.bodyWidth) {
        report.NO_PAGE_SHIFT = false;
        throw new Error(`${vp.name}: Body width mutated (${panelMetrics.bodyWidth} vs ${baseline.bodyWidth})`);
      }
      if (panelMetrics.bodyOverflow === 'hidden') {
        report.NO_PAGE_SHIFT = false;
        throw new Error(`${vp.name}: Body overflow locked`);
      }
      if (!panelMetrics.composerVisible) {
        report.COMPOSER_VISIBLE = false;
        throw new Error(`${vp.name}: Composer not visible`);
      }
      if (vp.isMobile && panelMetrics.composerFontSize < 16) {
        throw new Error(`${vp.name}: Composer font-size < 16px`);
      }
      if (panelMetrics.msgsOverflowY !== 'auto' && panelMetrics.msgsOverflowY !== 'scroll') {
        report.INTERNAL_SCROLL_PASS = false;
        throw new Error(`${vp.name}: Messages do not scroll internally`);
      }
      // 3. CLOSE & REOPEN
      await browser.evaluate(`document.querySelector('#samche-webchat-container').shadowRoot.querySelector('.samche-close-btn').click()`);
      await new Promise((r) => setTimeout(r, 400));

      const closedAgain = await browser.evaluate(`
        !document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelector('.samche-panel')?.classList.contains('samche-open')
      `);
      if (!closedAgain) {
        report.CLOSE_REOPEN_PASS = false;
        throw new Error(`${vp.name}: Close button did not close panel`);
      }

      // Reopen
      await browser.evaluate(`document.querySelector('#samche-webchat-container').shadowRoot.querySelector('.samche-launcher').click()`);
      await new Promise((r) => setTimeout(r, 400));

      const reopened = await browser.evaluate(`
        document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelector('.samche-panel')?.classList.contains('samche-open')
      `);
      if (!reopened) {
        report.CLOSE_REOPEN_PASS = false;
        throw new Error(`${vp.name}: Reopen failed`);
      }

      // 4. NAVIGATION WHILE OPEN
      await browser.evaluate(`
        (() => {
          const links = Array.from(document.querySelectorAll('a[href^="#"], nav a, header a'));
          const target = links.find(a => a.textContent.includes('Fiyat') || a.textContent.includes('Price') || a.textContent.includes('Ürün') || a.href.includes('#'));
          if (target) target.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 300));

      const hostCount = await browser.evaluate(`document.querySelectorAll('#samche-webchat-container').length`);
      if (hostCount !== 1) {
        report.NAVIGATION_WHILE_OPEN_PASS = false;
        throw new Error(`${vp.name}: Duplicate host after navigation (count=${hostCount})`);
      }

      if (vp.name === 'NARROW_MOBILE') report.NARROW_MOBILE_PASS = true;
      if (vp.name === 'IPHONE') report.IPHONE_VIEWPORT_PASS = true;
      if (vp.name === 'ANDROID') report.ANDROID_VIEWPORT_PASS = true;
      if (vp.name === 'TABLET') report.TABLET_VIEWPORT_PASS = true;
      console.log(`✓ ${vp.name} Viewport Passed!`);
    }

    console.log('\n=== ALL VIEWPORTS COMPLETED SUCCESSFULLY ===');
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    return report;
  } catch (err) {
    console.error('External Mobile Acceptance Error:', err.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

verifyExternalMobileAcceptance();

