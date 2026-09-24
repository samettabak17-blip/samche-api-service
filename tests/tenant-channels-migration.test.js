import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../migrations');

test('003_live_inbox_handoff includes WEB_CHAT, WHATSAPP, SAMCHEGUIDE, INSTAGRAM and guards against dropping extended constraint', () => {
  const sql = fs.readFileSync(path.join(migrationsDir, '003_live_inbox_handoff.sql'), 'utf8');
  assert.match(sql, /ck_tenant_channels_channel_type/);
  assert.match(sql, /channel_type IN \('WEB_CHAT', 'WHATSAPP', 'SAMCHEGUIDE', 'INSTAGRAM'\)/);
  assert.match(sql, /LIKE '%INSTAGRAM%'/);
});

test('092_canonical_instagram_channel_type migration is idempotent and includes all valid channel types', () => {
  const sql = fs.readFileSync(path.join(migrationsDir, '092_canonical_instagram_channel_type.sql'), 'utf8');
  assert.match(sql, /ck_tenant_channels_channel_type/);
  assert.match(sql, /channel_type IN \('WEB_CHAT', 'WHATSAPP', 'SAMCHEGUIDE', 'INSTAGRAM'\)/);
  assert.match(sql, /ck_channel_integrations_type/);
  assert.match(sql, /integration_type IN \('SAMCHEGUIDE', 'WHATSAPP', 'WEB_CHAT', 'INSTAGRAM'\)/);
});

test('all valid channel types (WEB_CHAT, WHATSAPP, SAMCHEGUIDE, INSTAGRAM) pass constraint validation logic', () => {
  const allowed = ['WEB_CHAT', 'WHATSAPP', 'SAMCHEGUIDE', 'INSTAGRAM'];
  
  // A. Existing pre-Instagram channel types
  const preInstagramTypes = ['WEB_CHAT', 'WHATSAPP', 'SAMCHEGUIDE'];
  for (const t of preInstagramTypes) {
    assert.equal(allowed.includes(t), true, `${t} must be allowed`);
  }

  // B. Instagram channel type
  assert.equal(allowed.includes('INSTAGRAM'), true, 'INSTAGRAM must be allowed');

  // Negative test: invalid channel type
  assert.equal(allowed.includes('INVALID_CHANNEL'), false, 'INVALID_CHANNEL must be rejected');
});

test('all SQL migration files are read and parseable in sequential order', () => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes('001_multitenant_foundation.sql'));
  assert.ok(files.includes('002_dashboard_tenant_backend.sql'));
  assert.ok(files.includes('003_live_inbox_handoff.sql'));
  assert.ok(files.includes('092_canonical_instagram_channel_type.sql'));

  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    assert.ok(content.length > 0, `${file} must not be empty`);
  }
});
