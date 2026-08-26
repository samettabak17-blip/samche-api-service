import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardOverview, normalizeDashboardRange, resolveDashboardDateRange } from '../services/dashboard-analytics-service.js';

test('dashboard overview uses fixed tenant-scoped aggregates', async () => {
  const calls = [];
  const rows = [
    [{ total_conversations: 4, previous_conversations: 2, new_leads: 1 }], [{ day: '2026-08-20', count: 1 }],
    [{ channel: 'WHATSAPP', count: 4 }], [{ id: 'c1', contact_name: 'Customer', channel_type: 'WHATSAPP' }],
    [{ label: 'Pricing', count: 2 }], [{ hour: '14:00', count: 3 }], [{ name: 'SamChe AI', count: 4 }], [{ status: 'open', count: 4 }],
  ];
  const query = async (sql, params) => { calls.push({ sql, params }); return { rows: rows.shift() ?? [] }; };
  const overview = await getDashboardOverview(query, { tenantId: 'tenant-a', days: 30 });
  assert.equal(calls.length, 8);
  assert.ok(calls.every(({ sql }) => sql.includes('tenant_id = $1')));
  assert.ok(calls.every(({ params }) => params[0] === 'tenant-a'));
  assert.equal(overview.kpis.conversation_growth, 100);
  assert.deepEqual(overview.channel_distribution, [{ channel: 'WHATSAPP', count: 4 }]);
});
test('dashboard overview keeps required sections honest when data is empty', async () => {
  const overview = await getDashboardOverview(async () => ({ rows: [] }), { tenantId: 'tenant-a' });
  assert.equal(overview.kpis.total_conversations, 0);
  assert.deepEqual(overview.top_intents, []);
  assert.equal(overview.insights.best_channel, null);
});
test('dashboard range is constrained to supported periods', () => {
  assert.equal(normalizeDashboardRange(30), 30); assert.equal(normalizeDashboardRange(365), 7);
});

test('dashboard date ranges derive an immediately preceding comparison period', () => {
  const range = resolveDashboardDateRange({ startDate: '2026-08-20', endDate: '2026-08-26' });
  assert.deepEqual(range, {
    startDate: '2026-08-20T00:00:00.000Z',
    endDate: '2026-08-26T23:59:59.999Z',
    previousStartDate: '2026-08-13T00:00:00.000Z',
    previousEndDate: '2026-08-19T23:59:59.999Z',
    rangeDays: 7,
  });
});
