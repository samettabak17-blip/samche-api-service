import test from 'node:test';
import assert from 'node:assert/strict';
import { getCrmLeadDetail } from '../services/crm-lead-detail-service.js';

test('CRM lead detail reads all related data under the same tenant boundary', async () => {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'lead-a', tenant_id: 'tenant-a', latest_analysis: { reason_codes: ['PRICING_REQUEST'] }, activities: [], deals: [] }] };
  };

  const lead = await getCrmLeadDetail(query, { tenantId: 'tenant-a', leadId: 'lead-a' });

  assert.equal(lead.id, 'lead-a');
  assert.deepEqual(lead.latest_analysis.reason_codes, ['PRICING_REQUEST']);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].params.includes('tenant-a'));
  assert.match(calls[0].sql, /l\.tenant_id = \$1 AND l\.id = \$2/);
  assert.match(calls[0].sql, /tenant_id = l\.tenant_id/);
});
