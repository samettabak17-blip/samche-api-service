import test from 'node:test';
import assert from 'node:assert/strict';
import { getCrmOverviewMetrics, getPipelineSummary, listDeals } from '../services/crm-read-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const resourceId = '22222222-2222-4222-8222-222222222222';

test('deal list stays tenant-scoped, filters server-side, and excludes archived rows by default', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: resourceId, total: '1' }] };
  };
  const response = await listDeals(query, {
    tenantId, limit: 25, offset: 0, stageId: resourceId, contactId: resourceId,
    ownerUserId: resourceId, status: 'open', source: 'SAMCHEGUIDE',
  });
  assert.equal(response.total, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /d\.tenant_id = \$1/);
  assert.match(calls[0].sql, /d\.archived_at IS NULL/);
  assert.match(calls[0].sql, /d\.contact_id/);
  assert.ok(calls[0].params.every((value, index) => index === 0 || value !== undefined));
  assert.equal(calls[0].params[0], tenantId);
});

test('pipeline summary and overview metrics aggregate in the tenant database boundary', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ total_contacts: 2, open_deals: 3, pipeline_value: '1500', won_deals: 1, won_revenue: '500' }] };
  };
  const summary = await getPipelineSummary(query, { tenantId });
  const metrics = await getCrmOverviewMetrics(query, { tenantId });
  assert.equal(summary.length, 1);
  assert.equal(metrics.open_deals, 3);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.params[0] === tenantId));
  assert.match(calls[0].sql, /COALESCE\(SUM\(d\.value\), 0\)/);
  assert.match(calls[1].sql, /stage_key NOT IN \('WON', 'LOST'\)/);
  assert.match(calls[1].sql, /archived_at IS NULL/);
});
