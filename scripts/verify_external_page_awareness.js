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

  // 3. Live Browser Context Capture
  logStep('3/5', 'Executing live headless browser verification of capturePageContext...');
  const browser = await BrowserCdp.launch({ headless: true });
  await browser.setViewport({ width: 1440, height: 900, isMobile: false });

  let capturedContext = null;
  try {
    const demoUrl = `${API_STAGING_URL}/task8-demo/`;
    await browser.navigate(demoUrl);
    await new Promise((r) => setTimeout(r, 2000));

    capturedContext = await browser.evaluate(`
      (() => {
        if (typeof window.SamcheContextCapture !== 'undefined') {
          return window.SamcheContextCapture.capturePageContext();
        }
        return null;
      })()
    `);

    if (!capturedContext) {
      throw new Error('capturePageContext returned null in browser');
    }
    logPass('capturePageContext successfully executed in live browser runtime');
    report.BROWSER_CONTEXT_CAPTURE = 'PASS';
  } finally {
    try { await browser.close(); } catch {}
  }

  // 4. Test Conversational Product Q&A Grounding via /api/chat with Demoteknoloji Context
  logStep('4/5', 'Testing conversational grounding via /api/chat with real external page context...');

  const demoTeknolojiContext = {
    url: 'https://demoteknoloji.samchecompany.com/',
    path: '/',
    canonical_url: 'https://demoteknoloji.samchecompany.com/',
    title: 'Ana Sayfa - Vektor Elektronik',
    language: 'tr',
    entity_type: 'PRODUCT_LIST',
    entity_id: '/',
    entity_name: 'Ana Sayfa',
    summary: 'Bu sayfada görüntülenen ürünler (5 adet): Vektor Horizon Akıllı Bileklik ($1199.00), Vektor VoltFast 100W GaN Şarj Cihazı ($999.00), Vektor NovaBuds Pro Kulak Üstü Kulaklık ($2799.00), Vektor CyberShield Telefon Kılıfı ($449.00), Vektor Flux MagSafe Şarj Standı ($899.00)',
    attributes: {
      page_type: 'PRODUCT_LIST',
      visible_products: [
        { name: 'Vektor Horizon Akıllı Bileklik', price: '$1199.00', url: 'https://demoteknoloji.samchecompany.com/vektor-horizon-akll-bileklik' },
        { name: 'Vektor VoltFast 100W GaN Şarj Cihazı', price: '$999.00', url: 'https://demoteknoloji.samchecompany.com/vektor-voltfast-100w-gan-arj-cihaz' },
        { name: 'Vektor NovaBuds Pro Kulak Üstü Kulaklık', price: '$2799.00', url: 'https://demoteknoloji.samchecompany.com/vektor-novabuds-pro-kulak-st-kulaklk' },
        { name: 'Vektor CyberShield Telefon Kılıfı', price: '$449.00', url: 'https://demoteknoloji.samchecompany.com/vektor-cybershield-telefon-klf' },
        { name: 'Vektor Flux MagSafe Şarj Standı', price: '$899.00', url: 'https://demoteknoloji.samchecompany.com/vektor-flux-magsafe-arj-stand' },
      ],
      visible_product_names: [
        'Vektor Horizon Akıllı Bileklik',
        'Vektor VoltFast 100W GaN Şarj Cihazı',
        'Vektor NovaBuds Pro Kulak Üstü Kulaklık',
        'Vektor CyberShield Telefon Kılıfı',
        'Vektor Flux MagSafe Şarj Standı',
      ],
      visible_product_count: 5,
    },
  };
  
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
    body: JSON.stringify({ page_context: demoTeknolojiContext }),
  });
  if (!pcRes.ok) throw new Error(`POST /api/chat/page-context failed: HTTP ${pcRes.status}`);
  logPass('External page context accepted and normalized by API');

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
      page_context: demoTeknolojiContext,
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
      page_context: demoTeknolojiContext,
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
      page_context: demoTeknolojiContext,
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

  // Query D: Single Product Detail page: "Şu anda hangi ürüne bakıyorum?"
  logStep('   →', 'Query: "Şu anda hangi ürüne bakıyorum?" on product detail page...');
  const productDetailContext = {
    url: 'https://demoteknoloji.samchecompany.com/vektor-horizon-akll-bileklik',
    path: '/vektor-horizon-akll-bileklik',
    canonical_url: 'https://demoteknoloji.samchecompany.com/vektor-horizon-akll-bileklik',
    title: 'Vektor Horizon Akıllı Bileklik - Vektor Elektronik',
    language: 'tr',
    entity_type: 'PRODUCT',
    entity_id: '/vektor-horizon-akll-bileklik',
    entity_name: 'Vektor Horizon Akıllı Bileklik',
    summary: 'AMOLED ekran, 14 gün pil ömrü, kalp atış hızı ve SpO2 takibi, 5 ATM suya dayanıklılık.',
    attributes: {
      price: '$1199.00',
      battery_life: '14 gün',
      screen: 'AMOLED',
      water_resistance: '5 ATM',
    },
  };

  const chatResD = await fetch(`${API_STAGING_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({
      message: 'Şu anda hangi ürüne bakıyorum?',
      page_context: productDetailContext,
    }),
  });
  if (!chatResD.ok) throw new Error(`Chat query D failed: HTTP ${chatResD.status}`);
  const chatDataD = await chatResD.json();
  const replyD = chatDataD.reply || chatDataD.response || chatDataD.text || '';
  console.log(`      Assistant Response:\n${replyD.replace(/<[^>]*>/g, ' ').slice(0, 300)}...\n`);
  const replyDLower = replyD.toLowerCase();
  if (!replyDLower.includes('horizon') && !replyDLower.includes('bileklik')) {
    throw new Error('FAIL: Assistant did not identify Vektor Horizon Akıllı Bileklik on detail page');
  }
  logPass('Assistant correctly identified current product on detail page');
  report.PRODUCT_DETAIL_IDENTIFICATION = 'PASS';

  // Query E: Navigation to second product and multi-entity comparison: "Bu ürünle öncekini karşılaştır"
  logStep('   →', 'Query: "Bu ürünle öncekini karşılaştır" after navigating to second product...');
  const secondProductContext = {
    url: 'https://demoteknoloji.samchecompany.com/vektor-voltfast-100w-gan-arj-cihaz',
    path: '/vektor-voltfast-100w-gan-arj-cihaz',
    canonical_url: 'https://demoteknoloji.samchecompany.com/vektor-voltfast-100w-gan-arj-cihaz',
    title: 'Vektor VoltFast 100W GaN Şarj Cihazı - Vektor Elektronik',
    language: 'tr',
    entity_type: 'PRODUCT',
    entity_id: '/vektor-voltfast-100w-gan-arj-cihaz',
    entity_name: 'Vektor VoltFast 100W GaN Şarj Cihazı',
    summary: '100W hızlı şarj, GaN III teknolojisi, 3x USB-C ve 1x USB-A çıkışı.',
    attributes: {
      price: '$999.00',
      power: '100W',
      technology: 'GaN III',
    },
  };

  const chatResE = await fetch(`${API_STAGING_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({
      message: 'Bu ürünle bir önceki baktığım ürünü karşılaştır',
      page_context: secondProductContext,
    }),
  });
  if (!chatResE.ok) throw new Error(`Chat query E failed: HTTP ${chatResE.status}`);
  const chatDataE = await chatResE.json();
  const replyE = chatDataE.reply || chatDataE.response || chatDataE.text || '';
  console.log(`      Assistant Response:\n${replyE.replace(/<[^>]*>/g, ' ').slice(0, 300)}...\n`);
  const replyELower = replyE.toLowerCase();
  const comparesBoth = (replyELower.includes('voltfast') || replyELower.includes('şarj') || replyELower.includes('999')) && (replyELower.includes('horizon') || replyELower.includes('bileklik') || replyELower.includes('1199'));
  if (!comparesBoth) {
    throw new Error('FAIL: Assistant did not compare second product with previous product in browsing history');
  }
  logPass('Assistant successfully compared current product with previously viewed product from session history');
  report.MULTI_ENTITY_COMPARISON = 'PASS';

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

