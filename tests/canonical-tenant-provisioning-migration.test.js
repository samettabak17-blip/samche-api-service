import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migrations/065_canonical_tenant_platform_provisioning.sql', import.meta.url), 'utf8');

test('canonical provisioning migration shares one idempotent ensure path for old and new tenants', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION ensure_tenant_platform_capabilities/i);
  assert.match(sql, /SELECT ensure_tenant_platform_capabilities\(id, 1\) FROM tenants/i);
  assert.match(sql, /ON CONFLICT \(tenant_id, event_type\) DO UPDATE/i);
  assert.match(sql, /ON CONFLICT \(policy_id, level_order\) DO NOTHING/i);
  assert.match(sql, /ON CONFLICT \(tenant_id\) DO UPDATE/i);
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_tenants_human_support_escalation_policy/i);
});

test('canonical fixed lifecycle messages are complete, localized, and allow only TOPIC', () => {
  for (const key of ['human_support_default_topic', 'human_support_request', 'human_session_warning', 'human_takeover', 'return_to_ai']) {
    for (const locale of ['tr', 'en', 'ar']) assert.match(sql, new RegExp(`\\('${key}', '${locale}'`));
  }
  assert.match(sql, /allowed_variables <@ ARRAY\['TOPIC'\]/i);
  assert.doesNotMatch(sql, /Blue\s*Dune|Ye[sş]il\s*Vadi/i);
});
