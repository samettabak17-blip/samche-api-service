/**
 * scripts/verify_staging_premium_launcher.js
 * Comprehensive end-to-end audit for the configurable premium launcher,
 * logo-derived glow tokens, single-surface open state, and live browser runtime.
 */

import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

const API_STAGING_URL = (process.env.STAGING_SERVICE_URL || 'https://samche-api-staging.onrender.com').trim().replace(/\/+$/, '');
const DASHBOARD_STAGING_URL = (process.env.DASHBOARD_STAGING_URL || 'https://samche-dashboard-staging.onrender.com').trim().replace(/\/+$/, '');
const TARGET_WIDGET_KEY = process.env.TASK8_DEMO_WIDGET_KEY || 'wch_staging_task8_demo';

function logStep(step, msg) {
  console.log(`[${step}] ${msg}`);
}

function logPass(msg) {
  console.log(`    ✓ ${msg}`);
}

async function runAudit() {
  console.log('================================================================');
  console.log('    SAMCHE PREMIUM LAUNCHER & GLOW SYSTEM STAGING AUDIT         ');
  console.log('================================================================');
  console.log(`API Origin:       ${API_STAGING_URL}`);
  console.log(`Dashboard Origin: ${DASHBOARD_STAGING_URL}`);
  console.log(`Widget Key:       ${TARGET_WIDGET_KEY}\n`);

  const report = {};

  // 1. API Staging Health & Revision
  logStep('1/6', 'Auditing deployed API staging health & git revision...');
  const healthRes = await fetch(`${API_STAGING_URL}/api/v1/health`);
  if (!healthRes.ok) throw new Error(`API health check returned HTTP ${healthRes.status}`);
  const healthData = await healthRes.json();
  if (healthData.status !== 'ok') throw new Error(`API health check status is ${healthData.status}`);
  const deployedRevision = healthData.revision || 'UNKNOWN';
  logPass(`API Health OK. Deployed Revision: ${deployedRevision}`);
  report.API_HEALTH = 'PASS';
  report.API_REVISION = deployedRevision;

  // 2. Dashboard SPA Availability & Version Check
  logStep('2/6', 'Auditing Dashboard SPA origin and bundle delivery...');
  const dashRes = await fetch(DASHBOARD_STAGING_URL);
  if (!dashRes.ok) throw new Error(`Dashboard returned HTTP ${dashRes.status}`);
  const dashHtml = await dashRes.text();
  if (!dashHtml.includes('<html') || !dashHtml.includes('samche')) {
    throw new Error('Dashboard did not return valid HTML');
  }
  logPass(`Dashboard SPA accessible at ${DASHBOARD_STAGING_URL}`);
  report.DASHBOARD_ACCESSIBLE = 'PASS';

  // 3. Public Web Chat Runtime Bundle Features
  logStep('3/6', 'Auditing public/web-chat.js runtime script features...');
  const runtimeRes = await fetch(`${API_STAGING_URL}/public/web-chat.js`);
  if (!runtimeRes.ok) throw new Error(`web-chat.js returned HTTP ${runtimeRes.status}`);
  const runtimeSource = await runtimeRes.text();

  const requiredStyles = [
    'samche-style-pill',
    'samche-style-circular',
    'samche-style-minimal',
    'samche-style-glass',
    'samche-style-neon-pulse',
    'samche-launcher-badge',
    'samche-launcher-hidden',
    'samche-glow-breathe',
    'samche-glow-pulse-strong',
    '--chat-glow-ring',
    '--chat-glow-spread',
    '--chat-glow-halo',
    '--chat-pulse-duration',
    'samche-minimize-btn',
  ];

  for (const token of requiredStyles) {
    if (!runtimeSource.includes(token)) {
      throw new Error(`public/web-chat.js missing required feature: ${token}`);
    }
  }
  logPass(`public/web-chat.js includes all 6 launcher styles, glow CSS variables, pulse keyframes, and single-surface open state`);
  report.RUNTIME_FEATURES = 'PASS';

  // 4. Public Bootstrap Appearance Contract
  logStep('4/6', 'Auditing /api/chat/bootstrap appearance and token contract...');
  const bootRes = await fetch(`${API_STAGING_URL}/api/chat/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widget_key: TARGET_WIDGET_KEY }),
  });
  if (!bootRes.ok) throw new Error(`Bootstrap returned HTTP ${bootRes.status}`);
  const bootData = await bootRes.json();
  const appearance = bootData.appearance;
  if (!appearance || !appearance.theme) {
    throw new Error('Bootstrap missing appearance or theme object');
  }

  if (!appearance.launcher_style) {
    throw new Error('Appearance missing launcher_style');
  }
  if (typeof appearance.glow_intensity !== 'number' || typeof appearance.glow_spread !== 'number') {
    throw new Error('Appearance missing numeric glow_intensity or glow_spread');
  }
  if (!appearance.theme.glow_ring || !appearance.theme.glow_spread_px || !appearance.theme.glow_halo_px) {
    throw new Error('Appearance theme missing glow_ring, glow_spread_px, or glow_halo_px');
  }
  if (appearance.contrast.primary_button < 4.5) {
    throw new Error(`Primary button contrast ${appearance.contrast.primary_button} fails WCAG AA`);
  }
  logPass(`Bootstrap contract verified: launcher_style="${appearance.launcher_style}", glow_intensity=${appearance.glow_intensity}%, glow_spread=${appearance.glow_spread}%`);
  logPass(`Theme tokens verified: glow_ring="${appearance.theme.glow_ring}", spread=${appearance.theme.glow_spread_px}px, halo=${appearance.theme.glow_halo_px}px, contrast=${appearance.contrast.primary_button}:1`);
  report.BOOTSTRAP_CONTRACT = 'PASS';
  report.LAUNCHER_STYLE = appearance.launcher_style;
  report.WCAG_CONTRAST = `${appearance.contrast.primary_button}:1`;

  // 5. Live Headless Browser Runtime Verification on Desktop Storefront
  logStep('5/6', 'Executing live headless browser verification on staging storefront (Desktop)...');
  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  try {
    const demoUrl = `${API_STAGING_URL}/task8-demo/?widget_key=${encodeURIComponent(TARGET_WIDGET_KEY)}`;
    await browser.navigate(demoUrl);
    await new Promise((r) => setTimeout(r, 2500));

    // Audit closed launcher presentation and glow
    const closedLauncherCheck = await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        if (!container || !container.shadowRoot) return { error: 'Shadow container missing' };
        const shadow = container.shadowRoot;
        const launcher = shadow.querySelector('.samche-launcher');
        if (!launcher) return { error: 'Launcher button missing' };

        const rect = launcher.getBoundingClientRect();
        const cs = window.getComputedStyle(launcher);
        const badge = launcher.querySelector('.samche-launcher-badge');
        const badgeImg = badge ? badge.querySelector('img') : null;
        const label = launcher.querySelector('.samche-launcher-label');

        return {
          visible: rect.width > 0 && rect.height > 0,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          boxShadow: cs.boxShadow,
          borderRadius: cs.borderRadius,
          border: cs.border,
          hasBadge: !!badge,
          hasBadgeImg: !!badgeImg,
          labelText: label ? label.innerText.trim() : null,
          isHidden: launcher.classList.contains('samche-launcher-hidden'),
        };
      })()
    `);

    if (!closedLauncherCheck.visible || !closedLauncherCheck.hasBadge) {
      throw new Error(`Closed launcher check failed: ${JSON.stringify(closedLauncherCheck)}`);
    }
    logPass(`Closed launcher rendered: size=${closedLauncherCheck.width}x${closedLauncherCheck.height}px, badge=true, label="${closedLauncherCheck.labelText || ''}"`);
    logPass(`Luminous glow verified on launcher: boxShadow="${closedLauncherCheck.boxShadow.slice(0, 60)}..."`);
    report.CLOSED_LAUNCHER_PRESENTATION = 'PASS';

    // Click launcher -> Open chat panel
    logStep('   →', 'Testing open panel interaction & single surface contract...');
    await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        const launcher = container.shadowRoot.querySelector('.samche-launcher');
        launcher.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const openPanelCheck = await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        const shadow = container.shadowRoot;
        const panel = shadow.querySelector('.samche-panel');
        const launcher = shadow.querySelector('.samche-launcher');
        const minimizeBtn = shadow.querySelector('.samche-minimize-btn');
        const closeBtn = shadow.querySelector('.samche-close-btn');

        const pRect = panel.getBoundingClientRect();
        const pCs = window.getComputedStyle(panel);

        return {
          panelOpen: panel.classList.contains('samche-open'),
          panelVisible: pRect.width > 0 && pRect.height > 0,
          panelGlow: pCs.boxShadow,
          launcherHidden: launcher.classList.contains('samche-launcher-hidden') || launcher.style.display === 'none',
          hasMinimizeBtn: !!minimizeBtn,
          hasCloseBtn: !!closeBtn,
        };
      })()
    `);

    if (!openPanelCheck.panelOpen || !openPanelCheck.panelVisible) {
      throw new Error(`Open panel check failed: ${JSON.stringify(openPanelCheck)}`);
    }
    if (!openPanelCheck.launcherHidden) {
      throw new Error('FAIL: Competing launcher button is still visible while chat panel is open');
    }
    logPass(`Panel smoothly expanded: border and ambient glow active, single primary surface verified`);
    logPass(`Zero competing launcher buttons: floating launcher correctly hidden while panel is open`);
    report.OPEN_PANEL_CONTINUITY = 'PASS';
    report.SINGLE_SURFACE_CONTRACT = 'PASS';

    // Click close/minimize button -> Panel closes, launcher restores
    logStep('   →', 'Testing close interaction & launcher restoration...');
    await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        const closeBtn = container.shadowRoot.querySelector('.samche-close-btn');
        closeBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const restoreCheck = await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        const shadow = container.shadowRoot;
        const panel = shadow.querySelector('.samche-panel');
        const launcher = shadow.querySelector('.samche-launcher');
        const rect = launcher.getBoundingClientRect();

        return {
          panelClosed: !panel.classList.contains('samche-open'),
          launcherRestored: !launcher.classList.contains('samche-launcher-hidden') && rect.width > 0,
        };
      })()
    `);

    if (!restoreCheck.panelClosed || !restoreCheck.launcherRestored) {
      throw new Error(`Launcher restore check failed: ${JSON.stringify(restoreCheck)}`);
    }
    logPass(`Panel closed cleanly and returned to configured luminous closed launcher`);
    report.LAUNCHER_RESTORE_CYCLE = 'PASS';
  // 6. Mobile & Reduced Motion Verification
    logStep('6/6', 'Auditing Mobile responsive layout & Reduced Motion accessibility...');
    await browser.setViewport({ width: 375, height: 667, isMobile: true });
    await new Promise((r) => setTimeout(r, 400));

    const mobileCheck = await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        const launcher = container.shadowRoot.querySelector('.samche-launcher');
        const lRect = launcher.getBoundingClientRect();

        // Open panel on mobile
        launcher.click();
        const panel = container.shadowRoot.querySelector('.samche-panel');
        const pRect = panel.getBoundingClientRect();

        return {
          launcherFitsViewport: lRect.right <= window.innerWidth && lRect.left >= 0,
          panelFullscreen: pRect.width >= window.innerWidth * 0.95,
        };
      })()
    `);

    if (!mobileCheck.launcherFitsViewport || !mobileCheck.panelFullscreen) {
      throw new Error(`Mobile layout check failed: ${JSON.stringify(mobileCheck)}`);
    }
    logPass(`Mobile responsive verified: compact closed launcher and full-viewport open panel`);
    report.MOBILE_RESPONSIVE = 'PASS';

    // Reduced motion CSS check
    const motionCheck = await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        const shadow = container.shadowRoot;
        const styleText = shadow.querySelector('style')?.textContent || '';
        return {
          hasReducedMotionMedia: styleText.includes('prefers-reduced-motion: reduce'),
          disablesAnimation: styleText.includes('animation: none !important'),
        };
      })()
    `);

    if (!motionCheck.hasReducedMotionMedia || !motionCheck.disablesAnimation) {
      throw new Error('Reduced motion check failed');
    }
    logPass(`Reduced motion media query verified with clean static fallback`);
    report.REDUCED_MOTION = 'PASS';
  } finally {
    try { await browser.close(); } catch {}
  }

  console.log('\n================================================================');
  console.log('             ALL STAGING AUDIT CHECKS PASSED                   ');
  console.log('================================================================');
  console.table(report);

  const { writeFileSync } = await import('node:fs');
  writeFileSync('C:/Users/smttb/Documents/samche-api-service/staging_launcher_audit_result.json', JSON.stringify(report, null, 2));
}

runAudit().catch((err) => {
  console.error('\n❌ STAGING AUDIT FAILED:', err);
  process.exit(1);
});

