import fs from 'node:fs';
import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

const RESULTS_FILE = 'C:/Users/smttb/Documents/samche-api-service/scripts/real_external_results.json';
const LOG_FILE = 'C:/Users/smttb/Documents/samche-api-service/scripts/real_external.log';

function log(msg) {
  console.log(msg);
  fs.appendFileSync(LOG_FILE, msg + '\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  fs.writeFileSync(LOG_FILE, '=== START REAL EXTERNAL DEMO SITE ACCEPTANCE TEST ===\n');
  const browser = await BrowserCdp.launch({ headless: true });
  await browser.send('Network.enable');
  await browser.setViewport({ width: 1440, height: 900 });

  const report = {};
  log('Target: https://demo.samchecompany.com/\n');

  async function inspectWidget() {
    return await browser.evaluate(`
      (() => {
        const host = document.querySelector('#samche-webchat-container');
        const shadow = host ? host.shadowRoot : null;
        if (!shadow) return { mounted: false };

        const launcher = shadow.querySelector('.samche-launcher');
        const panel = shadow.querySelector('.samche-panel');
        const msgs = Array.from(shadow.querySelectorAll('.samche-msg')).map(m => ({
          className: m.className,
          text: m.innerText.trim(),
          type: m.getAttribute('data-message-type'),
          isProactive: m.getAttribute('data-message-type') === 'PROACTIVE' || m.classList.contains('samche-proactive'),
          eventId: m.getAttribute('data-proactive-event-id'),
          entityId: m.getAttribute('data-entity-id'),
        }));
        const proactives = msgs.filter(m => m.isProactive);
        const cs = launcher ? window.getComputedStyle(launcher) : null;

        return {
          mounted: true,
          isOpen: panel ? panel.classList.contains('samche-open') : false,
          totalMessages: msgs.length,
          proactiveCount: proactives.length,
          proactiveMessages: proactives,
          messages: msgs,
          launcherStyles: cs ? {
            bg: cs.backgroundColor,
            color: cs.color,
            border: cs.border,
            width: parseFloat(cs.width),
            height: parseFloat(cs.height)
          } : null
        };
      })()
    `);
  }

  try {
    // TEST A: Home page -> dwell 16s -> NO PROACTIVE
    log('[Test A] Navigating to Home page...');
    await browser.navigate('https://demo.samchecompany.com/');
    await sleep(2500);

    const initHome = await inspectWidget();
    log(`   Home initial: Open=${initHome.isOpen}, Messages=${initHome.totalMessages}`);

    log('   Waiting 16s dwell on Home page...');
    await sleep(16000);

    const homeAfterDwell = await inspectWidget();
    log(`   Home after 16s: Proactives = ${homeAfterDwell.proactiveCount}`);
    if (homeAfterDwell.proactiveCount !== 0) {
      throw new Error(`FAIL: Home page triggered ${homeAfterDwell.proactiveCount} proactive messages`);
    }
    report.HOME_NO_PROACTIVE = 'PASS';
    log('   ✓ Test A PASS\n');

    // TEST B: Shop/category page -> dwell 16s -> NO PROACTIVE
    log('[Test B] Navigating to /shop...');
    await browser.navigate('https://demo.samchecompany.com/shop');
    await sleep(2500);

    log('   Waiting 16s dwell on /shop...');
    await sleep(16000);

    const shopAfterDwell = await inspectWidget();
    log(`   Shop after 16s: Proactives = ${shopAfterDwell.proactiveCount}`);
    if (shopAfterDwell.proactiveCount !== 0) {
      throw new Error(`FAIL: Shop page triggered ${shopAfterDwell.proactiveCount} proactive messages`);
    }
    report.SHOP_NO_PROACTIVE = 'PASS';
    log('   ✓ Test B PASS\n');

    // TEST C: Product A -> dwell >= 15s -> EXACTLY ONE PROACTIVE
    log('[Test C] Navigating to Product A (/samche-airpure-hepa-desktop-purifier)...');
    await browser.navigate('https://demo.samchecompany.com/samche-airpure-hepa-desktop-purifier');
    await sleep(3000);

    const pAInit = await inspectWidget();
    log(`   Product A initial: Proactives = ${pAInit.proactiveCount}, Open = ${pAInit.isOpen}`);

    log('   Waiting 17s for dwell threshold (15s) to qualify...');
    await sleep(17000);

    const pAAfter17s = await inspectWidget();
    log(`   Product A after dwell: Proactives = ${pAAfter17s.proactiveCount}, Open = ${pAAfter17s.isOpen}`);
    if (pAAfter17s.proactiveCount !== 1) {
      throw new Error(`FAIL: Product A has ${pAAfter17s.proactiveCount} proactive messages (expected exactly 1)`);
    }
    const msgA = pAAfter17s.proactiveMessages[0].text;
    log(`   Grounded Copy: "${msgA.slice(0, 80)}..."`);
    report.PRODUCT_A_15S_PROACTIVE = 'PASS';
    report.PRODUCT_A_COPY = msgA;
    log('   ✓ Test C PASS\n');

    // TEST D: Continue staying on Product A -> NO SECOND PROACTIVE
    log('[Test D] Staying on Product A for an additional 10s...');
    await sleep(10000);

    const pAStay = await inspectWidget();
    log(`   Product A after staying: Proactives = ${pAStay.proactiveCount}`);
    if (pAStay.proactiveCount !== 1) {
      throw new Error(`FAIL: Product A duplicate proactive count: ${pAStay.proactiveCount}`);
    }
    report.PRODUCT_A_NO_DUPLICATE = 'PASS';
    log('   ✓ Test D PASS\n');

    // TEST E: Navigate to Product B -> Dwell resets to 0 -> after 16s: exactly ONE Product B proactive
    log('[Test E] Navigating to Product B (/samche-thermalpro-1l-vacuum-flask)...');
    await browser.navigate('https://demo.samchecompany.com/samche-thermalpro-1l-vacuum-flask');
    await sleep(3000);

    const pBInit = await inspectWidget();
    log(`   Product B immediately: Proactives = ${pBInit.proactiveCount}`);

    log('   Waiting 17s for Product B dwell...');
    await sleep(17000);

    const pBAfterDwell = await inspectWidget();
    log(`   Product B after dwell: Total proactives = ${pBAfterDwell.proactiveCount}`);
    const pBProactives = (pBAfterDwell.proactiveMessages || []).filter(m => (m.entityId && m.entityId.includes('thermalpro')) || (m.text && (m.text.toLowerCase().includes('thermalpro') || m.text.toLowerCase().includes('vacuum flask') || m.text.toLowerCase().includes('flask'))));
    log(`   Product B specific proactives = ${pBProactives.length}`);
    if (pBProactives.length !== 1) {
      throw new Error(`FAIL: Product B should have exactly 1 proactive, got ${pBProactives.length}`);
    }
    report.PRODUCT_B_RESET_AND_PROACTIVE = 'PASS';
    report.PRODUCT_B_COPY = pBProactives[0].text;
    log('   ✓ Test E PASS\n');

    // TEST F: Return to Product A -> NO DUPLICATE PROACTIVE
    log('[Test F] Returning to Product A (/samche-airpure-hepa-desktop-purifier)...');
    await browser.navigate('https://demo.samchecompany.com/samche-airpure-hepa-desktop-purifier');
    await sleep(3000);

    log('   Waiting 17s on returned Product A...');
    await sleep(17000);

    const pAReturn = await inspectWidget();
    const pAReturnProactives = (pAReturn.proactiveMessages || []).filter(m => (m.entityId && m.entityId.includes('airpure')) || (m.text && (m.text.toLowerCase().includes('airpure') || m.text.toLowerCase().includes('purifier'))));
    log(`   Product A proactives after return = ${pAReturnProactives.length}`);
    if (pAReturnProactives.length > 1) {
      throw new Error(`FAIL: Product A duplicate on return: ${pAReturnProactives.length}`);
    }
    report.RETURN_NO_DUPLICATE = 'PASS';
    log('   ✓ Test F PASS\n');

    // TEST G: Clear Conversation -> fresh dwell cycle allows new proactive
    log('[Test G] Testing Clear Conversation on Product A...');
    await browser.evaluate(`
      (() => {
        const shadow = document.querySelector('#samche-webchat-container')?.shadowRoot;
        if (!shadow) return;
        const panel = shadow.querySelector('.samche-panel');
        if (!panel.classList.contains('samche-open')) {
          shadow.querySelector('.samche-launcher')?.click();
        }
        setTimeout(() => {
          shadow.querySelector('.samche-clear-btn')?.click();
          setTimeout(() => {
            shadow.querySelector('.samche-confirm-proceed')?.click();
          }, 400);
        }, 400);
      })()
    `);
    await sleep(3000);

    const afterClear = await inspectWidget();
    log(`   After Clear: Messages = ${afterClear.totalMessages}, Proactives = ${afterClear.proactiveCount}`);

    log('   Waiting 17s for fresh dwell cycle on Product A...');
    await sleep(17000);

    const freshDwellState = await inspectWidget();
    log(`   After fresh 17s dwell: Proactive count = ${freshDwellState.proactiveCount}`);
    if (freshDwellState.proactiveCount < 1) {
      throw new Error(`FAIL: Expected fresh proactive after Clear Conversation, got ${freshDwellState.proactiveCount}`);
    }
    report.CLEAR_CONVERSATION_FRESH_DWELL = 'PASS';
    log('   ✓ Test G PASS\n');

    // TEST H: Full reload on same entity preserves correct dedupe
    log('[Test H] Full page reload on Product A...');
    await browser.navigate('https://demo.samchecompany.com/samche-airpure-hepa-desktop-purifier');
    await sleep(3000);

    log('   Waiting 17s after reload...');
    await sleep(17000);

    const afterReload = await inspectWidget();
    const reloadProactives = (afterReload.proactiveMessages || []).filter(m => (m.entityId && m.entityId.includes('airpure')) || (m.text && (m.text.toLowerCase().includes('airpure') || m.text.toLowerCase().includes('purifier'))));
    log(`   Product A proactives after reload dwell = ${reloadProactives.length}`);
    if (reloadProactives.length > 1) {
      throw new Error(`FAIL: Full reload duplicated proactive message: ${reloadProactives.length}`);
    }
    report.RELOAD_DEDUPE_PASS = 'PASS';
    log('   ✓ Test H PASS\n');

    // Launcher & Visual Audit
    log('[Launcher & Visual Audit]');
    const visual = await browser.evaluate(`
      (() => {
        const shadow = document.querySelector('#samche-webchat-container')?.shadowRoot;
        const launcher = shadow.querySelector('.samche-launcher');
        const cs = window.getComputedStyle(launcher);
        const label = launcher.querySelector('.samche-launcher-label')?.innerText;
        return {
          bg: cs.backgroundColor,
          color: cs.color,
          border: cs.border,
          label: label,
          width: parseFloat(cs.width),
          height: parseFloat(cs.height)
        };
      })()
    `);
    log(`   Launcher: ${visual.label}, ${visual.width}x${visual.height}, bg=${visual.bg}, color=${visual.color}`);
    report.LAUNCHER_VISUAL = visual;
    report.SUCCESS = true;
    log('=== ALL REAL EXTERNAL ACCEPTANCE TESTS PASSED ===');
  } catch (err) {
    log(`\n!!! TEST FAILED: ${err.message}\n${err.stack}`);
    report.SUCCESS = false;
    report.ERROR = err.message;
  } finally {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(report, null, 2));
    await browser.close();
  }
}

run().catch(console.error);
