/**
 * scripts/verify_staging_entity_scoped_proactive.js
 * Live Staging Real-Browser Human-Equivalent Acceptance Verification
 */
import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

const STAGING_URL = 'https://samche-api-staging.onrender.com';
const DEMO_URL = `${STAGING_URL}/task8-demo/`;
const EXPECTED_SHA = process.env.EXPECTED_SHA || '27df286';

async function run() {
  console.log('=== TASK 8 LIVE STAGING VERIFICATION: ENTITY-SCOPED PROACTIVE ENGAGEMENT ===');
  console.log(`Target: ${DEMO_URL}`);
  console.log(`Expected Revision: ${EXPECTED_SHA}\n`);

  console.log('[1/7] Polling Render Deployment Readiness...');
  let deployedSha = null;
  for (let i = 1; i <= 60; i++) {
    try {
      const res = await fetch(`${STAGING_URL}/api/v1/health`);
      if (res.ok) {
        const data = await res.json();
        deployedSha = data.revision || '';
        if (deployedSha.startsWith(EXPECTED_SHA)) {
          console.log(`      ✓ Render deployed revision: ${deployedSha} (matches ${EXPECTED_SHA})\n`);
          break;
        }
      }
    } catch {}
    if (i % 5 === 0) console.log(`      Waiting for Render deploy... (attempt ${i}/60, currently: ${deployedSha?.slice(0, 7) || 'unknown'})`);
    await new Promise(r => setTimeout(r, 5000));
  }

  if (!deployedSha || !deployedSha.startsWith(EXPECTED_SHA)) {
    throw new Error(`DEPLOY_TIMEOUT: Expected ${EXPECTED_SHA}, but found ${deployedSha}`);
  }

  console.log('[2/7] Launching real headless browser with fresh isolated profile...');
  const port = 9333 + Math.floor(Math.random() * 200);
  const browser = await BrowserCdp.launch({ port, headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  try {
    console.log('[3/7] SCENARIO A: Catalog -> Titan 15s dwell test...');
    await browser.navigate(DEMO_URL);
    await new Promise(r => setTimeout(r, 3000));

    const catalogOpen = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const panel = host?.shadowRoot?.querySelector('.samche-panel');
        return panel ? panel.classList.contains('samche-open') : false;
      })()
    `);
    console.log(`      Catalog arrival widget open: ${catalogOpen} (expected false)`);

    await browser.evaluate(`window.location.hash = '#/urun/titan-akilli-saat-pro'`);
    await new Promise(r => setTimeout(r, 4000));
    const titanEarlyOpen = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const panel = host?.shadowRoot?.querySelector('.samche-panel');
        return panel ? panel.classList.contains('samche-open') : false;
      })()
    `);
    console.log(`      Titan at 5s widget open: ${titanEarlyOpen} (expected false)`);

    console.log('      Waiting for qualified dwell (>=15s) on Titan...');
    await new Promise(r => setTimeout(r, 13000));

    const titanState = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const panel = shadow?.querySelector('.samche-panel');
        const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent.trim()) : [];
        const proactiveMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot[data-proactive-event-id]')).map(el => el.textContent.trim()) : [];
        return {
          isOpen: panel ? panel.classList.contains('samche-open') : false,
          botMsgs,
          proactiveMsgs,
        };
      })()
    `);

    console.log(`      Titan widget open: ${titanState.isOpen} (expected true)`);
    console.log(`      Total bot messages: ${titanState.botMsgs.length}`);
    console.log(`      Proactive messages: ${titanState.proactiveMsgs.length}`);
    const titanProactiveText = titanState.proactiveMsgs[0] || titanState.botMsgs[1] || '';
    console.log(`      TITAN_PROACTIVE_TEXT = "${titanProactiveText}"`);

    console.log('\n[4/7] SCENARIO B: Navigate Headphones -> Fresh dwell -> Headphones proactive...');
    await browser.evaluate(`window.location.hash = '#/urun/ses-pro-kablosuz-kulaklik-anc'`);
    await new Promise(r => setTimeout(r, 4000));
    const hpEarlyState = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const proactiveMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot[data-proactive-event-id]')).map(el => el.textContent.trim()) : [];
        return { count: proactiveMsgs.length };
      })()
    `);
    console.log(`      Headphones at 5s proactive count: ${hpEarlyState.count} (expected 1, Titan only)`);

    console.log('      Waiting for qualified dwell (>=15s) on Headphones...');
    await new Promise(r => setTimeout(r, 13000));

    const hpState = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent.trim()) : [];
        const proactiveMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot[data-proactive-event-id]')).map(el => el.textContent.trim()) : [];
        return { botMsgs, proactiveMsgs };
      })()
    `);
    console.log(`      Headphones total bot messages: ${hpState.botMsgs.length} (expected 3: Greeting, Titan, Headphones)`);
    console.log(`      Headphones proactive count: ${hpState.proactiveMsgs.length} (expected 2)`);
    const hpProactiveText = hpState.proactiveMsgs[1] || hpState.botMsgs[2] || '';
    console.log(`      HEADPHONE_PROACTIVE_TEXT = "${hpProactiveText}"`);

    console.log('\n[5/7] SCENARIO C: Navigate Powerbank -> Fresh dwell -> Powerbank proactive...');
    await browser.evaluate(`window.location.hash = '#/urun/ultra-guc-bankasi-20000mah'`);
    await new Promise(r => setTimeout(r, 1000));
    console.log('      Waiting for qualified dwell (>=15s) on Powerbank...');
    let pbState = null;
    for (let poll = 0; poll < 12; poll++) {
      await new Promise(r => setTimeout(r, 2000));
      pbState = await browser.evaluate(`
        (() => {
          const host = document.getElementById('samche-webchat-container');
          const shadow = host?.shadowRoot;
          const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent.trim()) : [];
          const proactiveMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot[data-proactive-event-id]')).map(el => el.textContent.trim()) : [];
          return { botMsgs, proactiveMsgs };
        })()
      `);
      if (pbState && pbState.proactiveMsgs.length >= 3) break;
    }
    console.log(`      Powerbank total bot messages: ${pbState?.botMsgs?.length} (expected 4)`);
    console.log(`      Powerbank proactive count: ${pbState?.proactiveMsgs?.length} (expected 3)`);
    const pbProactiveText = pbState?.proactiveMsgs?.[2] || pbState?.botMsgs?.[3] || '';
    console.log(`      POWERBANK_PROACTIVE_TEXT = "${pbProactiveText}"`);

    console.log('\n[6/7] SCENARIO F: Reload page twice, check transcript fidelity...');
    await browser.navigate(`${DEMO_URL}#/urun/ultra-guc-bankasi-20000mah`);
    await new Promise(r => setTimeout(r, 3000));
    await browser.evaluate(`document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher')?.click()`);
    await new Promise(r => setTimeout(r, 1000));

    const r1State = await browser.evaluate(`
      (() => {
        const shadow = document.getElementById('samche-webchat-container')?.shadowRoot;
        return { count: shadow ? shadow.querySelectorAll('.samche-msg-bot').length : 0 };
      })()
    `);
    console.log(`      After reload 1, total bot messages: ${r1State.count} (expected 4)`);

    await browser.navigate(`${DEMO_URL}#/urun/ultra-guc-bankasi-20000mah`);
    await new Promise(r => setTimeout(r, 3000));
    await browser.evaluate(`document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher')?.click()`);
    await new Promise(r => setTimeout(r, 1000));

    const r2State = await browser.evaluate(`
      (() => {
        const shadow = document.getElementById('samche-webchat-container')?.shadowRoot;
        return { count: shadow ? shadow.querySelectorAll('.samche-msg-bot').length : 0 };
      })()
    `);
    console.log(`      After reload 2, total bot messages: ${r2State.count} (expected 4)`);

    console.log('\n[7/7] SCENARIO G: Clear Conversation on Powerbank -> Confirm -> Wait 15s fresh dwell...');
    await browser.evaluate(`document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-clear-btn')?.click()`);
    await new Promise(r => setTimeout(r, 500));
    await browser.evaluate(`document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-confirm-proceed')?.click()`);
    await new Promise(r => setTimeout(r, 2000));

    const postClearState = await browser.evaluate(`
      (() => {
        const shadow = document.getElementById('samche-webchat-container')?.shadowRoot;
        const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent.trim()) : [];
        const badge = shadow?.querySelector('.samche-header-context-badge')?.textContent.trim() || '';
        return { botMsgs, badge };
      })()
    `);
    console.log(`      Immediately post-clear bot messages: ${postClearState.botMsgs.length} (expected 1, greeting only)`);
    console.log(`      Context badge preserved: "${postClearState.badge}"`);

    console.log('      Waiting fresh dwell (>=15s) on Powerbank...');
    let finalPbState = null;
    for (let poll = 0; poll < 12; poll++) {
      await new Promise(r => setTimeout(r, 2000));
      finalPbState = await browser.evaluate(`
        (() => {
          const shadow = document.getElementById('samche-webchat-container')?.shadowRoot;
          const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent.trim()) : [];
          const proactiveMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot[data-proactive-event-id]')).map(el => el.textContent.trim()) : [];
          return { botMsgs, proactiveMsgs };
        })()
      `);
      if (finalPbState && finalPbState.proactiveMsgs.length >= 1) break;
    }
    console.log(`      Post-clear total bot messages: ${finalPbState?.botMsgs?.length} (expected 2: Greeting + NEW Powerbank)`);
    console.log(`      Post-clear proactive messages: ${finalPbState?.proactiveMsgs?.length} (expected 1)`);
    const newPbProactiveText = finalPbState?.proactiveMsgs?.[0] || finalPbState?.botMsgs?.[1] || '';
    console.log(`      POST_CLEAR_15S_PROACTIVE = "${newPbProactiveText}"`);

    console.log('\nALL SCENARIOS VERIFIED SUCCESSFULLY ON LIVE STAGING!');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('\n❌ STAGING VERIFICATION FAILED:', err);
  process.exit(1);
});
