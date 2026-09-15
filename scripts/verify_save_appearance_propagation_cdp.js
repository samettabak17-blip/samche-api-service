import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserCdp } from '../tests/helpers/browser-cdp.js';
import { normalizeWebChatAppearance } from '../services/tenant-web-chat-provisioning-service.js';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(rootDir, 'dashboard', 'dist');
const PUBLIC_DIR = path.resolve(rootDir, 'public');

let currentConfigVersion = 1000;
let storedChannelState = {
  tenant_id: 'test-tenant-123',
  configured: true,
  widget_key: 'wch_real_ui_verify',
  config_version: currentConfigVersion,
  channel: {
    id: 'ch-web-1',
    channel_type: 'WEB_CHAT',
    display_name: 'Staging Live Support',
    status: 'active',
  },
  assistant: {
    id: 'ast-1',
    tenant_id: 'test-tenant-123',
    name: 'Staging Assistant',
    model: 'gpt-4o-mini',
    status: 'active',
  },
  integration: {
    id: 'int-1',
    integration_key: 'wch_real_ui_verify',
    integration_type: 'WEB_CHAT',
    enabled: true,
  },
  appearance: normalizeWebChatAppearance({
    brand_name: 'Acme Test Corp',
    title: 'Customer Care',
    subtitle: 'We typically reply in seconds',
    logo_asset_id: null,
    logo_url: null,
    theme_mode: 'dark',
    primary_color: '#0B5FFF',
    accent_color: '#10B981',
    launcher_label: 'Chat with Us',
    launcher_position: 'right',
    launcher_icon: 'chat',
    launcher_style: 'pill',
    launcher_theme_mode: 'custom',
    launcher_background: '#0F172A',
    launcher_foreground: '#FFFFFF',
    launcher_border_color: '#2563EB',
    launcher_glow_color: '#1D4ED8',
    launcher_logo_background: '#1E293B',
    launcher_logo_border_color: '#3B82F6',
    config_version: currentConfigVersion,
  }),
  behavior: {
    proactive_enabled: false,
    high_intent_activation: false,
    dwell_threshold_seconds: 15,
    cooldown_seconds: 300,
    language: 'auto',
  },
  embed_snippet: '<script src="/public/web-chat.js" data-widget-key="wch_real_ui_verify"></script>',
  installation: {
    widget_key: 'wch_real_ui_verify',
    embed_snippet: '<script src="/public/web-chat.js" data-widget-key="wch_real_ui_verify"></script>',
    status: 'active',
    guidance: [],
  },
  bootstrap_config: {
    widget_key: 'wch_real_ui_verify',
    api_endpoint: '/api/chat/bootstrap',
    config_version: currentConfigVersion,
  },
};

function createVerificationServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    console.log('[SERVER REQ]', req.method, pathname);

    const sendJson = (status, obj) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': '*',
      });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': '*',
      });
      return res.end();
    }

    if (pathname.startsWith('/public/')) {
      const rel = pathname.replace('/public/', '');
      const filePath = path.join(PUBLIC_DIR, rel);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, {
          'Content-Type': filePath.endsWith('.js') ? 'application/javascript' : 'text/plain',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Access-Control-Allow-Origin': '*',
        });
        return fs.createReadStream(filePath).pipe(res);
      }
    }

    if (pathname.startsWith('/assets/')) {
      const rel = pathname.replace(/^\/+/, '');
      const filePath = path.join(DIST_DIR, rel);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, {
          'Content-Type': pathname.endsWith('.js')
            ? 'application/javascript'
            : pathname.endsWith('.css')
            ? 'text/css'
            : 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        });
        return fs.createReadStream(filePath).pipe(res);
      }
    }

    if (pathname === '/task8-demo/' || pathname === '/task8-demo/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Public Storefront Parity Acceptance</title>
          <style>body { margin: 0; padding: 40px; background: #0f172a; color: white; font-family: sans-serif; }</style>
        </head>
        <body>
          <h1>Public WebChat Storefront Parity Target</h1>
          <script src="/public/web-chat.js" data-widget-key="wch_real_ui_verify"></script>
        </body>
        </html>
      `);
    }

    if (pathname === '/api/v1/auth/login') {
      return sendJson(200, {
        token: 'mock-verification-token',
        user: { id: 'u-1', email: 'admin@samchecompany.com', system_role: 'OWNER', status: 'ACTIVE' },
      });
    }

    if (pathname === '/api/v1/auth/me') {
      return sendJson(200, {
        user: { id: 'u-1', email: 'admin@samchecompany.com', system_role: 'OWNER', status: 'ACTIVE' },
      });
    }

    if (pathname === '/api/v1/tenants') {
      return sendJson(200, [
        { id: 'test-tenant-123', name: 'Acme Test Corp', plan_code: 'BUSINESS', status: 'active', role: 'OWNER' },
      ]);
    }

    if (pathname.includes('/dashboard/overview')) {
      return sendJson(200, {
        range_days: 7,
        range: { start_date: '', end_date: '', previous_start_date: '', previous_end_date: '' },
        kpis: { total_conversations: 0, new_leads: 0, appointments: 0, automations: 0, satisfaction_rate: 0, conversation_growth: 0 },
        conversation_timeseries: [],
        channel_distribution: [],
        top_intents: [],
        recent_conversations: [],
        insights: {},
        ai_performance: {
          response_rate: 0,
          average_response_time_ms: null,
          containment_rate: 0,
          satisfaction_rate: 0,
        },
      });
    }

    if (pathname === '/api/v1/tenants/test-tenant-123/assistants') {
      return sendJson(200, [{ id: 'ast-1', name: 'Staging Assistant', model: 'gpt-4o-mini', status: 'active' }]);
    }

    if (pathname === '/api/v1/tenants/test-tenant-123/channels/web-chat') {
      if (req.method === 'GET') {
        return sendJson(200, storedChannelState);
      }
      if (req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          console.log('[SERVER PUT BODY]', body);
          try {
            const parsed = JSON.parse(body);
            currentConfigVersion += 1000;
            const updatedAppearance = normalizeWebChatAppearance({
              ...storedChannelState.appearance,
              ...parsed.appearance,
              config_version: currentConfigVersion,
              updated_at: new Date(currentConfigVersion).toISOString(),
            });
            storedChannelState = {
              ...storedChannelState,
              widget_key: parsed.widget_key || storedChannelState.widget_key,
              config_version: currentConfigVersion,
              appearance: updatedAppearance,
              behavior: { ...storedChannelState.behavior, ...parsed.behavior },
              bootstrap_config: {
                ...storedChannelState.bootstrap_config,
                config_version: currentConfigVersion,
              },
            };
            return sendJson(200, storedChannelState);
          } catch (e) {
            return sendJson(400, { error: e.message });
          }
        });
        return;
      }
    }

    if (pathname.includes('/theme-preview') || pathname.includes('/preview')) {
      return sendJson(200, { contrast: { primary_button: 5.5, accent_pill: 5.0 } });
    }

    if (pathname.includes('/plan-upgrade-notifications')) {
      return sendJson(200, { notifications: [] });
    }

    if (pathname.includes('/invitations')) {
      return sendJson(200, []);
    }

    if (pathname.includes('/channels')) {
      return sendJson(200, [storedChannelState.channel]);
    }

    if (pathname.includes('/conversations/human-attention-summary')) {
      return sendJson(200, { requested_count: 0, escalated_count: 0 });
    }

    if (pathname === '/service-worker.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end('// sw');
    }

    if (pathname === '/manifest.webmanifest') {
      return sendJson(200, {});
    }

    if (pathname === '/api/chat/bootstrap') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return sendJson(200, {
        status: 'ok',
        session: 'mock-verified-session-token-123',
        resumed: false,
        config_version: storedChannelState.config_version,
        assistant: storedChannelState.assistant,
        appearance: storedChannelState.appearance,
        behavior: storedChannelState.behavior,
      });
    }

    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }

    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function run() {
  console.log('================================================================');
  console.log('  ACCEPTANCE: REAL SAVE APPEARANCE PROPAGATION TO PUBLIC WIDGET ');
  console.log('================================================================\n');

  const { server, origin } = await createVerificationServer();
  console.log(`Verification Server running at: ${origin}`);

  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  browser.eventListeners.push((evt) => {
    if (evt.method === 'Runtime.consoleAPICalled') {
      console.log('[BROWSER CONSOLE]', evt.params.type, evt.params.args?.map(a => a.value || a.description).join(' '));
    }
    if (evt.method === 'Runtime.exceptionThrown') {
      console.log('[BROWSER EXCEPTION]', evt.params.exceptionDetails?.text, evt.params.exceptionDetails?.exception?.description);
    }
  });

  try {
    // 1. Log in to Dashboard via real login form
    console.log('[Step 0] Logging into Dashboard via real login form...');
    await browser.navigate(`${origin}/login`);

    for (let i = 0; i < 40; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.querySelector('input[type="email"]') && document.querySelector('input[type="password"]') && document.querySelector('button[type="submit"]'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await browser.evaluate(`
      (() => {
        const emailInput = document.querySelector('input[type="email"]');
        const passInput = document.querySelector('input[type="password"]');
        const submitBtn = document.querySelector('button[type="submit"]');

        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputSetter.call(emailInput, 'admin@samchecompany.com');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));

        nativeInputSetter.call(passInput, 'CorrectPassword123!');
        passInput.dispatchEvent(new Event('input', { bubbles: true }));

        submitBtn.click();
      })()
    `);
    
    // Wait for login redirect
    for (let i = 0; i < 40; i++) {
      const p = await browser.evaluate(`window.location.pathname`).catch(() => '');
      if (p && !p.includes('/login')) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // 2. Navigate to Dashboard Web Chat Management
    console.log('[Step 1] Navigating to Dashboard Web Chat Management...');
    await browser.evaluate(`
      (() => {
        const channelsLink = Array.from(document.querySelectorAll('a')).find(a => a.href.endsWith('/channels'));
        if (channelsLink) channelsLink.click();
      })()
    `);

    for (let i = 0; i < 40; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(Array.from(document.querySelectorAll('a')).find(a => a.href.includes('/channels/web-chat')))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await browser.evaluate(`
      (() => {
        const webChatLink = Array.from(document.querySelectorAll('a')).find(a => a.href.includes('/channels/web-chat'));
        if (webChatLink) webChatLink.click();
      })()
    `);

    for (let i = 0; i < 40; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Appearance & Theme')))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Open Appearance & Theme tab
    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.innerText.includes('Appearance & Theme'));
        if (tab) tab.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.querySelector('[data-testid="launcher-bg-control"]'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // =========================================================================
    // TEST A & B: Set custom launcher background (#7C3AED) & Save Appearance
    // =========================================================================
    console.log('\n[Test A & B] Setting custom launcher background to #7C3AED and saving...');
    const vBeforeAB = storedChannelState.config_version;
    await browser.evaluate(`
      (() => {
        const bgControl = document.querySelector('[data-testid="launcher-bg-control"]');
        const valInput = bgControl ? bgControl.querySelector('[data-testid="launcher-bg-control-value"]') : null;
        if (valInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(valInput, '#7C3AED');
          } else {
            valInput.value = '#7C3AED';
          }
          valInput.dispatchEvent(new Event('input', { bubbles: true }));
          valInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const btns = Array.from(document.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText.includes('Save Appearance'));
        if (saveBtn) saveBtn.click();
      })()
    `);
    
    for (let i = 0; i < 30; i++) {
      if (storedChannelState.config_version > vBeforeAB) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('  ✓ Saved successfully. Server stored config_version:', storedChannelState.config_version);

    // =========================================================================
    // TEST C & D: Reload public site -> Launcher reflects new background
    // =========================================================================
    console.log('[Test C & D] Reloading public site and verifying launcher background...');
    await browser.navigate(`${origin}/task8-demo/`);
    
    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const checkCD = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const launcher = shadow?.querySelector('.samche-launcher');
        const cs = launcher ? window.getComputedStyle(launcher) : null;
        return {
          hasLauncher: !!launcher,
          bgColor: cs ? cs.backgroundColor : null,
          cssVarBg: cs ? cs.getPropertyValue('--chat-launcher-bg') : null,
        };
      })()
    `);
    console.log('  Public widget launcher background:', checkCD.bgColor, 'var:', checkCD.cssVarBg);
    if (!checkCD.hasLauncher) throw new Error('Public launcher missing');
    if (checkCD.bgColor !== 'rgb(124, 58, 237)') {
      throw new Error(`Expected launcher background rgb(124, 58, 237), got ${checkCD.bgColor}`);
    }
    console.log('  ✓ PASS: Launcher reflects new custom background (#7C3AED) on reload');

    // =========================================================================
    // TEST E & F: Set logo background transparent & Save
    // =========================================================================
    console.log('\n[Test E & F] Navigating back to Dashboard, setting logo background transparent, and saving...');
    await browser.evaluate(`window.history.back()`);

    for (let i = 0; i < 40; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Appearance & Theme')))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.innerText.includes('Appearance & Theme'));
        if (tab) tab.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.querySelector('[data-testid="launcher-logo-bg-control"]'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const vBeforeEF = storedChannelState.config_version;
    await browser.evaluate(`
      (() => {
        const logoBgControl = document.querySelector('[data-testid="launcher-logo-bg-control"]');
        const transBtn = logoBgControl ? logoBgControl.querySelector('[data-testid="launcher-logo-bg-control-transparent-btn"]') : null;
        if (transBtn) transBtn.click();

        const btns = Array.from(document.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText.includes('Save Appearance'));
        if (saveBtn) saveBtn.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      if (storedChannelState.config_version > vBeforeEF) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('  ✓ Saved successfully. Server stored config_version:', storedChannelState.config_version);

    // =========================================================================
    // TEST G & H: Reload public -> Logo container becomes transparent
    // =========================================================================
    console.log('[Test G & H] Reloading public site and verifying logo badge background...');
    await browser.navigate(`${origin}/task8-demo/`);

    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher-badge'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const checkGH = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const badge = shadow?.querySelector('.samche-launcher-badge');
        const cs = badge ? window.getComputedStyle(badge) : null;
        return {
          hasBadge: !!badge,
          bgColor: cs ? cs.backgroundColor : null,
          cssVarLogoBg: cs ? cs.getPropertyValue('--chat-launcher-logo-bg') : null,
        };
      })()
    `);
    console.log('  Public widget logo badge background:', checkGH.bgColor, 'var:', checkGH.cssVarLogoBg);
    if (!checkGH.hasBadge) throw new Error('Public logo badge missing');
    const isBadgeTrans = checkGH.bgColor === 'rgba(0, 0, 0, 0)' || checkGH.bgColor === 'transparent' || checkGH.cssVarLogoBg === 'transparent';
    if (!isBadgeTrans) {
      throw new Error(`Expected transparent logo background, got ${checkGH.bgColor}`);
    }
    console.log('  ✓ PASS: Logo badge container becomes transparent on reload');

    // =========================================================================
    // TEST I & J: Change launcher text color & Save
    // =========================================================================
    console.log('\n[Test I & J] Navigating back to Dashboard, changing launcher text color to #FEF08A, and saving...');
    await browser.evaluate(`window.history.back()`);

    for (let i = 0; i < 40; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Appearance & Theme')))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.innerText.includes('Appearance & Theme'));
        if (tab) tab.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.querySelector('[data-testid="launcher-text-control"]'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const vBeforeIJ = storedChannelState.config_version;
    await browser.evaluate(`
      (() => {
        const textControl = document.querySelector('[data-testid="launcher-text-control"]');
        const valInput = textControl ? (textControl.querySelector('[data-testid="launcher-text-control-value"]') || textControl.querySelector('input[type="text"]')) : null;
        if (valInput) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(valInput, '#FEF08A');
          } else {
            valInput.value = '#FEF08A';
          }
          valInput.dispatchEvent(new Event('input', { bubbles: true }));
          valInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const btns = Array.from(document.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText.includes('Save Appearance'));
        if (saveBtn) saveBtn.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      if (storedChannelState.config_version > vBeforeIJ) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('  ✓ Saved successfully. Server stored config_version:', storedChannelState.config_version);

    // =========================================================================
    // TEST K & L: Reload public -> Text color changes
    // =========================================================================
    console.log('[Test K & L] Reloading public site and verifying launcher text color...');
    await browser.navigate(`${origin}/task8-demo/`);

    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const checkKL = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const launcher = shadow?.querySelector('.samche-launcher');
        const cs = launcher ? window.getComputedStyle(launcher) : null;
        return {
          textColor: cs ? cs.color : null,
          cssVarText: cs ? cs.getPropertyValue('--chat-launcher-text') : null,
        };
      })()
    `);
    console.log('  Public widget text color:', checkKL.textColor, 'var:', checkKL.cssVarText);
    if (checkKL.textColor !== 'rgb(254, 240, 138)') {
      throw new Error(`Expected launcher text color rgb(254, 240, 138), got ${checkKL.textColor}`);
    }
    console.log('  ✓ PASS: Text color changes to #FEF08A (rgb(254, 240, 138)) on reload');

    // =========================================================================
    // TEST M, N, O, P: Change back & Save & Reload public -> New config persists
    // =========================================================================
    console.log('\n[Test M, N, O, P] Changing back to #0F172A background, #FFFFFF text, and verifying reload persistence...');
    await browser.evaluate(`window.history.back()`);

    for (let i = 0; i < 40; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Appearance & Theme')))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.innerText.includes('Appearance & Theme'));
        if (tab) tab.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.querySelector('[data-testid="launcher-bg-control"]'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const vBeforeMNOP = storedChannelState.config_version;
    await browser.evaluate(`
      (() => {
        const bgControl = document.querySelector('[data-testid="launcher-bg-control"]');
        const bgValInput = bgControl ? bgControl.querySelector('[data-testid="launcher-bg-control-value"]') : null;
        const textControl = document.querySelector('[data-testid="launcher-text-control"]');
        const textValInput = textControl ? (textControl.querySelector('[data-testid="launcher-text-control-value"]') || textControl.querySelector('input[type="text"]')) : null;

        const setVal = (input, val) => {
          if (!input) return;
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(input, val);
          } else {
            input.value = val;
          }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setVal(bgValInput, '#0F172A');
        setVal(textValInput, '#FFFFFF');

        const btns = Array.from(document.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText.includes('Save Appearance'));
        if (saveBtn) saveBtn.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      if (storedChannelState.config_version > vBeforeMNOP) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('  ✓ Saved successfully. Server stored config_version:', storedChannelState.config_version);

    await browser.navigate(`${origin}/task8-demo/`);

    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const checkMNOP = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const launcher = shadow?.querySelector('.samche-launcher');
        const cs = launcher ? window.getComputedStyle(launcher) : null;
        const session = window.localStorage.getItem('samche_webchat_session_wch_real_ui_verify');
        return {
          bgColor: cs ? cs.backgroundColor : null,
          textColor: cs ? cs.color : null,
          hasSession: !!session,
        };
      })()
    `);
    console.log('  Public widget restored config:', checkMNOP.bgColor, checkMNOP.textColor, 'Session preserved:', checkMNOP.hasSession);
    if (checkMNOP.bgColor !== 'rgb(15, 23, 42)') {
      throw new Error(`Expected restored background rgb(15, 23, 42), got ${checkMNOP.bgColor}`);
    }
    if (checkMNOP.textColor !== 'rgb(255, 255, 255)') {
      throw new Error(`Expected restored text rgb(255, 255, 255), got ${checkMNOP.textColor}`);
    }
    if (!checkMNOP.hasSession) {
      throw new Error('Session was lost during appearance refresh');
    }
    console.log('  ✓ PASS: Restored configuration persists reliably on public site reload with session preserved');

    // =========================================================================
    // TEST Q: Tenant-Configurable Logo Sizing (Launcher & Panel Header Scale)
    // =========================================================================
    console.log('\n[Test Q] Configuring Launcher Logo Size (135%) and Panel Header Logo Size (125%)...');
    await browser.evaluate(`window.history.back()`);

    for (let i = 0; i < 40; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Appearance & Theme')))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.innerText.includes('Appearance & Theme'));
        if (tab) tab.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.querySelector('[data-testid="launcher-logo-size-slider"]'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Set scales on sliders
    await browser.evaluate(`
      (() => {
        const setRangeVal = (el, val) => {
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        const launcherSlider = document.querySelector('[data-testid="launcher-logo-size-slider"]');
        const panelSlider = document.querySelector('[data-testid="panel-logo-size-slider"]');
        setRangeVal(launcherSlider, 135);
        setRangeVal(panelSlider, 125);
      })()
    `);
    await new Promise(r => setTimeout(r, 300));

    // Verify Live Preview immediately reflects new scales
    const previewScaleCheck = await browser.evaluate(`
      (() => {
        const previewRoot = document.querySelector('[data-testid="web-chat-preview-root"]');
        const cs = previewRoot ? window.getComputedStyle(previewRoot) : null;
        return {
          launcherScale: cs ? cs.getPropertyValue('--chat-launcher-logo-scale') : null,
          panelScale: cs ? cs.getPropertyValue('--chat-panel-logo-scale') : null,
        };
      })()
    `);
    console.log('  Live Preview scale variables:', previewScaleCheck);
    if (previewScaleCheck.launcherScale !== '1.35' || previewScaleCheck.panelScale !== '1.25') {
      throw new Error(`Preview did not immediately reflect scale updates: ${JSON.stringify(previewScaleCheck)}`);
    }
    console.log('  ✓ PASS: Live Preview immediately updates CSS scale variables (1.35 / 1.25)');

    // Save appearance with new scales
    const vBeforeQ = storedChannelState.config_version;
    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText.includes('Save Appearance'));
        if (saveBtn) saveBtn.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      if (storedChannelState.config_version > vBeforeQ) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('  ✓ Saved successfully. Server stored config_version:', storedChannelState.config_version);
    if (storedChannelState.appearance.launcher_logo_scale !== 135 || storedChannelState.appearance.panel_logo_scale !== 125) {
      throw new Error(`Server stored appearance missing correct logo scales: ${JSON.stringify(storedChannelState.appearance)}`);
    }

    // Reload public site and verify scales in public widget
    await browser.navigate(`${origin}/task8-demo/`);
    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const publicScaleCheck = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const launcher = shadow?.querySelector('.samche-launcher');
        const csLauncher = launcher ? window.getComputedStyle(launcher) : null;
        return {
          launcherScaleVar: csLauncher ? csLauncher.getPropertyValue('--chat-launcher-logo-scale') : null,
          panelScaleVar: csLauncher ? csLauncher.getPropertyValue('--chat-panel-logo-scale') : null,
        };
      })()
    `);
    console.log('  Public widget logo scale verification:', publicScaleCheck);
    if (publicScaleCheck.launcherScaleVar !== '1.35' || publicScaleCheck.panelScaleVar !== '1.25') {
      throw new Error(`Public widget scale variables incorrect: ${JSON.stringify(publicScaleCheck)}`);
    }
    console.log('  ✓ PASS: Public widget applies exact saved logo scale variables (1.35 / 1.25)');

    // =========================================================================
    // TEST R: Real Color Parity - Dark Glass Surface Styles
    // =========================================================================
    console.log('\n[Test R] Verifying Real Color Parity for Dark Glass (Preview vs Public)...');
    // Open public widget panel
    await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const launcher = host?.shadowRoot?.querySelector('.samche-launcher');
        if (launcher) launcher.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    const publicDarkGlass = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const panel = shadow?.querySelector('.samche-panel');
        const header = shadow?.querySelector('.samche-header');
        const composer = shadow?.querySelector('.samche-composer');
        const csPanel = window.getComputedStyle(panel);
        const csHeader = window.getComputedStyle(header);
        const csComposer = window.getComputedStyle(composer);
        return {
          panelBg: csPanel.backgroundColor,
          panelBackdropFilter: csPanel.backdropFilter || csPanel.webkitBackdropFilter,
          headerBg: csHeader.backgroundColor,
          composerBg: csComposer.backgroundColor,
          surfaceGlassVar: window.getComputedStyle(host).getPropertyValue('--chat-surface-glass'),
        };
      })()
    `);
    console.log('  Public widget Dark Glass computed styles:', publicDarkGlass);

    // Navigate back to Dashboard preview and measure the same tokens
    await browser.evaluate(`window.history.back()`);
    for (let i = 0; i < 40; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.querySelector('[data-testid="preview-canonical-panel"]'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const previewDarkGlass = await browser.evaluate(`
      (() => {
        const panel = document.querySelector('[data-testid="preview-canonical-panel"]');
        const header = panel?.querySelector('.samche-header');
        const composer = panel?.querySelector('.samche-composer');
        const previewRoot = document.querySelector('[data-testid="web-chat-preview-root"]');
        const csPanel = window.getComputedStyle(panel);
        const csHeader = window.getComputedStyle(header);
        const csComposer = window.getComputedStyle(composer);
        const csRoot = window.getComputedStyle(previewRoot);
        return {
          panelBg: csPanel.backgroundColor,
          panelBackdropFilter: csPanel.backdropFilter || csPanel.webkitBackdropFilter,
          headerBg: csHeader.backgroundColor,
          composerBg: csComposer.backgroundColor,
          surfaceGlassVar: csRoot.getPropertyValue('--chat-surface-glass'),
        };
      })()
    `);
    console.log('  Preview Dark Glass computed styles:', previewDarkGlass);

    if (previewDarkGlass.panelBg !== publicDarkGlass.panelBg) {
      throw new Error(`Dark glass panel background mismatch: preview=${previewDarkGlass.panelBg}, public=${publicDarkGlass.panelBg}`);
    }
    if (previewDarkGlass.headerBg !== publicDarkGlass.headerBg) {
      throw new Error(`Header background mismatch: preview=${previewDarkGlass.headerBg}, public=${publicDarkGlass.headerBg}`);
    }
    if (previewDarkGlass.composerBg !== publicDarkGlass.composerBg) {
      throw new Error(`Composer background mismatch: preview=${previewDarkGlass.composerBg}, public=${publicDarkGlass.composerBg}`);
    }
    console.log('  ✓ PASS: Dark Glass canonical computed colors match 100% (panel, header, composer)');

    // =========================================================================
    // TEST S: Preview Host Canvas Options (Light Host vs Dark Host)
    // =========================================================================
    console.log('\n[Test S] Verifying Preview Host Canvas Options (Light Host / Dark Host)...');
    // Click Dark Host
    await browser.evaluate(`
      (() => {
        const darkBtn = document.querySelector('[data-testid="preview-host-dark"]');
        if (darkBtn) darkBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 200));

    const darkCanvas = await browser.evaluate(`
      (() => {
        const root = document.querySelector('[data-testid="web-chat-preview-root"]');
        return {
          hostCanvas: root ? root.getAttribute('data-host-canvas') : null,
          bg: root ? window.getComputedStyle(root).background : null,
        };
      })()
    `);
    if (darkCanvas.hostCanvas !== 'dark') throw new Error(`Expected dark canvas, got ${darkCanvas.hostCanvas}`);
    console.log('  ✓ PASS: Dark Host canvas simulates dark website environment');

    // Click Light Host
    await browser.evaluate(`
      (() => {
        const lightBtn = document.querySelector('[data-testid="preview-host-light"]');
        if (lightBtn) lightBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 200));

    const lightCanvas = await browser.evaluate(`
      (() => {
        const root = document.querySelector('[data-testid="web-chat-preview-root"]');
        return {
          hostCanvas: root ? root.getAttribute('data-host-canvas') : null,
          bg: root ? window.getComputedStyle(root).background : null,
        };
      })()
    `);
    if (lightCanvas.hostCanvas !== 'light') throw new Error(`Expected light canvas, got ${lightCanvas.hostCanvas}`);
    console.log('  ✓ PASS: Light Host canvas simulates light website environment honestly');

    // =========================================================================
    // TEST T: Real Color Parity - Light Glass Mode (Preview vs Public)
    // =========================================================================
    console.log('\n[Test T] Verifying Real Color Parity for Light Glass (Preview vs Public)...');
    const vBeforeT = storedChannelState.config_version;
    await browser.evaluate(`
      (() => {
        const selects = Array.from(document.querySelectorAll('select'));
        const themeSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'light'));
        if (themeSelect) {
          themeSelect.value = 'light';
          themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const btns = Array.from(document.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText.includes('Save Appearance'));
        if (saveBtn) saveBtn.click();
      })()
    `);

    for (let i = 0; i < 30; i++) {
      if (storedChannelState.config_version > vBeforeT) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log('  ✓ Saved successfully in Light mode. Server stored config_version:', storedChannelState.config_version);

    // Measure preview in Light Glass
    const previewLightGlass = await browser.evaluate(`
      (() => {
        const panel = document.querySelector('[data-testid="preview-canonical-panel"]');
        const header = panel?.querySelector('.samche-header');
        const composer = panel?.querySelector('.samche-composer');
        const csPanel = window.getComputedStyle(panel);
        const csHeader = window.getComputedStyle(header);
        const csComposer = window.getComputedStyle(composer);
        return {
          panelBg: csPanel.backgroundColor,
          headerBg: csHeader.backgroundColor,
          composerBg: csComposer.backgroundColor,
        };
      })()
    `);
    console.log('  Preview Light Glass computed styles:', previewLightGlass);

    // Reload public site in Light Glass mode
    await browser.navigate(`${origin}/task8-demo/`);
    for (let i = 0; i < 30; i++) {
      let ready = false;
      try {
        ready = await browser.evaluate(`Boolean(document.getElementById('samche-webchat-container')?.shadowRoot?.querySelector('.samche-launcher'))`);
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Open public panel in light mode
    await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const launcher = host?.shadowRoot?.querySelector('.samche-launcher');
        if (launcher) launcher.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    const publicLightGlass = await browser.evaluate(`
      (() => {
        const host = document.getElementById('samche-webchat-container');
        const shadow = host?.shadowRoot;
        const panel = shadow?.querySelector('.samche-panel');
        const header = shadow?.querySelector('.samche-header');
        const composer = shadow?.querySelector('.samche-composer');
        const csPanel = window.getComputedStyle(panel);
        const csHeader = window.getComputedStyle(header);
        const csComposer = window.getComputedStyle(composer);
        return {
          panelBg: csPanel.backgroundColor,
          headerBg: csHeader.backgroundColor,
          composerBg: csComposer.backgroundColor,
        };
      })()
    `);
    console.log('  Public widget Light Glass computed styles:', publicLightGlass);

    if (previewLightGlass.panelBg !== publicLightGlass.panelBg) {
      throw new Error(`Light glass panel background mismatch: preview=${previewLightGlass.panelBg}, public=${publicLightGlass.panelBg}`);
    }
    if (previewLightGlass.headerBg !== publicLightGlass.headerBg) {
      throw new Error(`Light glass header background mismatch: preview=${previewLightGlass.headerBg}, public=${publicLightGlass.headerBg}`);
    }
    if (previewLightGlass.composerBg !== publicLightGlass.composerBg) {
      throw new Error(`Light glass composer background mismatch: preview=${previewLightGlass.composerBg}, public=${publicLightGlass.composerBg}`);
    }
    console.log('  ✓ PASS: Light Glass canonical computed colors match 100% (panel, header, composer)');


    console.log('\n================================================================');
    console.log('  ALL REAL SAVE APPEARANCE PROPAGATION AUDITS PASSED (100% GREEN)');
    console.log('================================================================\n');

  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error('\n❌ REAL SAVE APPEARANCE PROPAGATION FAILED:', err);
  process.exit(1);
});

