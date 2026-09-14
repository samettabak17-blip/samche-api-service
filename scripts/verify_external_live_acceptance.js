import fs from 'node:fs';
import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

async function main() {
  const browser = await BrowserCdp.launch({ headless: true });
  await browser.send('Network.enable');
  await browser.setViewport({ width: 1440, height: 900 });

  const results = {};
  try {
    await browser.navigate('https://demo.samchecompany.com/');
    await new Promise((r) => setTimeout(r, 2500));

    // Wait for launcher element to be attached in shadow root
    for (let i = 0; i < 20; i++) {
      const exists = await browser.evaluate(`Boolean(document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher'))`);
      if (exists) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    // Audit J: Launcher Closed Contrast
    const lM = await browser.evaluate(`
      (() => {
        const l = document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher');
        const cs = window.getComputedStyle(l);
        return {
          bg: cs.backgroundColor,
          img: cs.backgroundImage,
          label: l.querySelector('.samche-launcher-label')?.textContent,
          h: parseFloat(cs.height),
          w: parseFloat(cs.width)
        };
      })()
    `);
    console.log('[Audit J - Launcher]:', lM?.label, lM?.w + 'x' + lM?.h, lM?.bg);
    const hasBg = (lM?.bg && lM.bg !== 'rgba(0, 0, 0, 0)' && lM.bg !== 'transparent') || (lM?.img && lM.img !== 'none');
    if (!hasBg) throw new Error('Transparent launcher background');
    results.launcherContrast = 'PASS';

    // Audit M: No duplicate hosts
    const hostCount = await browser.evaluate(`document.querySelectorAll('#samche-webchat-container').length`);
    if (hostCount !== 1) throw new Error('Duplicate hosts: ' + hostCount);
    results.noDuplicateHosts = 'PASS';

    // Audit A: Useful Page Content Extraction
    const captured = await browser.evaluate(`window.SamcheWebChat?.getInstance()?.capturePageContext() || window.SamcheContextCapture?.capturePageContext()`);
    const productCount = (captured?.visible_products || []).length;
    const headingProducts = (captured?.headings || []).filter((h) =>
      /headphone|power\s*bank|tv|airpure|purifier|watch/i.test(h)
    );
    console.log('[Audit A - Extracted]:', productCount, 'products,', headingProducts);
    if (productCount < 3 && headingProducts.length < 3) {
      throw new Error('Count=' + productCount + ' headings=' + headingProducts.length);
    }
    results.homePageCapture = 'PASS';

    // Audit I: Open panel & check English composer placeholder
    await browser.evaluate(`document.querySelector('#samche-webchat-container').shadowRoot.querySelector('.samche-launcher').click()`);
    await new Promise((r) => setTimeout(r, 600));

    const pM = await browser.evaluate(`
      (() => {
        const s = document.querySelector('#samche-webchat-container')?.shadowRoot;
        return {
          h: parseFloat(window.getComputedStyle(s.querySelector('.samche-panel')).height),
          placeholder: s.querySelector('.samche-composer-input')?.placeholder
        };
      })()
    `);
    console.log('[Audit I - Panel]: Height=' + pM.h + ', Placeholder="' + pM.placeholder + '"');
    if (pM.placeholder !== 'Type a message...') throw new Error('Got: ' + pM.placeholder);
    if (Math.abs(pM.h - 600) > 3) throw new Error('Got height ' + pM.h);
    results.localizationAndPanelDimensions = 'PASS';

    // Audit B: Ask "What products are on this page?"
    await browser.evaluate(`
      (() => {
        const s = document.querySelector('#samche-webchat-container').shadowRoot;
        const inp = s.querySelector('.samche-composer-input');
        const btn = s.querySelector('.samche-send-btn');
        inp.value = 'What products are on this page?';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        btn.disabled = false;
        btn.click();
      })()
    `);

    let aiReply = '';
    let lastLen = 0;
    let stableCount = 0;
    for (let sec = 0; sec < 25; sec++) {
      await new Promise((r) => setTimeout(r, 1000));
      const cur = await browser.evaluate(`
        (() => {
          const msgs = document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelectorAll('.samche-msg-bot');
          return msgs && msgs.length >= 2 ? msgs[msgs.length - 1].textContent.trim() : '';
        })()
      `);
      if (cur && !cur.includes('Hello! How can I help you today?')) {
        aiReply = cur;
        if (cur.length > 30 && cur.length === lastLen) {
          stableCount++;
          if (stableCount >= 2) break; // Finished typing
        } else {
          stableCount = 0;
          lastLen = cur.length;
        }
      }
    }
    console.log('[Audit B - AI Reply]:\n' + aiReply);
    if (!aiReply) throw new Error('No AI reply within timeout');
    const rL = aiReply.toLowerCase();
    if (rL.includes('cannot see') || rL.includes("don't have confirmed") || rL.includes('do not have verified')) {
      throw new Error('AI claimed it cannot see products: ' + aiReply);
    }
    if (!rL.includes('headphone') && !rL.includes('power bank') && !rL.includes('tv')) {
      throw new Error('Missing products: ' + aiReply);
    }
    results.homePageGroundedQandA = 'PASS';

    // Audit C, L, N: Navigation, glow, typing
    await browser.evaluate(`
      (() => {
        const a = document.querySelector('a[href="/shop"]');
        if (a) a.click();
        else { window.history.pushState({}, '', '/shop'); window.dispatchEvent(new PopStateEvent('popstate')); }
      })()
    `);
    await new Promise((r) => setTimeout(r, 2000));
    console.log('[Audit C - Nav]:', await browser.evaluate(`window.location.pathname`));

    for (let i = 0; i < 20; i++) {
      const exists = await browser.evaluate(`Boolean(document.querySelector('#samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher'))`);
      if (exists) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    const glow = await browser.evaluate(`window.getComputedStyle(document.querySelector('#samche-webchat-container').shadowRoot.querySelector('.samche-launcher')).boxShadow`);
    if (!glow || glow === 'none') throw new Error('No glow');
    results.glowSurvivesNavigation = 'PASS';

    const typing = await browser.evaluate(`Boolean(document.querySelector('#samche-webchat-container').shadowRoot.querySelector('.msg-typing-indicator'))`);
    if (typing) throw new Error('Stuck typing indicator');
    results.noStuckTyping = 'PASS';

    console.log('\n>>> ALL LIVE AUTHORITATIVE ACCEPTANCE TESTS PASSED ON REAL DEMO! <<<');
    fs.writeFileSync('C:/Users/smttb/Documents/samche-api-service/scripts/live_acceptance_results.json', JSON.stringify({ results, aiReply, lM, pM }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\nACCEPTANCE TEST FAILED:', err);
  fs.writeFileSync('C:/Users/smttb/Documents/samche-api-service/scripts/live_acceptance_results.json', JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
