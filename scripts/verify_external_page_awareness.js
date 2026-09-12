/**
 * scripts/verify_external_page_awareness.js
 * Verification of external site page awareness, generic product extraction,
 * grounded conversational Q&A, and support intent coexistence.
 */

import { BrowserCdp } from '../tests/helpers/browser-cdp.js';

const API_STAGING_URL = (process.env.STAGING_SERVICE_URL || 'https://samche-api-staging.onrender.com').trim().replace(/\/+$/, '');
const EXTERNAL_DEMO_URL = 'https://demoteknoloji.samchecompany.com/';
const TARGET_WIDGET_KEY = 'wch_staging_task8_demo';

function logStep(step, msg) {
  console.log(`[${step}] ${msg}`);
}

function logPass(msg) {
  console.log(`    ✓ ${msg}`);
}

async function runAudit() {
  console.log('================================================================');
  console.log('  SAMCHE EXTERNAL PAGE AWARENESS & PRODUCT GROUNDING AUDIT     ');
  console.log('================================================================');
  console.log(`API Origin:       ${API_STAGING_URL}`);
  console.log(`External Site:    ${EXTERNAL_DEMO_URL}`);
  console.log(`Widget Key:       ${TARGET_WIDGET_KEY}\n`);

  const report = {};

  // 1. API Health & Revision Check
  logStep('1/5', 'Checking deployed API health & revision...');
  const healthRes = await fetch(`${API_STAGING_URL}/api/v1/health`);
  if (!healthRes.ok) throw new Error(`API health check returned HTTP ${healthRes.status}`);
  const healthData = await healthRes.json();
  logPass(`API Health OK. Revision: ${healthData.revision}`);
  report.API_HEALTH = 'PASS';

  // 2. Public Runtime Script Features Check
  logStep('2/5', 'Auditing public/web-chat.js generic extraction features...');
  const runtimeRes = await fetch(`${API_STAGING_URL}/public/web-chat.js`);
  if (!runtimeRes.ok) throw new Error(`web-chat.js returned HTTP ${runtimeRes.status}`);
  const runtimeSource = await runtimeRes.text();

  if (!runtimeSource.includes('extractVisibleProductsFromDom')) {
    throw new Error('public/web-chat.js missing extractVisibleProductsFromDom');
  }
  if (!runtimeSource.includes('extractSingleProductDetail')) {
    throw new Error('public/web-chat.js missing extractSingleProductDetail');
  }
  logPass('public/web-chat.js contains generic semantic product extraction architecture');
  report.RUNTIME_EXTRACTION = 'PASS';

  // 3. Live Browser Context Capture on External Site
  logStep('3/5', 'Executing headless browser capture on https://demoteknoloji.samchecompany.com/...');
  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  let capturedContext = null;
  try {
    await browser.navigate(EXTERNAL_DEMO_URL);
    await new Promise((r) => setTimeout(r, 2500));

    capturedContext = await browser.evaluate(`
      (() => {
        if (typeof window.SamcheContextCapture !== 'undefined') {
          return window.SamcheContextCapture.capturePageContext();
        }
        return null;
      })()
    `);

    if (!capturedContext) {
      throw new Error('capturePageContext returned null on external site');
    }

    const prods = capturedContext.attributes?.visible_products || [];
    if (prods.length < 3) {
      throw new Error(`Expected at least 3 visible products on external site, got ${prods.length}: ${JSON.stringify(prods)}`);
    }

    logPass(`Successfully extracted ${prods.length} visible products from external DOM:`);
    prods.forEach((p, idx) => {
      console.log(`      ${idx + 1}. ${p.name} (${p.price || 'No price'})`);
    });
    report.EXTERNAL_DOM_CAPTURE = 'PASS';
    report.EXTRACTED_PRODUCTS_COUNT = prods.length;
  } finally {
    try { await browser.close(); } catch {}
  }
  // 4. Test Conversational Product Q&A Grounding via /api/chat
  logStep('4/5', 'Testing conversational grounding via /api/chat with captured external context...');
  
  const bootRes = await fetch(`${API_STAGING_URL}/api/chat/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widget_key: TARGET_WIDGET_KEY }),
  });
  if (!bootRes.ok) throw new Error(`Bootstrap failed: HTTP ${bootRes.status}`);
  const bootData = await bootRes.json();
  const sessionToken = bootData.session;
  if (!sessionToken) throw new Error('Bootstrap did not return session token');

  const pcRes = await fetch(`${API_STAGING_URL}/api/chat/page-context`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({ page_context: capturedContext }),
  });
  if (!pcRes.ok) throw new Error(`POST /api/chat/page-context failed: HTTP ${pcRes.status}`);
  logPass('Page context accepted and normalized by API');

  // Query A: "bu sayfada hangi ürünler var"
  logStep('   →', 'Query: "bu sayfada hangi ürünler var"');
  const chatResA = await fetch(`${API_STAGING_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({
      message: 'bu sayfada hangi ürünler var',
      page_context: capturedContext,
    }),
  });
  if (!chatResA.ok) throw new Error(`Chat query A failed: HTTP ${chatResA.status}`);
  const chatDataA = await chatResA.json();
  const replyA = chatDataA.reply || chatDataA.response || chatDataA.text || '';
  console.log(`      Assistant Response:\n${replyA.replace(/<[^>]*>/g, ' ').slice(0, 300)}...\n`);

  const replyALower = replyA.toLowerCase();
  if (replyALower.includes('göremiyorum') || replyALower.includes('bulunduğunu belirleyemiyorum')) {
    throw new Error('FAIL: Assistant stated it cannot see the products on the page!');
  }
  const hasHorizon = replyALower.includes('horizon') || replyALower.includes('bileklik');
  const hasVoltFast = replyALower.includes('voltfast') || replyALower.includes('şarj');
  if (!hasHorizon && !hasVoltFast) {
    throw new Error('FAIL: Assistant response did not name the visible products on the page!');
  }
  logPass('Assistant correctly named and grounded visible products on the current page');
  report.PRODUCT_LIST_QUERY = 'PASS';

  // Query B: "en uygun olan hangisi"
  logStep('   →', 'Query: "en uygun olan hangisi"');
  const chatResB = await fetch(`${API_STAGING_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({
      message: 'en uygun olan hangisi',
      page_context: capturedContext,
    }),
  });
  if (!chatResB.ok) throw new Error(`Chat query B failed: HTTP ${chatResB.status}`);
  const chatDataB = await chatResB.json();
  const replyB = chatDataB.reply || chatDataB.response || chatDataB.text || '';
  console.log(`      Assistant Response:\n${replyB.replace(/<[^>]*>/g, ' ').slice(0, 300)}...\n`);

  const replyBLower = replyB.toLowerCase();
  const identifiesAffordable = replyBLower.includes('449') || replyBLower.includes('cybershield') || replyBLower.includes('kılıf');
  if (!identifiesAffordable) {
    throw new Error('FAIL: Assistant did not identify CyberShield ($449) as the most affordable product');
  }
  logPass('Assistant correctly identified CyberShield as the most affordable product based on page facts');
  report.PRODUCT_COMPARE_QUERY = 'PASS';

  // 5. Test Support Intent Coexistence
  logStep('5/5', 'Testing support intent coexistence ("ürünü iade etmek istiyorum")...');
  const chatResC = await fetch(`${API_STAGING_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({
      message: 'ürünü iade etmek istiyorum, nasıl yaparım?',
      page_context: capturedContext,
    }),
  });
  if (!chatResC.ok) throw new Error(`Chat query C failed: HTTP ${chatResC.status}`);
  const chatDataC = await chatResC.json();
  const replyC = chatDataC.reply || chatDataC.response || chatDataC.text || '';
  console.log(`      Assistant Response:\n${replyC.replace(/<[^>]*>/g, ' ').slice(0, 300)}...\n`);

  const replyCLower = replyC.toLowerCase();
  const hasSupportGuidance = replyCLower.includes('iade') || replyCLower.includes('destek') || replyCLower.includes('gün') || replyCLower.includes('kargo');
  if (!hasSupportGuidance) {
    throw new Error('FAIL: Assistant did not provide return/support guidance');
  }
  logPass('Support intent correctly coexists with page awareness (provides policy guidance rather than forcing product specs)');
  report.SUPPORT_INTENT_COEXISTENCE = 'PASS';

  console.log('\n================================================================');
  console.log('             ALL EXTERNAL PAGE AWARENESS CHECKS PASSED          ');
  console.log('================================================================');
  console.table(report);

  const { writeFileSync } = await import('node:fs');
  writeFileSync('C:/Users/smttb/Documents/samche-api-service/external_page_awareness_result.json', JSON.stringify(report, null, 2));
}

runAudit().catch((err) => {
  console.error('\n❌ EXTERNAL PAGE AWARENESS AUDIT FAILED:', err);
  process.exit(1);
});

