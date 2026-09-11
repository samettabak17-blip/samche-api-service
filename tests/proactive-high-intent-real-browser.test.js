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

let serverSessionState = {
  dwellSecondsReceived: 0,
  pageContextReceived: null,
  proactiveMessageSent: false,
  dismissedAt: null,
};

test('Proactive E2E Setup: Start mock HTTP server and launch headless Edge/Chrome', async () => {
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
      const history = serverSessionState.proactiveMessageSent
        ? [{ role: 'assistant', content: 'Görünüşe göre Titan Akıllı Saat Pro modelini inceliyorsunuz.' }]
        : [];
      res.end(JSON.stringify({
        session: 'wch_sess_proactive_test_token_456',
        resumed: Boolean(serverSessionState.proactiveMessageSent),
        history,
        appearance: {
          title: 'SamChe Mağaza Asistanı',
          subtitle: 'Çevrimiçi Danışman',
          launcher_position: 'right',
          theme_mode: 'dark',
        },
        behavior: {
          language: 'tr',
          proactive_enabled: true,
          high_intent_activation: true,
          dwell_threshold_seconds: 2,
          cooldown_seconds: 300,
        },
        browsing_state: {
          engagement_state: {
            proactiveMessageSent: serverSessionState.proactiveMessageSent,
            dismissedAt: serverSessionState.dismissedAt,
          },
        },
      }));
      return;
    }

    if (url.pathname === '/api/chat/page-context') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          serverSessionState.pageContextReceived = parsed.page_context || null;
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          intent_state: 'MEDIUM',
          intent_score: 55,
          proactive_engagement: {
            should_open: false,
            should_engage: false,
            should_nudge: true,
            intent_state: 'MEDIUM',
            intent_score: 55,
            reason: 'MEDIUM_INTENT_NUDGE',
            message: null,
          },
        }));
      });
      return;
    }

    if (url.pathname === '/api/chat/evaluate-intent') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          serverSessionState.dwellSecondsReceived = parsed.dwell_seconds || 0;
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });

        if (serverSessionState.dismissedAt) {
          res.end(JSON.stringify({
            status: 'ok',
            intent_state: 'HIGH',
            intent_score: 80,
            proactive_engagement: {
              should_open: false,
              should_engage: false,
              reason: 'DISMISSAL_COOLDOWN',
              message: null,
            },
          }));
          return;
        }

        if (serverSessionState.proactiveMessageSent) {
          res.end(JSON.stringify({
            status: 'ok',
            intent_state: 'HIGH',
            intent_score: 80,
            proactive_engagement: {
              should_open: false,
              should_engage: false,
              reason: 'ALREADY_ENGAGED',
              message: null,
            },
          }));
          return;
        }

        if (serverSessionState.dwellSecondsReceived >= 2) {
          serverSessionState.proactiveMessageSent = true;
          res.end(JSON.stringify({
            status: 'ok',
            intent_state: 'HIGH',
            intent_score: 80,
            proactive_engagement: {
              should_open: true,
              should_engage: true,
              intent_state: 'HIGH',
              intent_score: 80,
              reason: 'HIGH_INTENT_ACTIVATION',
              message: 'Görünüşe göre Titan Akıllı Saat Pro modelini inceliyorsunuz.',
            },
          }));
        } else {
          res.end(JSON.stringify({
            status: 'ok',
            intent_state: 'MEDIUM',
            intent_score: 55,
            proactive_engagement: {
              should_open: false,
              should_engage: false,
              should_nudge: true,
              reason: 'MEDIUM_INTENT_NUDGE',
              message: null,
            },
          }));
        }
      });
      return;
    }

    if (url.pathname === '/api/chat/dismiss-proactive') {
      serverSessionState.dismissedAt = new Date().toISOString();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', dismissed: true }));
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

  try {
    browser = await BrowserCdp.launch({ headless: true });
    await browser.setViewport({ width: 1440, height: 900, isMobile: false });
  } catch (err) {
    console.log('Skipping browser tests: failed to launch browser:', err.message);
  }
});

test('SCENARIO A — LOW INTENT: Visitor arriving at catalog does not auto-open', async () => {
  if (!browser) return;
  await browser.navigate(`${baseUrl}/task8-demo/`);

  await new Promise(r => setTimeout(r, 1500));

  const state = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host?.shadowRoot;
      const panel = shadow?.querySelector('.samche-panel');
      const launcher = shadow?.querySelector('.samche-launcher');

      return {
        isPanelOpen: panel ? panel.classList.contains('samche-open') : false,
        hasPulse: launcher ? launcher.classList.contains('samche-intent-pulse') : false,
      };
    })()
  `);

  assert.equal(state.isPanelOpen, false, 'Panel must remain closed on catalog view (no aggressive auto-open)');
});

test('SCENARIO B — HIGH INTENT: Visitor navigates to product and dwells -> auto-opens with grounded copy', async () => {
  if (!browser) return;

  await browser.evaluate(`
    (() => {
      const detailBtn = document.querySelector('.product-card .btn-detail');
      if (detailBtn) detailBtn.click();
    })()
  `);

  // Assert NEGATIVE TIMING: immediately upon arrival (<1s, well before dwell threshold), widget MUST remain closed
  await new Promise(r => setTimeout(r, 500));
  const earlyCheck = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host?.shadowRoot;
      const panel = shadow?.querySelector('.samche-panel');
      return panel ? panel.classList.contains('samche-open') : false;
    })()
  `);
  assert.equal(earlyCheck, false, 'NEGATIVE TIMING: Widget must NOT auto-open prematurely upon product arrival');

  let opened = false;
  let botMessage = '';
  for (let attempt = 0; attempt < 35; attempt++) {
    await new Promise(r => setTimeout(r, 150));
    const check = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const panel = shadow?.querySelector('.samche-panel');
        const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent) : [];

        return {
          isOpen: panel ? panel.classList.contains('samche-open') : false,
          botMsgs: botMsgs
        };
      })()
    `);

    if (check.isOpen && check.botMsgs.length > 0) {
      opened = true;
      botMessage = check.botMsgs[check.botMsgs.length - 1];
      break;
    }
  }

  assert.ok(opened, 'Widget must automatically open when qualified dwell is achieved on product detail');
  assert.ok(botMessage.includes('Titan Akıllı Saat Pro'), `Proactive copy must ground to current product: "${botMessage}"`);
  assert.equal(serverSessionState.proactiveMessageSent, true, 'Server must mark proactiveMessageSent = true');
});

test('SCENARIO C — DISMISSAL: Closing the panel triggers dismissal cooldown and does not reopen', async () => {
  if (!browser) return;

  await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host?.shadowRoot;
      const closeBtn = shadow?.querySelector('.samche-close-btn');
      if (closeBtn) closeBtn.click();
    })()
  `);

  await new Promise(r => setTimeout(r, 400));

  const closedCheck = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host?.shadowRoot;
      const panel = shadow?.querySelector('.samche-panel');
      return panel ? panel.classList.contains('samche-open') : false;
    })()
  `);
  assert.equal(closedCheck, false, 'Panel must close after clicking close button');

  await browser.evaluate(`
    (() => {
      document.getElementById('nav-catalog').click();
    })()
  `);
  await new Promise(r => setTimeout(r, 500));

  await browser.evaluate(`
    (() => {
      const detailBtn = document.querySelector('.product-card .btn-detail');
      if (detailBtn) detailBtn.click();
    })()
  `);
  await new Promise(r => setTimeout(r, 2500));

  const reopenCheck = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host?.shadowRoot;
      const panel = shadow?.querySelector('.samche-panel');
      return panel ? panel.classList.contains('samche-open') : false;
    })()
  `);
  assert.equal(reopenCheck, false, 'Panel must NOT reopen after dismissal during cooldown window');
});

test('SCENARIO D — REFRESH: Full page refresh does not duplicate proactive message', async () => {
  if (!browser) return;

  await browser.navigate(`${baseUrl}/task8-demo/#/urun/titan-akilli-saat-pro`);
  await new Promise(r => setTimeout(r, 1000));

  const refreshState = await browser.evaluate(`
    (() => {
      const host = document.getElementById('samche-webchat-container');
      const shadow = host?.shadowRoot;
      const panel = shadow?.querySelector('.samche-panel');
      const botMsgs = shadow ? Array.from(shadow.querySelectorAll('.samche-msg-bot')).map(el => el.textContent) : [];

      return {
        isOpen: panel ? panel.classList.contains('samche-open') : false,
        botMsgs: botMsgs,
      };
    })()
  `);

  assert.equal(refreshState.isOpen, false, 'Widget must not aggressively auto-open again on refresh');
  const matchingProactiveMsgs = refreshState.botMsgs.filter(m => m.includes('Titan Akıllı Saat Pro'));
  assert.ok(matchingProactiveMsgs.length <= 1, 'Proactive message must not be duplicated on page refresh');
});

test('Proactive E2E Teardown: Close browser and mock server', async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});
