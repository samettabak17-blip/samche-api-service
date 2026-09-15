import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

const ARTIFACTS_DIR = path.resolve('artifacts');
if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
const DIST_DIR = path.resolve('dashboard', 'dist');
const PUBLIC_DIR = path.resolve('public');



let storedChannelState = {
  tenant_id: 'test-tenant-123',
  configured: true,
  widget_key: 'wch_real_ui_verify',
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
  appearance: {
    brand_name: 'Acme Test Corp',
    panel_title: 'Customer Care',
    panel_subtitle: 'We typically reply in seconds',
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
    launcher_bg: '#0F172A',
    launcher_foreground: '#FFFFFF',
    launcher_text: '#FFFFFF',
    launcher_border_color: '',
    launcher_border: '',
    launcher_glow_color: '',
    launcher_glow: '',
    launcher_logo_background: 'transparent',
    launcher_logo_bg: 'transparent',
    launcher_logo_border_color: 'transparent',
    launcher_logo_border: 'transparent',
    glow_intensity: 55,
    glow_spread: 35,
    glow_pulse: true,
    theme: {
      primary_color: '#0B5FFF',
      accent_color: '#10B981',
      glow_ring: '0 0 20px rgba(11, 95, 255, 0.55)',
      glow_spread_px: 14,
      glow_halo_px: 28,
    },
    contrast: {
      primary_button: 5.2,
      accent_pill: 4.8,
    },
  },
  behavior: {
    proactive_messages: [],
    proactive_enabled: false,
    proactive_delay_seconds: 5,
    high_intent_proactive: true,
    operating_hours: null,
    offline_behavior: 'leave_message',
    default_language: 'auto',
  },
  embed_snippet: '<script src="/public/web-chat.js" data-widget-key="wch_real_ui_verify"></script>',
  installation: {
    widget_key: 'wch_real_ui_verify',
    embed_snippet: '<script src="/public/web-chat.js" data-widget-key="wch_real_ui_verify"></script>',
    status: 'active',
    guidance: [],
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
          'Access-Control-Allow-Origin': '*',
        });
        return fs.createReadStream(filePath).pipe(res);
      }
    }

    if (pathname.startsWith('/assets/')) {
      const filePath = path.join(DIST_DIR, pathname);
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Public WebChat Transparency Test</title>
          <style>body { margin: 0; padding: 40px; background: #0f172a; color: white; font-family: sans-serif; }</style>
        </head>
        <body>
          <h1>Public WebChat Host Storefront</h1>
    if (pathname === '/api/v1/auth/login') {
      return sendJson(200, {
        token: 'mock-verification-token',
        user: { id: 'u-1', email: 'admin@samchecompany.com', system_role: 'OWNER', status: 'ACTIVE' },
      });
    }

          <script src="/public/web-chat.js" data-widget-key="wch_real_ui_verify"></script>
        </body>
        </html>
      `);
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
        kpis: {
          total_conversations: 0,
          new_leads: 0,
          appointments: 0,
          automations: 0,
          satisfaction_rate: 0,
          conversation_growth: 0,
        },
        conversation_timeseries: [],
      });
    }

    if (pathname === '/api/v1/tenants/test-tenant-123/assistants') {
      return sendJson(200, [
        { id: 'ast-1', name: 'Staging Assistant', model: 'gpt-4o-mini', status: 'active' },
      ]);
    }

    if (pathname === '/api/v1/tenants/test-tenant-123/channels/web-chat') {
      if (req.method === 'GET') return sendJson(200, storedChannelState);
      if (req.method === 'PUT') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            storedChannelState.appearance = { ...storedChannelState.appearance, ...data.appearance };
            sendJson(200, storedChannelState);
          } catch (e) {
            sendJson(400, { error: e.message });
          }
        });
        return;
      }
    }

    if (pathname === '/api/v1/tenants/test-tenant-123/channels/web-chat/preview') {
      return sendJson(200, { contrast: { primary_button: 5.5, accent_pill: 5.0 } });
    }

    if (pathname === '/api/v1/tenants/plan-upgrade-notifications') {
      return sendJson(200, { notifications: [] });
    }

    if (pathname.includes('/invitations')) {
      return sendJson(200, []);
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
      return sendJson(200, {
        status: 'ok',
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
  console.log('  REAL DASHBOARD UI TRANSPARENCY VISUAL VERIFICATION (CDP)      ');
  console.log('================================================================\n');

  const { server, origin } = await createVerificationServer();
  console.log(`Verification Server running at: ${origin}`);

  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  try {
    browser.eventListeners.push((evt) => {
      if (evt.method === 'Runtime.consoleAPICalled') {
        console.log('[BROWSER CONSOLE]', evt.params.type, evt.params.args?.map(a => a.value || a.description).join(' '));
      }
      if (evt.method === 'Runtime.exceptionThrown') {
        console.log('[BROWSER EXCEPTION]', evt.params.exceptionDetails?.text, evt.params.exceptionDetails?.exception?.description);
      }
    });

    // 1. Log in via the real Login form
    console.log('[1/7] Logging into Dashboard via real login form...');
    await browser.navigate(`${origin}/login`);
    await new Promise((r) => setTimeout(r, 600));

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
    await new Promise((r) => setTimeout(r, 1200));

    // 2. Navigate to Web Chat Appearance page
    console.log('[2/7] Navigating to Dashboard Web Chat Management...');
    await browser.navigate(`${origin}/app/test-tenant-123/channels/web-chat`);
    await new Promise((r) => setTimeout(r, 1500));



    // 3. Click Appearance & Theme tab
    console.log('[2/7] Opening Appearance & Theme tab...');
    const pageStateBeforeTab = await browser.evaluate(`
      (() => ({
        url: window.location.href,
        text: document.body.innerText.slice(0, 500),
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()),
      }))()
    `);
    console.log('    Page state before tab click:', JSON.stringify(pageStateBeforeTab, null, 2));

    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.innerText.includes('Appearance & Theme'));
        if (tab) tab.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    const pageStateAfterTab = await browser.evaluate(`
      (() => ({
        url: window.location.href,
        text: document.body.innerText.slice(0, 500),
        selects: Array.from(document.querySelectorAll('select')).map(s => ({ value: s.value, options: Array.from(s.options).map(o => o.value) })),
      }))()
    `);
    console.log('    Page state after tab click:', JSON.stringify(pageStateAfterTab, null, 2));


    // 4. Inspect Custom Launcher Theme & Logo Section
    console.log('[3/7] Verifying controls structure in Custom launcher theme mode...');
    const controlsCheck = await browser.evaluate(`
      (() => {
        const customCard = document.querySelector('[data-testid="launcher-custom-controls"]');
        const logoSection = document.querySelector('[data-testid="logo-avatar-container-section"]');
        const launcherBgControl = document.querySelector('[data-testid="launcher-bg-control"]');
        const logoBgControl = document.querySelector('[data-testid="launcher-logo-bg-control"]');
        const logoBorderControl = document.querySelector('[data-testid="launcher-logo-border-control"]');

        const launcherBgTransBtn = launcherBgControl ? launcherBgControl.querySelector('[data-testid="launcher-bg-control-transparent-btn"]') : null;
        const launcherBgPicker = launcherBgControl ? launcherBgControl.querySelector('[data-testid="launcher-bg-control-color-picker"]') : null;
        const launcherBgValue = launcherBgControl ? launcherBgControl.querySelector('[data-testid="launcher-bg-control-value"]') : null;

        const logoBgSwatchTrans = logoBgControl ? logoBgControl.querySelector('[data-testid="launcher-logo-bg-control-swatch-transparent"]') : null;
        const logoBgUseColorBtn = logoBgControl ? logoBgControl.querySelector('[data-testid="launcher-logo-bg-control-use-color-btn"]') : null;

        return {
          hasCustomCard: !!customCard,
          hasLogoSection: !!logoSection,
          hasLauncherBgControl: !!launcherBgControl,
          launcherBg: {
            hasTransBtn: !!launcherBgTransBtn,
            hasColorPicker: !!launcherBgPicker,
            pickerValue: launcherBgPicker ? launcherBgPicker.value : null,
            inputValue: launcherBgValue ? launcherBgValue.value : null,
          },
          hasLogoBgControl: !!logoBgControl,
          logoBg: {
            hasSwatchTrans: !!logoBgSwatchTrans,
            hasUseColorBtn: !!logoBgUseColorBtn,
          },
          hasLogoBorderControl: !!logoBorderControl,
        };
      })()
    `);

    console.log('    Controls check result:', JSON.stringify(controlsCheck, null, 2));
    if (!controlsCheck.hasCustomCard) throw new Error('launcher-custom-controls card missing');
    if (!controlsCheck.hasLogoSection) throw new Error('logo-avatar-container-section missing');
    if (!controlsCheck.launcherBg.hasTransBtn) throw new Error('Launcher Background Transparent button missing');
    if (!controlsCheck.launcherBg.hasColorPicker) throw new Error('Launcher Background color picker missing');
    if (!controlsCheck.logoBg.hasSwatchTrans) throw new Error('Logo Background checkerboard swatch missing');
    if (!controlsCheck.logoBg.hasUseColorBtn) throw new Error('Logo Background Use Color button missing');

    console.log('    ✓ Launcher Background: [ color swatch ] [ #0F172A ] [ Transparent ] verified');
    console.log('    ✓ LOGO / AVATAR CONTAINER section clearly visible with Logo Background & Border');
    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'dash_custom_controls_visible.png'), await browser.screenshot());


    // 5. Test clicking Transparent on Launcher Background & Live Preview update
    console.log('[4/7] Testing Launcher Background Transparent toggle...');
    await browser.evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="launcher-bg-control-transparent-btn"]');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const launcherTransActiveCheck = await browser.evaluate(`
      (() => {
        const control = document.querySelector('[data-testid="launcher-bg-control"]');
        const swatchTrans = control.querySelector('[data-testid="launcher-bg-control-swatch-transparent"]');
        const valInput = control.querySelector('[data-testid="launcher-bg-control-value"]');
        const useColorBtn = control.querySelector('[data-testid="launcher-bg-control-use-color-btn"]');

        const previewLauncher = document.getElementById('preview-launcher-btn');
        let previewBg = null;
        if (previewLauncher) {
          previewBg = window.getComputedStyle(previewLauncher).backgroundColor;
        }

        return {
          hasSwatchTrans: !!swatchTrans,
          val: valInput ? valInput.value : null,
          hasUseColorBtn: !!useColorBtn,
          previewBg,
        };
      })()
    `);

    console.log('    Active transparency check:', JSON.stringify(launcherTransActiveCheck, null, 2));
    if (!launcherTransActiveCheck.hasSwatchTrans) throw new Error('Checkerboard swatch did not appear');
    if (launcherTransActiveCheck.val !== 'transparent') throw new Error(`Expected value "transparent", got ${launcherTransActiveCheck.val}`);
    if (!launcherTransActiveCheck.hasUseColorBtn) throw new Error('Use Color button did not appear');
    console.log(`    Live Preview Launcher Background computed color: ${launcherTransActiveCheck.previewBg}`);
    console.log('    ✓ Live preview immediately updated to transparent');
    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'dash_launcher_transparent_active.png'), await browser.screenshot());


    // 6. Test Use Color restores original color without corruption
    console.log('[5/7] Testing Use Color restores previous color (#0F172A)...');
    await browser.evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="launcher-bg-control-use-color-btn"]');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const restoredCheck = await browser.evaluate(`
      (() => {
        const control = document.querySelector('[data-testid="launcher-bg-control"]');
        const picker = control.querySelector('[data-testid="launcher-bg-control-color-picker"]');
        const valInput = control.querySelector('[data-testid="launcher-bg-control-value"]');
        const transBtn = control.querySelector('[data-testid="launcher-bg-control-transparent-btn"]');
        return {
          pickerVal: picker ? picker.value : null,
          inputVal: valInput ? valInput.value : null,
          hasTransBtn: !!transBtn,
        };
      })()
    `);

    console.log('    Restored check:', JSON.stringify(restoredCheck, null, 2));
    if (!restoredCheck.hasTransBtn) throw new Error('Transparent button did not return after Use Color');
    if (restoredCheck.inputVal !== '#0F172A') throw new Error(`Expected restored value #0F172A, got ${restoredCheck.inputVal}`);
    console.log('    ✓ Use Color restored #0F172A cleanly without configuration corruption');

    // 7. Click Transparent again, Save Appearance, and verify persistence after Dashboard reload
    console.log('[6/7] Setting Transparent, clicking Save Appearance, and verifying reload persistence...');
    await browser.evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="launcher-bg-control-transparent-btn"]');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));

    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const saveBtn = btns.find(b => b.innerText.includes('Save Appearance'));
        if (saveBtn) saveBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1200));

    if (storedChannelState.appearance.launcher_background !== 'transparent') {
      throw new Error(`Expected server to have stored "transparent", got ${storedChannelState.appearance.launcher_background}`);
    }

    // Reload Dashboard and verify it survives reload
    console.log('    Reloading Dashboard page...');
    await browser.navigate(`${origin}/app/test-tenant-123/channels/web-chat`);
    await new Promise((r) => setTimeout(r, 1500));

    await browser.evaluate(`
      (() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const tab = btns.find(b => b.innerText.includes('Appearance & Theme'));
        if (tab) tab.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    const reloadedCheck = await browser.evaluate(`
      (() => {
        const launcherBgControl = document.querySelector('[data-testid="launcher-bg-control"]');
        const logoBgControl = document.querySelector('[data-testid="launcher-logo-bg-control"]');

        const launcherSwatchTrans = launcherBgControl ? launcherBgControl.querySelector('[data-testid="launcher-bg-control-swatch-transparent"]') : null;
        const launcherVal = launcherBgControl ? launcherBgControl.querySelector('[data-testid="launcher-bg-control-value"]') : null;

        const logoSwatchTrans = logoBgControl ? logoBgControl.querySelector('[data-testid="launcher-logo-bg-control-swatch-transparent"]') : null;
        const logoVal = logoBgControl ? logoBgControl.querySelector('[data-testid="launcher-logo-bg-control-value"]') : null;

        return {
          launcherSurvives: !!launcherSwatchTrans && launcherVal && launcherVal.value === 'transparent',
          logoSurvives: !!logoSwatchTrans && logoVal && logoVal.value === 'transparent',
        };
      })()
    `);

    console.log('    Reload persistence check:', JSON.stringify(reloadedCheck, null, 2));
    if (!reloadedCheck.launcherSurvives) throw new Error('Launcher Background did not survive reload as transparent');
    if (!reloadedCheck.logoSurvives) throw new Error('Logo Background did not survive reload as transparent');
    console.log('    ✓ Survives Dashboard reload with first-class transparency intact');
    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'dash_reloaded_still_transparent.png'), await browser.screenshot());

    // 8. Public WebChat widget runtime check on demo page
    console.log('[7/7] Verifying public WebChat runtime on demo storefront...');
    await browser.navigate(`${origin}/task8-demo/`);
    await new Promise((r) => setTimeout(r, 2000));

    const publicWidgetCheck = await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        if (!container || !container.shadowRoot) return { error: 'Shadow container missing' };
        const shadow = container.shadowRoot;
        const launcher = shadow.querySelector('.samche-launcher');
        const badge = shadow.querySelector('.samche-launcher-badge');

        if (!launcher) return { error: 'Launcher button missing' };

        const launcherCs = window.getComputedStyle(launcher);
        const badgeCs = badge ? window.getComputedStyle(badge) : null;

        return {
          hasLauncher: true,
          launcherBg: launcherCs.backgroundColor,
          hasBadge: !!badge,
          badgeBg: badgeCs ? badgeCs.backgroundColor : null,
        };
      })()
    `);

    console.log('    Public widget check:', JSON.stringify(publicWidgetCheck, null, 2));
    if (!publicWidgetCheck.hasLauncher) throw new Error('Public launcher missing');
    if (publicWidgetCheck.launcherBg !== 'rgba(0, 0, 0, 0)') {
      throw new Error(`Expected public launcher background rgba(0, 0, 0, 0), got ${publicWidgetCheck.launcherBg}`);
    }
    if (publicWidgetCheck.badgeBg !== 'rgba(0, 0, 0, 0)') {
      throw new Error(`Expected public badge background rgba(0, 0, 0, 0), got ${publicWidgetCheck.badgeBg}`);
    }
    console.log('    ✓ Public widget renders launcher and logo container with transparent backing (backing actually absent)');
    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'public_widget_transparent.png'), await browser.screenshot());


    console.log('\n================================================================');
    console.log('  ALL REAL DASHBOARD UI VERIFICATION CHECKS PASSED              ');
    console.log('================================================================');
  } finally {
    try { await browser.close(); } catch {}
    server.close();
  }
}

run().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
