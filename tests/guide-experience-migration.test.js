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
