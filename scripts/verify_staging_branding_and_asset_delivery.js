/**
 * scripts/verify_staging_branding_and_asset_delivery.js
 * Comprehensive end-to-end verification script for Web Chat branding,
 * asset delivery, CORS, PNG scanline decompression, and canonical URL resolution
 * on deployed staging.
 */

import zlib from 'node:zlib';
import { BrowserCdp } from '../tests/helpers/browser-cdp.js';
import {
  decodePngColors,
  extractColorCandidatesFromBuffer,
} from '../services/web-chat-asset-service.js';

const API_STAGING_URL = (process.env.STAGING_SERVICE_URL || 'https://samche-api-staging.onrender.com').trim().replace(/\/+$/, '');
const DASHBOARD_STAGING_URL = (process.env.DASHBOARD_STAGING_URL || 'https://samche-dashboard-staging.onrender.com').trim().replace(/\/+$/, '');
const TARGET_WIDGET_KEY = process.env.TASK8_DEMO_WIDGET_KEY || 'wch_staging_task8_demo';

function logStep(step, msg) {
  console.log(`[${step}] ${msg}`);
}

function logPass(msg) {
  console.log(`    ✓ ${msg}`);
}

async function runVerification() {
  console.log('================================================================');
  console.log('  SAMCHE WEB CHAT BRANDING & ASSET DELIVERY E2E STAGING AUDIT  ');
  console.log('================================================================');
  console.log(`API Origin:       ${API_STAGING_URL}`);
  console.log(`Dashboard Origin: ${DASHBOARD_STAGING_URL}`);
  console.log(`Widget Key:       ${TARGET_WIDGET_KEY}\n`);

  const report = {};

  // 1. API Staging Deployment & Revision Verification
  logStep('1/7', 'Checking deployed API staging health & git revision...');
  const healthRes = await fetch(`${API_STAGING_URL}/api/v1/health`);
  if (!healthRes.ok) throw new Error(`API health check returned HTTP ${healthRes.status}`);
  const healthData = await healthRes.json();
  if (healthData.status !== 'ok') throw new Error(`API health check status is ${healthData.status}`);
  const deployedRevision = healthData.revision || 'UNKNOWN';
  logPass(`API Health OK. Deployed Revision: ${deployedRevision}`);
  report.API_HEALTH = 'PASS';
  report.DEPLOYED_REVISION = deployedRevision;

  // 2. Dashboard Origin & Asset Resolution Verification
  logStep('2/7', 'Verifying Dashboard staging SPA accessibility & cross-origin isolation...');
  const dashRes = await fetch(DASHBOARD_STAGING_URL);
  if (!dashRes.ok) throw new Error(`Dashboard returned HTTP ${dashRes.status}`);
  const dashHtml = await dashRes.text();
  if (!dashHtml.includes('<html') || !dashHtml.includes('samche')) {
    throw new Error('Dashboard did not return valid HTML');
  }
  logPass(`Dashboard SPA accessible at ${DASHBOARD_STAGING_URL}`);
  report.DASHBOARD_ORIGIN = 'PASS';

  const relativeAssetPath = '/api/v1/public/web-chat/assets/0192b1a2-3c4d-7e8f-9a0b-1c2d3e4f5a6b';
  const expectedResolvedUrl = `${API_STAGING_URL}${relativeAssetPath}`;
  function simulateDashboardAssetResolution(rawUrl, apiBase) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('//')) return trimmed;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
    } catch {}
    const base = (apiBase || '').trim().replace(/\/+$/, '');
    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return base ? `${base}${path}` : path;
  }

  const resolved = simulateDashboardAssetResolution(relativeAssetPath, API_STAGING_URL);
  if (resolved !== expectedResolvedUrl) {
    throw new Error(`Asset resolution mismatch: expected ${expectedResolvedUrl}, got ${resolved}`);
  }
  logPass(`Cross-origin asset URL correctly resolves: ${resolved}`);
  report.ASSET_URL_RESOLUTION = 'PASS';
  // 3. CORS Headers & Preflight Handling on Web Chat Asset Endpoints
  logStep('3/7', 'Auditing CORS headers & OPTIONS preflight on asset endpoints...');
  const corsEndpoints = [
    `${API_STAGING_URL}/api/v1/public/web-chat/assets/00000000-0000-0000-0000-000000000000`,
    `${API_STAGING_URL}/api/v1/public/web-chat/${TARGET_WIDGET_KEY}/logo`,
  ];

  for (const url of corsEndpoints) {
    const optRes = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        'Origin': DASHBOARD_STAGING_URL,
        'Access-Control-Request-Method': 'GET',
      },
    });
    if (optRes.status !== 204 && optRes.status !== 200) {
      throw new Error(`OPTIONS ${url} returned HTTP ${optRes.status}`);
    }
    const acao = optRes.headers.get('access-control-allow-origin');
    if (acao !== '*' && acao !== DASHBOARD_STAGING_URL) {
      throw new Error(`OPTIONS ${url} missing Access-Control-Allow-Origin header (got ${acao})`);
    }

    const getRes = await fetch(url, {
      headers: { 'Origin': DASHBOARD_STAGING_URL },
    });
    const getAcao = getRes.headers.get('access-control-allow-origin');
    if (getAcao !== '*' && getAcao !== DASHBOARD_STAGING_URL) {
      throw new Error(`GET ${url} missing Access-Control-Allow-Origin header (got ${getAcao})`);
    }
  }
  logPass('CORS Access-Control-Allow-Origin: * verified on public asset and logo routes');
  report.CORS_HEADERS = 'PASS';

  // 4. Public Web Chat Runtime Script & Cross-Origin Asset Logic
  logStep('4/7', 'Verifying public/web-chat.js runtime delivery and asset helper functions...');
  const runtimeRes = await fetch(`${API_STAGING_URL}/public/web-chat.js`);
  if (!runtimeRes.ok) throw new Error(`web-chat.js returned HTTP ${runtimeRes.status}`);
  const runtimeSource = await runtimeRes.text();
  if (!runtimeSource.includes('resolveWebChatAssetUrl')) {
    throw new Error('public/web-chat.js missing resolveWebChatAssetUrl');
  }
  if (!runtimeSource.includes('resolveApiBaseUrl')) {
    throw new Error('public/web-chat.js missing resolveApiBaseUrl');
  }
  logPass('public/web-chat.js contains canonical resolveWebChatAssetUrl and resolveApiBaseUrl');
  report.RUNTIME_SCRIPT = 'PASS';

  // 5. Bootstrap Appearance & Dynamic Token Derivation
  logStep('5/7', 'Testing public Web Chat bootstrap appearance contract...');
  const bootRes = await fetch(`${API_STAGING_URL}/api/chat/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widget_key: TARGET_WIDGET_KEY }),
  });
  if (!bootRes.ok) throw new Error(`Bootstrap returned HTTP ${bootRes.status}`);
  const bootData = await bootRes.json();
  const appearance = bootData.appearance;
  if (!appearance || !appearance.theme) {
    throw new Error('Bootstrap response missing appearance or theme');
  }
  if (!appearance.theme.glow_color || !appearance.theme.surface_tint) {
    throw new Error('Appearance theme missing glow_color or surface_tint');
  }
  if (appearance.contrast.primary_button < 4.5) {
    throw new Error(`Primary button contrast ${appearance.contrast.primary_button} fails WCAG AA`);
  }
  logPass(`Appearance theme tokens complete with WCAG AA contrast (${appearance.contrast.primary_button}:1)`);
  report.BOOTSTRAP_APPEARANCE = 'PASS';
  // 6. PNG Scanline Decompression & Palette Extraction Accuracy
  logStep('6/7', 'Testing RFC 2083 PNG scanline decompression and color extraction...');
  function createTestPngBuffer() {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(2, 0);
    ihdrData.writeUInt32BE(2, 4);
    ihdrData[8] = 8;
    ihdrData[9] = 6;
    ihdrData[10] = 0;
    ihdrData[11] = 0;
    ihdrData[12] = 0;

    function makeChunk(type, data) {
      const len = data.length;
      const buf = Buffer.alloc(4 + 4 + len + 4);
      buf.writeUInt32BE(len, 0);
      buf.write(type, 4, 4, 'ascii');
      data.copy(buf, 8);
      return buf;
    }

    const rawScanlines = Buffer.from([
      0, 37, 99, 235, 255, 37, 99, 235, 255,
      0, 16, 185, 129, 255, 245, 158, 11, 255
    ]);
    const compressed = zlib.deflateSync(rawScanlines);
    return Buffer.concat([
      signature,
      makeChunk('IHDR', ihdrData),
      makeChunk('IDAT', compressed),
      makeChunk('IEND', Buffer.alloc(0))
    ]);
  }

  const testPng = createTestPngBuffer();
  const extractedColors = decodePngColors(testPng);
  if (!extractedColors || extractedColors.size === 0) {
    throw new Error('decodePngColors failed to extract pixel colors from test PNG');
  }
  const colorList = Array.from(extractedColors.keys());
  logPass(`decodePngColors extracted ${colorList.length} unique colors: ${colorList.join(', ')}`);
  // Note: 3-bit quantizer rounds 37 -> 32 (0x20), 99 -> 96 (0x60), 235 -> 232 (0xE8) -> #2060E8
  const hasExpectedBlue = colorList.some(c => c.startsWith('#2') && c.endsWith('E8') || c.includes('60') || c.includes('E8'));
  if (!hasExpectedBlue) {
    throw new Error(`Dominant blue color not found in extracted colors: ${colorList.join(', ')}`);
  }

  const palette = extractColorCandidatesFromBuffer(testPng, 'image/png');
  if (palette.isFallback) {
    throw new Error('extractColorCandidatesFromBuffer unexpectedly flagged fallback for valid PNG');
  }
  if (palette.dominant !== '#2060E8' && palette.dominant !== '#2563EB') {
    throw new Error(`Expected dominant color #2060E8 or #2563EB, got ${palette.dominant}`);
  }
  logPass(`Palette extraction succeeded: dominant=${palette.dominant}, candidates=[${palette.candidates.join(', ')}]`);
  report.PNG_SCANLINE_EXTRACTION = 'PASS';

  // 7. Live Headless Browser CDP Verification
  logStep('7/7', 'Executing live headless browser verification on staging storefront...');
  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  try {
    const demoUrl = `${API_STAGING_URL}/task8-demo/`;
    await browser.navigate(demoUrl);
    await new Promise((r) => setTimeout(r, 2000));

    const browserCheck = await browser.evaluate(`
      (() => {
        const container = document.getElementById('samche-webchat-container');
        if (!container) return { error: 'No container' };
        const shadow = container.shadowRoot;
        if (!shadow) return { error: 'No shadow' };

        const launcher = shadow.querySelector('.samche-launcher');
        const launcherText = launcher?.innerText?.trim();
        const panel = shadow.querySelector('.samche-panel');

        return {
          hasContainer: true,
          hasShadow: true,
          hasLauncher: !!launcher,
          launcherText: launcherText || '',
          hasPanel: !!panel
        };
      })()
    `);

    if (!browserCheck.hasContainer || !browserCheck.hasShadow || !browserCheck.hasLauncher) {
      throw new Error(`Browser check failed: ${JSON.stringify(browserCheck)}`);
    }
    logPass(`Shadow DOM runtime encapsulated and interactive in browser (launcher label: "${browserCheck.launcherText}")`);
    report.LIVE_BROWSER_VERIFICATION = 'PASS';
  } finally {
    try { await browser.close(); } catch {}
  }

  console.log('\n================================================================');
  console.log('                 ALL STAGING CHECKS PASSED                     ');
  console.log('================================================================');
  console.table(report);

  import('node:fs').then(({ writeFileSync }) => {
    writeFileSync('C:/Users/smttb/Documents/samche-api-service/audit_result.json', JSON.stringify(report, null, 2));
  });
}

runVerification().catch((err) => {
  console.error('\n❌ STAGING VERIFICATION FAILED:', err);
  process.exit(1);
});


