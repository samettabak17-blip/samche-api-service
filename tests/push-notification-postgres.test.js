import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import {
  createPushNotificationIntent,
  processPushNotificationOutbox,
  registerPushSubscription,
} from '../services/push-notification-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) throw new Error('PUSH_NOTIFICATION_POSTGRES_REQUIRES_TEST_DATABASE_URL');
const database = new pg.Pool({ connectionString, ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }), max: 2 });

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const endpoint = (name) => `https://push.example.test/${suffix}/${name}`;
const createdTenantIds = [];
const createdUserIds = [];

test.after(async () => {
  try {
    if (createdTenantIds.length) {
      await database.query(`DELETE FROM push_notification_outbox WHERE tenant_id = ANY($1::uuid[])`, [createdTenantIds]);
      await database.query(`DELETE FROM push_notification_intents WHERE tenant_id = ANY($1::uuid[])`, [createdTenantIds]);
      await database.query(`DELETE FROM push_notification_subscriptions WHERE tenant_id = ANY($1::uuid[])`, [createdTenantIds]);
      await database.query(`DELETE FROM push_notification_preferences WHERE tenant_id = ANY($1::uuid[])`, [createdTenantIds]);
      await database.query(`DELETE FROM crm_pipeline_stages WHERE tenant_id = ANY($1::uuid[])`, [createdTenantIds]);
      await database.query(`DELETE FROM tenant_users WHERE tenant_id = ANY($1::uuid[])`, [createdTenantIds]);
      await database.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [createdTenantIds]);
    }
    if (createdUserIds.length) await database.query(`DELETE FROM users WHERE id = ANY($1::uuid[]) AND is_test_fixture = TRUE`, [createdUserIds]);
  } finally {
    await database.end();
  }
});

async function fixture(client, label) {
  const tenant = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, [`push-${label}-${suffix}`]);
  const email = `push-${label}-${suffix}@example.test`;
  const user = await client.query(
    `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
     VALUES ($1, $1, 'test-fixture-only', 'CUSTOMER', 'ACTIVE', 'Push', 'Fixture', TRUE) RETURNING id`,
    [email],
  );
  await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1,$2,'ADMIN')`, [tenant.rows[0].id, user.rows[0].id]);
  createdTenantIds.push(tenant.rows[0].id);
  createdUserIds.push(user.rows[0].id);
  return { tenantId: tenant.rows[0].id, userId: user.rows[0].id };
}

test('real PostgreSQL persists tenant/user/device push delivery and excludes another tenant', async () => {
  const migration = fs.readFileSync(new URL('../migrations/068_push_notifications.sql', import.meta.url), 'utf8');
  await database.query(migration);
  await database.query(migration);
  const client = await database.connect();
  try {
    const tenantA = await fixture(client, 'a');
    const tenantB = await fixture(client, 'b');
    await registerPushSubscription({ database: client, tenantId: tenantA.tenantId, userId: tenantA.userId, subscription: { endpoint: endpoint('a'), keys: { p256dh: 'key-a', auth: 'auth-a' } } });
    await registerPushSubscription({ database: client, tenantId: tenantB.tenantId, userId: tenantB.userId, subscription: { endpoint: endpoint('b'), keys: { p256dh: 'key-b', auth: 'auth-b' } } });
    await createPushNotificationIntent({ database: client, tenantId: tenantA.tenantId, eventId: `push-${suffix}`, eventType: 'HUMAN_HANDOFF_REQUESTED', deepLink: `/app/${tenantA.tenantId}/conversations/whatsapp/${crypto.randomUUID()}`, recipientUserIds: [tenantA.userId] });
    const delivery = await processPushNotificationOutbox({ database, deliver: async () => ({ status: 'DELIVERED' }) });
    assert.equal(delivery.delivered, 1);
    const counts = await client.query(
      `SELECT tenant_id, count(*)::integer AS rows, array_agg(status ORDER BY status) AS statuses
         FROM push_notification_outbox
        WHERE tenant_id = ANY($1::uuid[])
        GROUP BY tenant_id ORDER BY tenant_id`,
      [[tenantA.tenantId, tenantB.tenantId]],
    );
    assert.deepEqual(counts.rows, [{ tenant_id: tenantA.tenantId, rows: 1, statuses: ['DELIVERED'] }]);
  } finally {
    client.release();
  }
});
