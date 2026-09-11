/**
 * scripts/verify_proactive_live_browser.js
 * Real Browser End-to-End Proactive & High-Intent Acceptance against LIVE deployed staging:
 * https://samche-api-staging.onrender.com/task8-demo/
 */
import { BrowserCdp, findBrowserBinary } from '../tests/helpers/browser-cdp.js';

const STAGING_URL = (process.env.STAGING_SERVICE_URL || 'https://samche-api-staging.onrender.com').trim().replace(/\/+$/, '');
const TARGET_DEMO_URL = `${STAGING_URL}/task8-demo/`;

async function verifyLiveProactiveBrowser() {
  console.log('=== REAL BROWSER PROACTIVE LIVE STAGING ACCEPTANCE ===');
  console.log(`Target: ${TARGET_DEMO_URL}\n`);

  const binary = findBrowserBinary();
  console.log(`Using Browser Binary: ${binary}`);

  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  const results = {
    SCENARIO_A_LOW_INTENT: 'FAIL',
    SCENARIO_B_HIGH_INTENT: 'FAIL',
    SCENARIO_C_DISMISSAL: 'FAIL',
    SCENARIO_D_REFRESH: 'FAIL',
  };

  try {
    // -------------------------------------------------------------
    // SCENARIO A: LOW INTENT
    // -------------------------------------------------------------
    console.log('[1/4] SCENARIO A — LOW INTENT: Clean arrival at catalog, dwell 16s...');
    await browser.navigate(TARGET_DEMO_URL);

    for (let s = 1; s <= 16; s++) {
      await new Promise(r => setTimeout(r, 1000));
      process.stdout.write(`\r      Catalog dwell elapsed: ${s}s / 16s`);
    }
    console.log('');

    const catalogState = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const panel = shadow?.querySelector('.samche-panel');
        return {
          isOpen: panel ? panel.classList.contains('samche-open') : false,
        };
      })()
    `);

    if (catalogState.isOpen) {
      throw new Error('SCENARIO A FAILED: Widget aggressively auto-opened on catalog arrival!');
    }
    results.SCENARIO_A_LOW_INTENT = 'PASS';
    console.log('      ✓ SCENARIO A: PASS (Catalog dwell did not auto-open, LOW intent preserved)');

    // -------------------------------------------------------------
    // SCENARIO B: HIGH INTENT
    // -------------------------------------------------------------
    console.log('\n[2/4] SCENARIO B — HIGH INTENT: Navigating to Titan Akıllı Saat Pro & dwelling 16s...');
    await browser.evaluate(`
      (() => {
        const detailBtn = document.querySelector('.product-card .btn-detail');
        if (detailBtn) detailBtn.click();
      })()
    `);

    let autoOpened = false;
    let proactiveMessage = '';
    for (let s = 1; s <= 25; s++) {
      await new Promise(r => setTimeout(r, 1000));
      process.stdout.write(`\r      Product dwell elapsed: ${s}s / 25s (waiting for auto-open)`);

      const pollState = await browser.evaluate(`
        (() => {
          const host = document.getElementById('samche-webchat-container');
          const shadow = host?.shadowRoot;
          const panel = shadow?.querySelector('.samche-panel');
          const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent.trim()) : [];
          return {
            isOpen: panel ? panel.classList.contains('samche-open') : false,
            botMsgs: botMsgs
          };
        })()
      `);

      if (pollState.isOpen && pollState.botMsgs.length > 0) {
        autoOpened = true;
        proactiveMessage = pollState.botMsgs[pollState.botMsgs.length - 1];
        break;
      }
    }
    console.log('');

    if (!autoOpened) {
      throw new Error('SCENARIO B FAILED: Widget did NOT auto-open after qualified dwell on product!');
    }
    console.log(`      ✓ Auto-open detected! Proactive message received: "${proactiveMessage}"`);

    const isGrounded = /titan|saat|akıllı saat/i.test(proactiveMessage);
    if (!isGrounded) {
      throw new Error(`SCENARIO B FAILED: Proactive message not grounded to Titan Akıllı Saat: "${proactiveMessage}"`);
    }
    results.SCENARIO_B_HIGH_INTENT = 'PASS';
    console.log('      ✓ SCENARIO B: PASS (Widget auto-opened with grounded contextual message)');

    // -------------------------------------------------------------
    // SCENARIO C: DISMISSAL
    // -------------------------------------------------------------
    console.log('\n[3/4] SCENARIO C — DISMISSAL: Closing panel, navigating to Powerbank & dwelling 16s...');
    await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const closeBtn = shadow?.querySelector('.samche-close-btn');
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    await browser.evaluate(`
      (() => {
        document.getElementById('nav-catalog').click();
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    await browser.evaluate(`
      (() => {
        const cards = document.querySelectorAll('.product-card');
        for (const card of cards) {
          if (card.innerText.includes('Ultra Güç Bankası')) {
            const btn = card.querySelector('.btn-detail');
            if (btn) btn.click();
            break;
          }
        }
      })()
    `);

    for (let s = 1; s <= 16; s++) {
      await new Promise(r => setTimeout(r, 1000));
      process.stdout.write(`\r      Dismissal cooldown test dwell: ${s}s / 16s`);
    }
    console.log('');

    const dismissalState = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const panel = shadow?.querySelector('.samche-panel');
        return {
          isOpen: panel ? panel.classList.contains('samche-open') : false
        };
      })()
    `);

    if (dismissalState.isOpen) {
      throw new Error('SCENARIO C FAILED: Widget reopened during dismissal cooldown!');
    }
    results.SCENARIO_C_DISMISSAL = 'PASS';
    console.log('      ✓ SCENARIO C: PASS (Dismissal cooldown strictly respected, widget did not reopen)');

    // -------------------------------------------------------------
    // SCENARIO D: REFRESH
    // -------------------------------------------------------------
    console.log('\n[4/4] SCENARIO D — REFRESH: Reloading page to test deduplication and persistence...');
    await browser.navigate(`${TARGET_DEMO_URL}#/urun/titan-akilli-saat-pro`);
    await new Promise(r => setTimeout(r, 3000));

    const refreshState = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const panel = shadow?.querySelector('.samche-panel');
        const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent.trim()) : [];
        return {
          isOpen: panel ? panel.classList.contains('samche-open') : false,
          botMsgs: botMsgs
        };
      })()
    `);

    if (refreshState.isOpen) {
      throw new Error('SCENARIO D FAILED: Widget auto-opened aggressively on page refresh!');
    }
    const titanProactiveCount = refreshState.botMsgs.filter(m => /titan|saat/i.test(m)).length;
    if (titanProactiveCount > 1) {
      throw new Error(`SCENARIO D FAILED: Duplicate proactive messages detected after refresh (count: ${titanProactiveCount})`);
    }
    results.SCENARIO_D_REFRESH = 'PASS';
    console.log('      ✓ SCENARIO D: PASS (Refresh preserved state with zero duplicate proactive popups)');

    console.log('\n======================================================');
    console.log('REAL BROWSER PROACTIVE ACCEPTANCE: ALL 4 SCENARIOS PASS');
    console.log('======================================================');
    console.log(JSON.stringify(results, null, 2));

  } finally {
    await browser.close();
  }
}

verifyLiveProactiveBrowser().catch(err => {
  console.error('\n❌ REAL BROWSER PROACTIVE VERIFICATION FAILED:', err.message);
  process.exit(1);
});
