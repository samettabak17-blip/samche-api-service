import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/004_crm_lead_engine.sql', import.meta.url), 'utf8');

test('CRM migration defines tenant-scoped entities and default pipeline bootstrap', () => {
  for (const table of ['crm_contacts', 'crm_companies', 'crm_pipeline_stages', 'crm_leads', 'crm_deals', 'crm_activities', 'crm_lead_analyses']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /ensure_crm_default_pipeline/);
  for (const stage of ['NEW_LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']) {
    assert.match(migration, new RegExp(`'${stage}'`));
  }
});

test('CRM migration uses tenant-aware composite foreign keys for lead relationships', () => {
  assert.match(migration, /FOREIGN KEY \(contact_id, tenant_id\)/);
  assert.match(migration, /FOREIGN KEY \(conversation_id, tenant_id\)/);
  assert.match(migration, /FOREIGN KEY \(pipeline_stage_id, tenant_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, assigned_user_id\)/);
  assert.match(migration, /FOREIGN KEY \(contact_id, tenant_id\)[\s\S]*?REFERENCES crm_contacts\(id, tenant_id\)/);
});

