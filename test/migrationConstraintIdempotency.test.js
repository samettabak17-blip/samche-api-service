import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { runMigrations } from '../migrations/runMigrations.js';

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/workflow_test';

const ALL_LEGITIMATE_AUDIT_EVENT_TYPES = Object.freeze([
  'TAKEOVER',
  'RETURN_TO_AI',
  'PAUSE',
  'RESUME',
  'CLOSE',
  'ASSIGNMENT',
  'HANDOFF_REQUESTED',
  'HUMAN_MESSAGE',
  'HUMAN_SUPPORT_ACKNOWLEDGED',
  'HUMAN_SUPPORT_REQUESTED',
  'AI_OVERRIDE_UPDATED',
]);

test('MIGRATION REGRESSION: Full migration run is idempotent and preserves all historical audit event types without code 23514', async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    // 1. First full migration run
    await runMigrations();

    // 2. Ensure test tenant and conversation exist
    const tenantRes = await pool.query(
      `INSERT INTO tenants (id, name, status, plan_code)
       VALUES (gen_random_uuid(), 'Audit Migration Test Tenant', 'active', 'ENTERPRISE')
       RETURNING id`
    );
    const tenantId = tenantRes.rows[0].id;

    const channelRes = await pool.query(
      `INSERT INTO tenant_channels (tenant_id, channel_type, status)
       VALUES ($1, 'INSTAGRAM', 'active')
       RETURNING id`,
      [tenantId]
    );
    const channelId = channelRes.rows[0].id;

    const convRes = await pool.query(
      `INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id)
       VALUES ($1, $2, 'audit_test_conv_' || gen_random_uuid(), 'instagram:test_audit_user')
       RETURNING id`,
      [tenantId, channelId]
    );
    const conversationId = convRes.rows[0].id;

    // 3. Populate existing database with EVERY legitimate historical audit event type
    for (const eventType of ALL_LEGITIMATE_AUDIT_EVENT_TYPES) {
      await pool.query(
        `INSERT INTO conversation_audit_events (tenant_id, conversation_id, event_type, metadata)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, conversationId, eventType, JSON.stringify({ test: true, eventType })]
      );
    }

    const countBefore = await pool.query(
      `SELECT count(*)::int as total FROM conversation_audit_events WHERE tenant_id = $1`,
      [tenantId]
    );
    assert.equal(countBefore.rows[0].total, ALL_LEGITIMATE_AUDIT_EVENT_TYPES.length);

    // 4. Run full migration suite AGAIN on populated database (simulating restart / deployment)
    await runMigrations();

    // 5. Verify row count unchanged (zero rows deleted)
    const countAfter = await pool.query(
      `SELECT count(*)::int as total FROM conversation_audit_events WHERE tenant_id = $1`,
      [tenantId]
    );
    assert.equal(countAfter.rows[0].total, ALL_LEGITIMATE_AUDIT_EVENT_TYPES.length);

    // 6. Verify distinct event types present
    const distinctRes = await pool.query(
      `SELECT DISTINCT event_type FROM conversation_audit_events WHERE tenant_id = $1 ORDER BY event_type`,
      [tenantId]
    );
    const presentTypes = distinctRes.rows.map((r) => r.event_type);
    for (const eventType of ALL_LEGITIMATE_AUDIT_EVENT_TYPES) {
      assert.ok(presentTypes.includes(eventType), `Expected ${eventType} to be preserved`);
    }

    // 7. Verify check constraint accepts new AI_OVERRIDE_UPDATED row
    await pool.query(
      `INSERT INTO conversation_audit_events (tenant_id, conversation_id, event_type, metadata)
       VALUES ($1, $2, 'AI_OVERRIDE_UPDATED', '{"override":"AI_ONLY"}')`,
      [tenantId, conversationId]
    );

    // 8. Verify check constraint rejects invalid event type
    let rejected = false;
    try {
      await pool.query(
        `INSERT INTO conversation_audit_events (tenant_id, conversation_id, event_type, metadata)
         VALUES ($1, $2, 'INVALID_UNKNOWN_EVENT_TYPE', '{}')`,
        [tenantId, conversationId]
      );
    } catch (err) {
      if (err.code === '23514') rejected = true;
    }
    assert.equal(rejected, true, 'Check constraint should reject invalid unknown event type');

    // 9. Clean up test tenant
    await pool.query('DELETE FROM conversation_audit_events WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM conversations WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM tenant_channels WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  } finally {
    await pool.end();
  }
});