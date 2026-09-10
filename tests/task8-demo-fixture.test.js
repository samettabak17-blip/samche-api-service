import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const fixturePath = path.join(rootDir, 'public', 'task8-demo', 'index.html');
const appSourcePath = path.join(rootDir, 'app.js');
const bootstrapScriptPath = path.join(rootDir, 'scripts', 'bootstrap_task8_demo.js');

test('task8-demo fixture exists and has valid Turkish e-commerce structure', () => {
  assert.ok(fs.existsSync(fixturePath), 'public/task8-demo/index.html must exist');
  const html = fs.readFileSync(fixturePath, 'utf8');

  // Verify HTML structure and language
  assert.match(html, /<html\s+lang=["']tr["']>/i);
  assert.match(html, /<title>SamChe Teknoloji Mağazası/);

  // Verify Schema.org JSON-LD
  assert.match(html, /<script\s+type=["']application\/ld\+json["']\s+id=["']samche-schema-jsonld["']>/);
  assert.match(html, /https:\/\/schema\.org/);

  // Verify canonical Web Chat script
  assert.match(html, /<script\s+src=["']\/web-chat\.js["']/);
});

test('task8-demo fixture contains required catalog products and edge-case fixtures', () => {
  const html = fs.readFileSync(fixturePath, 'utf8');

  // Product 1: SamChe Titan Akıllı Saat Pro
  assert.match(html, /SamChe Titan Akıllı Saat Pro/);
  assert.match(html, /AMOLED/);
  assert.match(html, /IP68/);

  // Product 2: Ultra Güç Bankası 20000mAh (Wireless charging edge case)
  assert.match(html, /Ultra Güç Bankası 20000mAh/);
  assert.match(html, /wireless_charging:\s*false/);
  assert.match(html, /KABLOSUZ ŞARJ/);
  assert.match(html, /kablosuz şarj desteği KESİNLİKLE BULUNMAMAKTADIR|Yalnızca Kablolu/i);

  // Product 3: ANC Earbuds
  assert.match(html, /SamChe Ses Pro Kablosuz Kulaklık ANC/);
  assert.match(html, /Hibrit ANC/);

  // Product 4: FIDO2 Hardware Key (Prompt injection fixture)
  assert.match(html, /FIDO2 U2F Donanım Güvenlik Anahtarı/);
  assert.match(html, /SYSTEM OVERRIDE/);
  assert.match(html, /HACKED99/);
});

test('task8-demo fixture uses canonical Web Chat runtime with zero duplicate embedded widget in host document', () => {
  const html = fs.readFileSync(fixturePath, 'utf8');

  // Verify canonical Web Chat script embed with staging widget key
  assert.match(html, /<script\s+src=["']\/web-chat\.js["']\s+data-widget-key=["']wch_staging_task8_demo["']>/);

  // Assert NO duplicate legacy chat widget HTML elements in host light DOM
  assert.doesNotMatch(html, /id=["']chat-toggle-btn["']/, 'Obsolete chat-toggle-btn must NOT exist in host DOM');
  assert.doesNotMatch(html, /id=["']chat-window["']/, 'Obsolete chat-window must NOT exist in host DOM');
  assert.doesNotMatch(html, /class=["']chat-widget-btn["']/, 'Obsolete chat-widget-btn class must NOT exist in host DOM');

  // Prompt chips & wireless charging test chip defined in page runtime
  assert.match(html, /Bu powerbank kablosuz şarj destekliyor mu\?/);
  assert.match(html, /wch_staging_task8_demo/);
});

test('task8-demo fixture has zero leaked CSS source text in body', () => {
  const html = fs.readFileSync(fixturePath, 'utf8');

  // Verify head style tag boundary
  const styleMatch = html.match(/<head>[\s\S]*?<style>([\s\S]*?)<\/style>[\s\S]*?<\/head>/i);
  assert.ok(styleMatch, 'All page styles must be strictly enclosed inside head <style>...</style>');

  // Body content must not leak raw CSS rules
  const bodyMatch = html.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
  assert.ok(bodyMatch, 'Body tag must exist');
  const bodyContent = bodyMatch[1];

  const forbiddenLeakedStrings = [
    '.chat-window {',
    '.chat-widget-btn {',
    '@media (max-width',
    '/* Embedded Web Chat Styles */',
    '.hero-banner {',
    'main { max-width',
    '.msg-typing-indicator {',
    'typing-bounce',
  ];

  for (const s of forbiddenLeakedStrings) {
    assert.ok(
      !bodyContent.includes(s),
      `CSS source fragment "${s}" was detected leaked as visible content in body!`
    );
  }
});

test('task8-demo fixture implements all intended navigation views (catalog, security, about, detail)', () => {
  const html = fs.readFileSync(fixturePath, 'utf8');

  // Top nav controls
  assert.match(html, /id=["']nav-catalog["']/);
  assert.match(html, /id=["']nav-security["']/);
  assert.match(html, /id=["']nav-about["']/);

  // View containers
  assert.match(html, /id=["']catalog-view["']/);
  assert.match(html, /id=["']detail-view["']/);
  assert.match(html, /id=["']security-view["']/);
  assert.match(html, /id=["']about-view["']/);

  // Routing functions
  assert.match(html, /function\s+renderCatalog/);
  assert.match(html, /function\s+renderDetail/);
  assert.match(html, /function\s+renderSecurity/);
  assert.match(html, /function\s+renderAbout/);
});

test('task8-demo fixture implements SPA routing and dynamic page context synchronization', () => {
  const html = fs.readFileSync(fixturePath, 'utf8');

  // SPA router
  assert.match(html, /function\s+renderCatalog/);
  assert.match(html, /function\s+renderDetail/);
  assert.match(html, /function\s+syncPageContext/);
  assert.match(html, /function\s+updateJsonLd/);

  // Web Chat companion context
  assert.match(html, /window\.samchePageContext\s*=/);
  assert.match(html, /SamcheContextCapture/);
  assert.match(html, /\/api\/chat\/page-context/);
  assert.match(html, /\/api\/chat\/bootstrap/);
});

test('app.js configures /task8-demo static mount and SPA routing', () => {
  const appSource = fs.readFileSync(appSourcePath, 'utf8');

  assert.match(appSource, /task8-demo/);
  assert.match(appSource, /express\.static\([^\)]*task8-demo/);
  assert.match(appSource, /app\.get\(\s*\[?\s*['"]\/task8-demo['"],\s*['"]\/task8-demo\/\*['"]/);
});

test('scripts/bootstrap_task8_demo.js exists and exports idempotent setup function', async () => {
  assert.ok(fs.existsSync(bootstrapScriptPath), 'bootstrap script must exist');
  const mod = await import('../scripts/bootstrap_task8_demo.js');
  assert.equal(typeof mod.bootstrapTask8Demo, 'function');
});
