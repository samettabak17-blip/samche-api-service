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
    SCENARIO_B_NEGATIVE_TIMING: 'FAIL',
    SCENARIO_B_QUALIFIED_DWELL: 'FAIL',
    SCENARIO_C_DISMISSAL: 'FAIL',
    SCENARIO_D_REFRESH: 'FAIL',
    SCENARIO_E_GROUNDED_GREETING: 'FAIL',
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
    // SCENARIO B: NEGATIVE TIMING & QUALIFIED DWELL AUTO-OPEN
    // -------------------------------------------------------------
    console.log('\n[2/5] SCENARIO B — NEGATIVE TIMING & QUALIFIED DWELL: Navigating to Titan Akıllı Saat Pro...');
    await browser.evaluate(`
      (() => {
        const detailBtn = document.querySelector('.product-card .btn-detail');
        if (detailBtn) detailBtn.click();
      })()
    `);

    let autoOpened = false;
    let openedAtSecond = null;
    let proactiveMessage = '';
    for (let s = 1; s <= 25; s++) {
      await new Promise(r => setTimeout(r, 1000));
      process.stdout.write(`\r      Product dwell elapsed: ${s}s / 25s (monitoring open state)`);

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

      if (pollState.isOpen) {
        openedAtSecond = s;
        if (s < 15) {
          throw new Error(`SCENARIO B FAILED: NEGATIVE TIMING REGRESSION! Widget auto-opened prematurely at second ${s} before reaching the 15s dwell threshold!`);
        }
        autoOpened = true;
        proactiveMessage = pollState.botMsgs[pollState.botMsgs.length - 1] || '';
        break;
      }
    }
    console.log('');

    results.SCENARIO_B_NEGATIVE_TIMING = 'PASS';
    console.log('      ✓ SCENARIO B NEGATIVE TIMING: PASS (Widget remained strictly closed at 0s, 3s, 5s, 10s, 14s)');

    if (!autoOpened || openedAtSecond < 15) {
      throw new Error(`SCENARIO B FAILED: Widget did NOT auto-open after qualified dwell on product (openedAt: ${openedAtSecond})!`);
    }
    console.log(`      ✓ Auto-open detected at ${openedAtSecond}s (>= 15s dwell threshold)! Message: "${proactiveMessage}"`);

    const isGrounded = /titan|saat|akıllı saat/i.test(proactiveMessage);
    if (!isGrounded) {
      throw new Error(`SCENARIO B FAILED: Proactive message not grounded to Titan Akıllı Saat: "${proactiveMessage}"`);
    }
    results.SCENARIO_B_QUALIFIED_DWELL = 'PASS';
    console.log('      ✓ SCENARIO B QUALIFIED DWELL: PASS (Auto-open occurred at qualified dwell with grounded message)');

    // -------------------------------------------------------------
    // SCENARIO C: DISMISSAL
    // -------------------------------------------------------------
    console.log('\n[3/5] SCENARIO C — DISMISSAL: Closing panel, navigating to Powerbank & dwelling 16s...');
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

    // -------------------------------------------------------------
    // SCENARIO E: HEADPHONE PAGE GROUNDED GREETING & SUGGESTIONS
    // -------------------------------------------------------------
    console.log('\n[5/5] SCENARIO E — GROUNDED GREETING & CHIPS: Navigating to Ses Pro Kablosuz Kulaklık ANC...');
    await browser.navigate(`${TARGET_DEMO_URL}#/urun/ses-pro-kablosuz-kulaklik-anc`);
    await new Promise(r => setTimeout(r, 2000));

    // Open widget manually to verify greeting & suggestion chips
    await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const launcher = shadow?.querySelector('.samche-launcher');
        if (launcher) launcher.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    const headphoneState = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent.trim()) : [];
        const chips = shadow ? Array.from(shadow.querySelectorAll('.samche-chip')).map(el => el.textContent.trim()) : [];
        return {
          greeting: botMsgs[0] || '',
          chips: chips,
        };
      })()
    `);

    console.log(`      Observed Greeting: "${headphoneState.greeting}"`);
    console.log(`      Observed Suggestion Chips:`, headphoneState.chips);

    if (/kablosuz şarj/i.test(headphoneState.greeting)) {
      throw new Error(`SCENARIO E FAILED: Greeting falsely claims wireless charging on headphone page: "${headphoneState.greeting}"`);
    }
    if (/su geçirmez/i.test(headphoneState.greeting)) {
      throw new Error(`SCENARIO E FAILED: Greeting falsely claims waterproofing on headphone page: "${headphoneState.greeting}"`);
    }

    const hasAudioChips = headphoneState.chips.some(c => /ANC|LDAC|pil/i.test(c));
    if (!hasAudioChips) {
      throw new Error(`SCENARIO E FAILED: Suggestion chips not contextual to headphone audio/ANC/battery: ${JSON.stringify(headphoneState.chips)}`);
    }

    results.SCENARIO_E_GROUNDED_GREETING = 'PASS';
    console.log('      ✓ SCENARIO E: PASS (Headphone greeting and suggestions are grounded without false claims)');

    console.log('\n======================================================');
    console.log('REAL BROWSER PROACTIVE ACCEPTANCE: ALL 5 SCENARIOS PASS');
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
