import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardOverview, resolveDashboardDateRange } from '../services/dashboard-analytics-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

function fixtureQuery(overrides = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('total_conversations')) return { rows: [{ total_conversations: overrides.current ?? 8, previous_conversations: overrides.previous ?? 4, new_leads: 2 }] };
    if (sql.includes('generate_series')) return { rows: [{ day: '2026-08-01', count: 3 }, { day: '2026-08-02', count: 5 }] };
    if (sql.includes('GROUP BY tc.channel_type')) return { rows: overrides.channels ?? [{ channel: 'WHATSAPP', count: 6 }, { channel: 'WEB_CHAT', count: 2 }] };
    if (sql.includes('latest.content')) return { rows: [] };
    if (sql.includes("NULLIF(TRIM(l.intent)")) return { rows: [] };
    if (sql.includes('EXTRACT(HOUR')) return { rows: overrides.peak ?? [{ hour: '17:00', count: 7 }] };
    if (sql.includes('JOIN ai_assistants')) return { rows: overrides.assistant ?? [{ id: 'assistant-a', name: 'SamChe AI', channel_types: ['WHATSAPP'], count: 6 }] };
    if (sql.includes('GROUP BY c.status')) return { rows: [] };
    throw new Error('Unexpected analytics query');
  };
  return { query, calls };
}

test('derives peak time, best channel, most active assistant and growth from tenant period data', async () => {
  const fixture = fixtureQuery();
  const result = await getDashboardOverview(fixture.query, { tenantId, startDate: '2026-08-01', endDate: '2026-08-07' });
  assert.equal(result.insights.peak_hour, '17:00');
  assert.equal(result.insights.best_channel, 'WHATSAPP');
  assert.deepEqual(result.insights.most_active_assistant, { id: 'assistant-a', name: 'SamChe AI', channel_types: ['WHATSAPP'], conversation_count: 6 });
  assert.equal(result.insights.growth, 100);
  assert.ok(fixture.calls.every((call) => call.params[0] === tenantId));
});

test('uses deterministic channel and assistant tie ordering in SQL', async () => {
  const fixture = fixtureQuery();
  await getDashboardOverview(fixture.query, { tenantId });
  const channelSql = fixture.calls.find((call) => call.sql.includes('GROUP BY tc.channel_type')).sql;
  const assistantSql = fixture.calls.find((call) => call.sql.includes('JOIN ai_assistants')).sql;
  const peakSql = fixture.calls.find((call) => call.sql.includes('EXTRACT(HOUR')).sql;
  assert.match(channelSql, /ORDER BY count DESC, tc\.channel_type ASC/);
  assert.match(assistantSql, /ORDER BY count DESC, a\.id ASC/);
  assert.match(peakSql, /timezone\('UTC', m\.created_at\)/);
  assert.match(peakSql, /GROUP BY EXTRACT\(HOUR/);
});

test('returns honest no-data and zero-baseline comparison states', async () => {
  const fixture = fixtureQuery({ current: 3, previous: 0, channels: [], peak: [], assistant: [] });
  const result = await getDashboardOverview(fixture.query, { tenantId });
  assert.equal(result.insights.peak_hour, null);
  assert.equal(result.insights.best_channel, null);
  assert.equal(result.insights.most_active_assistant, null);
  assert.equal(result.insights.growth, null);
  assert.equal(result.insights.growth_status, 'INSUFFICIENT_DATA');
});

test('selected period produces an equivalent immediately preceding comparison period', () => {
  const range = resolveDashboardDateRange({ startDate: '2026-08-10', endDate: '2026-08-16' });
  assert.equal(range.rangeDays, 7);
  assert.match(range.previousStartDate, /^2026-08-03T00:00:00\.000Z$/);
  assert.match(range.previousEndDate, /^2026-08-09T23:59:59\.999Z$/);
});
