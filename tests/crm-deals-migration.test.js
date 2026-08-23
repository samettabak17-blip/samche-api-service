import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/005_crm_deals_pipeline_metrics.sql', import.meta.url), 'utf8');

test('Deals extension reuses CRM tables and adds tenant-safe contact linkage', () => {
  assert.match(migration, /ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS contact_id UUID/);
  assert.match(migration, /FOREIGN KEY \(contact_id, tenant_id\)/);
  assert.match(migration, /REFERENCES crm_contacts\(id, tenant_id\)/);
  assert.match(migration, /ALTER TABLE crm_deals ALTER COLUMN lead_id DROP NOT NULL/);
});

test('Deals extension preserves history with soft archive and indexes aggregation paths', () => {
  assert.match(migration, /archived_at TIMESTAMPTZ/);
  assert.match(migration, /idx_crm_deals_tenant_open_stage/);
  assert.match(migration, /idx_crm_deals_tenant_contact/);
  assert.match(migration, /chk_crm_deals_probability/);
});
