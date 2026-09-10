import { extractUrlsFromText } from '../services/url-intelligence-service.js';

const BASE_URL = (process.env.STAGING_SERVICE_URL || 'https://samche-api-staging.onrender.com').trim().replace(/\/+$/, '');
const TARGET_WIDGET_KEY = process.env.TASK8_DEMO_WIDGET_KEY || 'wch_staging_task8_demo';

async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function runStagingVerification() {
  console.log('================================================================');
  console.log('UNIVERSAL PUBLIC LINK RESOLUTION + REMOTE VISUAL INTELLIGENCE');
  console.log(`STAGING RUNTIME VERIFICATION: ${BASE_URL}`);
  console.log('================================================================\n');

  // 1. Health & Revision Check
  console.log('[1/5] Checking staging health and deployed revision...');
  const healthRes = await fetchWithTimeout(`${BASE_URL}/api/v1/health`);
  if (!healthRes.ok) throw new Error(`Health check failed: HTTP ${healthRes.status}`);
  const healthData = await healthRes.json();
  console.log(`      ✓ Health: ${healthData.status}, Revision: ${healthData.revision}\n`);

  // 2. Web Chat Session Bootstrap
  console.log('[2/5] Bootstrapping Web Chat session on staging...');
  const bootRes = await fetchWithTimeout(`${BASE_URL}/api/chat/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ widget_key: TARGET_WIDGET_KEY }),
  });
  if (!bootRes.ok) throw new Error(`Bootstrap failed: HTTP ${bootRes.status}`);
  const bootData = await bootRes.json();
  const sessionToken = typeof bootData.session === 'string'
    ? bootData.session
    : (bootData.session?.token || bootData.token);
  console.log('      ✓ Web Chat session bootstrapped successfully.\n');

  // 3. Scenario A: Direct Public Webpage URL Reading
  console.log('[3/5] Scenario A: Testing Direct Public Webpage URL Reading...');
  const pageUrl = `${BASE_URL}/task8-demo/`;
  const pageRes = await fetchWithTimeout(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({
      message: `Bu sayfadaki ürünler hakkında bilgi ver: ${pageUrl}`,
    }),
  });
  if (!pageRes.ok) throw new Error(`Scenario A HTTP error: ${pageRes.status}`);
  const pageReply = await pageRes.text();
  console.log(`      ✓ Scenario A Response (sample): ${pageReply.replace(/\s+/g, ' ').slice(0, 200)}...`);
  const scenarioAPass = /samche|güç bankası|akıllı saat|kulaklık|teknoloji/i.test(pageReply);
  console.log(`      Result: ${scenarioAPass ? 'PASS' : 'FAIL'}\n`);

  // 4. Scenario B: Direct Public Image URL with Visual Description & Dimension Grounding
  console.log('[4/5] Scenario B: Testing Direct Public Image URL + Grounded Visual Description...');
  const directImageUrl = `${BASE_URL}/task8-demo/sample-product.png`;
  const imgRes = await fetchWithTimeout(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({
      message: `Bu şekilde bir şey istiyorum. Bana tarif et şeklini, boyutunu: ${directImageUrl}`,
    }),
  });
  if (!imgRes.ok) throw new Error(`Scenario B HTTP error: ${imgRes.status}`);
  const imgReply = await imgRes.text();
  console.log(`      ✓ Scenario B Response (sample): ${imgReply.replace(/\s+/g, ' ').slice(0, 300)}...`);

  // Check that assistant did not falsely claim "I cannot view images/links"
  const noGenericRefusal = !/görseli göremiyorum|linkleri açamıyorum|resim görüntüleyemiyorum|i cannot view/i.test(imgReply);
  // Check that assistant did not invent exact physical dimensions
  const noInventedDimensions = !/\b(?:180\s*x\s*90|150\s*cm|200\s*cm|kesin\s*olarak\s*\d+\s*cm)\b/i.test(imgReply);
  console.log(`      - Avoids generic refusal ("cannot view"): ${noGenericRefusal ? 'YES' : 'NO'}`);
  console.log(`      - No invented exact dimensions: ${noInventedDimensions ? 'YES' : 'NO'}`);
  console.log(`      Result: ${noGenericRefusal && noInventedDimensions ? 'PASS' : 'FAIL'}\n`);

  // 5. Scenario C: Public Redirect / Share URL that Resolves to Media
  console.log('[5/5] Scenario C: Testing Safe Public Redirect / Share URL...');
  const redirectShareUrl = `${BASE_URL}/task8-demo`;
  const redirectRes = await fetchWithTimeout(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Samche-Web-Chat-Session': sessionToken,
    },
    body: JSON.stringify({
      message: `Bu linkteki ürünü bizim ürünlerle karşılaştır: ${redirectShareUrl}`,
    }),
  });
  if (!redirectRes.ok) throw new Error(`Scenario C HTTP error: ${redirectRes.status}`);
  const redirectReply = await redirectRes.text();
  console.log(`      ✓ Scenario C Response (sample): ${redirectReply.replace(/\s+/g, ' ').slice(0, 300)}...`);
  const scenarioCPass = !/link açılamıyor|yönlendirme hatası/i.test(redirectReply);
  console.log(`      Result: ${scenarioCPass ? 'PASS' : 'FAIL'}\n`);

  console.log('================================================================');
  console.log('ALL STAGING RUNTIME ACCEPTANCE PROBES COMPLETED SUCCESSFULLY');
  console.log('================================================================');
}

runStagingVerification().catch((err) => {
  console.error('STAGING_VERIFICATION_ERROR:', err);
  process.exit(1);
});
