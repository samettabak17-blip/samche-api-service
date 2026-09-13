import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

async function runAuthoritativeAcceptance() {
  console.log('================================================================');
  console.log('  EXTERNAL AUTHORITATIVE ACCEPTANCE: https://demo.samchecompany.com/ ');
  console.log('================================================================\n');

  const browser = await BrowserCdp.launch({ headless: true });
  await browser.send('Network.enable');
  await browser.setViewport({ width: 1440, height: 900 });

  const networkEvents = [];
  browser.eventListeners.push((data) => {
    if (data.method === 'Network.requestWillBeSent') {
      const req = data.params.request;
      if (req.url.includes('/api/chat/page-context') || req.url.includes('/api/chat/bootstrap')) {
        networkEvents.push({
          url: req.url,
          method: req.method,
          postData: req.postData ? JSON.parse(req.postData) : null,
        });
      }
    }
  });

  try {
    console.log('Step 1: Navigating to https://demo.samchecompany.com/ ...');
    await browser.navigate('https://demo.samchecompany.com/');
    await new Promise((r) => setTimeout(r, 2500));

    // Audit J: Closed launcher contrast on white page
    const launcherAudit = await browser.evaluate(`
      (() => {
        const host = document.querySelector('#samche-webchat-container');
        if (!host || !host.shadowRoot) return { error: 'NO_HOST' };
        const launcher = host.shadowRoot.querySelector('.samche-launcher');
        if (!launcher) return { error: 'NO_LAUNCHER' };
        const label = launcher.querySelector('.samche-launcher-label');
        const csL = window.getComputedStyle(launcher);
        const csLabel = label ? window.getComputedStyle(label) : null;
        return {
          className: launcher.className,
          backgroundColor: csL.backgroundColor,
          backgroundImage: csL.backgroundImage,
          border: csL.border,
          color: csL.color,
          label: label ? label.textContent : null,
          labelColor: csLabel ? csLabel.color : null,
          boxShadow: csL.boxShadow
        };
      })()
    `);

    console.log('\n[Audit J - Closed Launcher Contrast]:');
    console.log('  Class:', launcherAudit.className);
    console.log('  Label:', launcherAudit.label);
    console.log('  Label Color:', launcherAudit.labelColor);
    console.log('  Background Color:', launcherAudit.backgroundColor);
    console.log('  Background Image:', launcherAudit.backgroundImage);

    // Audit M: No duplicate widget hosts
    const hostCount = await browser.evaluate(`document.querySelectorAll('#samche-webchat-container').length`);
    console.log('\n[Audit M - Host Count]:', hostCount);
    if (hostCount !== 1) throw new Error('Duplicate widget hosts detected: ' + hostCount);

    // Audit I & K: Open panel & check English composer placeholder
    await browser.evaluate(`
      (() => {
        const host = document.querySelector('#samche-webchat-container');
        host.shadowRoot.querySelector('.samche-launcher').click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const openPanelAudit = await browser.evaluate(`
      (() => {
        const host = document.querySelector('#samche-webchat-container');
        const panel = host.shadowRoot.querySelector('.samche-panel');
        const textarea = host.shadowRoot.querySelector('.samche-composer-input');
        const title = host.shadowRoot.querySelector('.samche-header-title');
        const status = host.shadowRoot.querySelector('.samche-header-status');
        const csP = window.getComputedStyle(panel);
        return {
          isOpen: panel.classList.contains('samche-open'),
          width: parseFloat(csP.width),
          height: parseFloat(csP.height),
          borderRadius: csP.borderRadius,
          title: title ? title.textContent : null,
          status: status ? status.textContent.trim() : null,
          placeholder: textarea ? textarea.placeholder : null,
          ariaLabel: textarea ? textarea.getAttribute('aria-label') : null,
        };
      })()
    `);

    console.log('\n[Audit I & K - Open Panel & Localization]:');
    console.log('  Is Open:', openPanelAudit.isOpen);
    console.log('  Dimensions: ' + openPanelAudit.width + 'x' + openPanelAudit.height + ' (radius: ' + openPanelAudit.borderRadius + ')');
    console.log('  Title:', openPanelAudit.title);
    console.log('  Placeholder:', openPanelAudit.placeholder);

    return {
      launcherAudit,
      hostCount,
      openPanelAudit,
      networkEvents,
    };
  } finally {
    await browser.close();
  }
}

runAuthoritativeAcceptance()
  .then((res) => {
    console.log('\nPRELIMINARY REAL EXTERNAL AUDIT COMPLETE.');
  })
  .catch((err) => {
    console.error('\nAUDIT ERROR:', err);
    process.exit(1);
  });
