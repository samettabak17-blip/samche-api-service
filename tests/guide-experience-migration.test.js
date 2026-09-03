import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Guide Experience migration is additive, versioned, tenant scoped, and enforces one published version per guide scope', () => {
  const sql = fs.readFileSync(new URL('../migrations/056_guide_experience_platform.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS guide_experience_versions/i);
  assert.match(sql, /tenant_id UUID NOT NULL/i);
  assert.match(sql, /assistant_id UUID NOT NULL/i);
  assert.match(sql, /status VARCHAR\(24\).*DRAFT.*PUBLISHED.*ARCHIVED/is);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS uq_guide_experience_one_published/i);
  assert.match(sql, /WHERE status = 'PUBLISHED'/i);
  assert.match(sql, /guide_experience_audit_events/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+(?:tenants|ai_assistants|tenant_channels)/i);
});

test('Guide Experience asset migration uses scoped private storage metadata without widening public access', () => {
  const sql = fs.readFileSync(new URL('../migrations/057_guide_experience_assets_and_rollback.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS guide_experience_assets/i);
  assert.match(sql, /tenant_id UUID NOT NULL/i);
  assert.match(sql, /assistant_id UUID NOT NULL/i);
  assert.match(sql, /storage_key TEXT NOT NULL UNIQUE/i);
  assert.match(sql, /image\/png.*image\/jpeg.*image\/webp/is);
  assert.match(sql, /size_bytes INTEGER NOT NULL CHECK \(size_bytes > 0 AND size_bytes <= 5242880\)/i);
  assert.doesNotMatch(sql, /public_url|api_key|credential/i);
});

test('Guide domain migration is additive, hostname-unique, tenant/assistant scoped, and lifecycle-bound', () => {
  const sql = fs.readFileSync(new URL('../migrations/058_guide_custom_domains.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS guide_domains/i);
  assert.match(sql, /hostname VARCHAR\(253\) NOT NULL/i);
  assert.match(sql, /UNIQUE \(hostname\)/i);
  assert.match(sql, /hostname = lower\(hostname\)/i);
  assert.match(sql, /PENDING.*VERIFIED.*ACTIVE.*FAILED.*ARCHIVED/is);
  assert.match(sql, /channel_id UUID NOT NULL/i);
  assert.match(sql, /guide_domain_audit_events/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+(?:tenants|ai_assistants|tenant_channels)/i);
});
