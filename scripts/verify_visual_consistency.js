import { BrowserCdp } from '../tests/helpers/browser-cdp.js';
import { createFixtureServer } from './verify_visual_server.js';

async function checkGlow(browser, label) {
  const data = await browser.evaluate(`
    (function() {
      var host = document.querySelector('#samche-webchat-container');
      if (!host) return { error: 'NO_HOST' };
      var launcher = host.shadowRoot.querySelector('.samche-launcher');
      if (!launcher) return { error: 'NO_LAUNCHER' };
      var csLauncher = window.getComputedStyle(launcher);
      return {
        url: window.location.pathname,
        hostCount: document.querySelectorAll('#samche-webchat-container').length,
        launcherClass: launcher.className,
        boxShadow: csLauncher.boxShadow,
        glowRing: csLauncher.getPropertyValue('--chat-glow-ring'),
        glowHalo: csLauncher.getPropertyValue('--chat-glow-halo'),
      };
    })()
  `);
  console.log(`[${label}] result:`, JSON.stringify(data));
  if (data.hostCount !== 1) throw new Error(`${label}: expected 1 host, got ${data.hostCount}`);
  if (!data.boxShadow.includes('128, 200, 248')) throw new Error(`${label}: glow lost! BoxShadow: ${data.boxShadow}`);
  return data;
}

async function main() {
  console.log('=== Web Chat Visual Consistency Audit ===');
  const fixture = await createFixtureServer();
  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  try {
    // 1. Home
    await browser.navigate(fixture.origin + '/');
    await new Promise((r) => setTimeout(r, 800));
    await checkGlow(browser, 'HOME');

    // 2. SPA Route 2: /shop
    await browser.evaluate("document.getElementById('link-shop').click();");
    await new Promise((r) => setTimeout(r, 600));
    await checkGlow(browser, 'ROUTE_2_SHOP');

    // 3. SPA Route 3: /vektor-horizon-akll-bileklik
    await browser.evaluate("document.getElementById('link-prod').click();");
    await new Promise((r) => setTimeout(r, 800));
    await checkGlow(browser, 'ROUTE_3_PRODUCT_DETAIL');

    // 4. Traditional Full-Page Nav
    await browser.evaluate("document.getElementById('link-full-prod').click();");
    await new Promise((r) => setTimeout(r, 1200));
    await checkGlow(browser, 'FULL_PAGE_NAVIGATION');

    // 5. Host Remount Simulation
    await browser.evaluate(`
      var host = document.querySelector('#samche-webchat-container');
      host.parentElement.removeChild(host);
      window.SamcheWebChat.mount({ widgetKey: 'wch_staging_task8_demo' });
    `);
    await new Promise((r) => setTimeout(r, 300));
    await checkGlow(browser, 'REMOUNT_SIMULATION');

    // 6. Open / Close panel
    await browser.evaluate(`
      var shadow = document.querySelector('#samche-webchat-container').shadowRoot;
      shadow.querySelector('.samche-launcher').click();
      shadow.querySelector('.samche-close-btn').click();
    `);
    await checkGlow(browser, 'TOGGLE_PANEL');

    // 7. Mobile Viewport
    await browser.setViewport({ width: 390, height: 844, isMobile: true });
    await new Promise((r) => setTimeout(r, 400));
    await checkGlow(browser, 'MOBILE_390PX');

    console.log('\n=== ALL 7 VISUAL CONSISTENCY CHECKS PASSED PERFECTLY ===');
  } finally {
    await browser.close();
    await new Promise((r) => fixture.server.close(r));
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
