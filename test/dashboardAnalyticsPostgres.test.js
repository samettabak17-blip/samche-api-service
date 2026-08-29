import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardOverview } from '../services/dashboard-analytics-service.js';

const databaseUrl = process.env.DATABASE_URL;

test('Overview aggregates real PostgreSQL activity by tenant and equivalent periods', { skip: !databaseUrl }, async () => {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl, ssl: false });
  await client.connect();
  await client.query('BEGIN');
  try {
    const tenantA = 'd1010000-0000-4000-8000-000000000001';
    const tenantB = 'd1010000-0000-4000-8000-000000000002';
    const assistantA = 'd1020000-0000-4000-8000-000000000001';
    const assistantB = 'd1020000-0000-4000-8000-000000000002';
    const whatsapp = 'd1030000-0000-4000-8000-000000000001';
    const web = 'd1030000-0000-4000-8000-000000000002';
    const foreignWeb = 'd1030000-0000-4000-8000-000000000003';

    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Analytics Tenant A'), ($2, 'Analytics Tenant B')`, [tenantA, tenantB]);
    await client.query(`INSERT INTO ai_assistants (id, tenant_id, name) VALUES ($1, $2, 'Sales Assistant'), ($3, $4, 'Foreign Assistant')`, [assistantA, tenantA, assistantB, tenantB]);
    await client.query(`INSERT INTO tenant_channels (id, tenant_id, assistant_id, channel_type, display_name)
      VALUES ($1, $2, $3, 'WHATSAPP', 'WhatsApp'), ($4, $2, $3, 'WEB_CHAT', 'Web'), ($5, $6, $7, 'WEB_CHAT', 'Foreign Web')`,
    [whatsapp, tenantA, assistantA, web, foreignWeb, tenantB, assistantB]);

    const conversations = [
      ['d1040000-0000-4000-8000-000000000001', tenantA, whatsapp, '2026-08-12T17:10:00Z'],
      ['d1040000-0000-4000-8000-000000000002', tenantA, whatsapp, '2026-08-13T17:20:00Z'],
      ['d1040000-0000-4000-8000-000000000003', tenantA, web, '2026-08-14T10:00:00Z'],
      ['d1040000-0000-4000-8000-000000000004', tenantA, whatsapp, '2026-08-05T09:00:00Z'],
      ['d1040000-0000-4000-8000-000000000005', tenantB, foreignWeb, '2026-08-12T22:00:00Z'],
      ['d1040000-0000-4000-8000-000000000006', tenantB, foreignWeb, '2026-08-12T22:10:00Z'],
      ['d1040000-0000-4000-8000-000000000007', tenantB, foreignWeb, '2026-08-12T22:20:00Z'],
      ['d1040000-0000-4000-8000-000000000008', tenantB, foreignWeb, '2026-08-12T22:30:00Z'],
    ];
    for (const [id, tenantId, channelId, createdAt] of conversations) {
      await client.query(`INSERT INTO conversations (id, tenant_id, channel_id, external_conversation_id, created_at, updated_at, last_activity_at)
        VALUES ($1::uuid, $2, $3, $1::text, $4, $4, $4)`, [id, tenantId, channelId, createdAt]);
      await client.query(`INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content, created_at)
        VALUES ($1, $2, 'CUSTOMER', 'analytics fixture', $3)`, [tenantId, id, createdAt]);
    }

    const fixtureBuckets = await client.query(`SELECT to_char(date_trunc('hour', timezone('UTC', created_at)), 'HH24:00') AS hour, COUNT(*)::int AS count
      FROM conversation_messages
      WHERE tenant_id = $1 AND created_at >= '2026-08-10T00:00:00Z' AND created_at <= '2026-08-16T23:59:59.999Z'
      GROUP BY date_trunc('hour', timezone('UTC', created_at)) ORDER BY count DESC, hour ASC`, [tenantA]);
    assert.deepEqual(fixtureBuckets.rows, [{ hour: '17:00', count: 2 }, { hour: '10:00', count: 1 }]);

    let queryQueue = Promise.resolve();
    const transactionQuery = (...args) => {
      const result = queryQueue.then(() => client.query(...args));
      queryQueue = result.then(() => undefined, () => undefined);
      return result;
    };
    const overview = await getDashboardOverview(transactionQuery, {
      tenantId: tenantA,
      startDate: '2026-08-10',
      endDate: '2026-08-16',
    });

    assert.equal(overview.kpis.total_conversations, 3);
    assert.equal(overview.insights.peak_hour, '17:00');
    assert.equal(overview.insights.best_channel, 'WHATSAPP');
    assert.equal(overview.insights.most_active_assistant.id, assistantA);
    assert.equal(overview.insights.most_active_assistant.conversation_count, 3);
    assert.equal(overview.insights.growth, 200);
    assert.deepEqual(overview.channel_distribution, [
      { channel: 'WHATSAPP', count: 2 },
      { channel: 'WEB_CHAT', count: 1 },
    ]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
