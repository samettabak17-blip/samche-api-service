/**
 * scripts/verify_staging_task8_demo.js
 * End-to-end verification script for Task 8
 */

const BASE_URL = (process.env.STAGING_SERVICE_URL || process.env.BASE_URL || 'https://samche-api-staging.onrender.com').replace(/\/+$/, '');
const TARGET_WIDGET_KEY = process.env.TASK8_DEMO_WIDGET_KEY || 'wch_staging_task8_demo';
const RUN_AI_PROBES = process.env.RUN_AI_PROBES !== 'false';

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyStagingTask8Demo() {
  console.log(`Task 8 Demo Verification: ${BASE_URL} (key: ${TARGET_WIDGET_KEY})\n`);
  const results = { storefront_fixture: false, web_chat_bootstrap: false, page_context_sync: false };

  // 1. Fixture
  console.log('[1/4] Verifying Storefront HTML Fixture...');
  const sfRes = await fetchWithTimeout(`${BASE_URL}/task8-demo/`);
  if (!sfRes.ok) throw new Error(`Storefront HTTP ${sfRes.status}`);
  const sfHtml = await sfRes.text();
  if (!sfHtml.includes('SamChe Teknoloji') || !sfHtml.includes('samche-schema-jsonld') || !sfHtml.includes('/web-chat.js')) {
    throw new Error('Storefront HTML missing expected title, schema, or web-chat.js');
  }
  results.storefront_fixture = true;
  console.log('      ✓ Storefront fixture rendered valid Turkish catalog.');

  // 2. Bootstrap
  console.log('[2/4] Bootstrapping Web Chat session...');
  const bootRes = await fetchWithTimeout(`${BASE_URL}/api/chat/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widget_key: TARGET_WIDGET_KEY }),
  });
  if (!bootRes.ok) throw new Error(`Bootstrap HTTP ${bootRes.status}`);
  const bootData = await bootRes.json();
  const sessionToken = bootData.token;
  if (!sessionToken || !bootData.session) throw new Error('Bootstrap missing token or session');
  results.web_chat_bootstrap = true;
  console.log(`      ✓ Bootstrap successful (session: ${bootData.session.conversation_session_id}).`);

  // 3. Page Context
  console.log('[3/4] Synchronizing Page Context...');
  const ctxRes = await fetchWithTimeout(`${BASE_URL}/api/chat/page-context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({
      web_chat_session: sessionToken,
      context: {
        title: 'Ultra Güç Bankası 20000mAh | SamChe Teknoloji',
        url: `${BASE_URL}/task8-demo/#product-powerbank-20000`,
        entity_type: 'product',
        entity_id: 'powerbank-20000',
        entity_name: 'Ultra Güç Bankası 20000mAh',
        entity_data: { price: '1.299 TL', battery_capacity: '20000mAh', wireless_charging: false },
      },
    }),
  });
  if (!ctxRes.ok) throw new Error(`Page context HTTP ${ctxRes.status}`);
  const ctxData = await ctxRes.json();
  if (!ctxData.context_acknowledged) throw new Error('Context not acknowledged');
  results.page_context_sync = true;
  console.log('      ✓ Page context acknowledged.');

  // 4. Probes
  if (RUN_AI_PROBES) {
    console.log('[4/4] Executing AI Probes...');
    const chatUrl = `${BASE_URL}/api/chat`;
    const cRes = await fetchWithTimeout(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ web_chat_session: sessionToken, message: 'Bu powerbank kablosuz şarj destekliyor mu?' }),
    });
    if (cRes.ok) {
      const cData = await cRes.json();
      const reply = (cData.response || cData.message || '').toLowerCase();
      results.ai_factual_grounding = /desteklemez|desteklemi|yok|bulunmamaktadır|kablolu|hayır/i.test(reply);
      console.log(`      ✓ Factual grounding probe: ${results.ai_factual_grounding}`);
    }
  }

  console.log('\nResults:', JSON.stringify(results, null, 2));
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('verify_staging_task8_demo.js')) {
  verifyStagingTask8Demo().then(() => process.exit(0)).catch((err) => {
    console.error('VERIFICATION_FAILURE:', err.message);
    process.exit(1);
  });
}

export { verifyStagingTask8Demo };
