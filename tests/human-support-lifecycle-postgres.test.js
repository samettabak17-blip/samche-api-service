import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import { claimDueHumanSupportEscalations, requestCustomerHumanSupport } from '../services/human-support-service.js';
import { processHumanSupportNotificationOutbox } from '../services/human-support-notification-outbox-service.js';
import { resolveHumanSupportRecipients } from '../services/human-support-recipient-service.js';
import { enqueueHumanHandoffPushNotification, processPushNotificationOutbox, registerPushSubscription } from '../services/push-notification-service.js';

process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ||= 'test-secret-value';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) throw new Error('TEST_DATABASE_URL_REQUIRED');
const database = new pg.Pool({ connectionString, ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }), max: 5 });

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const createdTenantIds = [];
const createdUserIds = [];

test.after(async () => {
  try {
    if (createdTenantIds.length) {
      await database.query('DELETE FROM push_notification_outbox WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM push_notification_intents WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_notification_outbox WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversation_messages WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversation_audit_events WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_channels WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM push_notification_subscriptions WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalation_levels WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalation_policies WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_platform_provisioning WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM push_notification_preferences WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_pipeline_stages WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_contacts WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_users WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [createdTenantIds]);
    }
    if (createdUserIds.length) await database.query('DELETE FROM users WHERE id = ANY($1::uuid[]) AND is_test_fixture = TRUE', [createdUserIds]);
    const defaultPool = (await import('../config/db.js')).default;
    await defaultPool.end().catch(() => {});
  } finally {
    await database.end();
  }
});

test('real PostgreSQL: complete canonical human support lifecycle with multi-level escalation, phone push, takeover, and tenant isolation', async () => {
  const client = await database.connect();
  try {
    const tenantA = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['Tenant A ' + suffix]);
    const tenantB = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['Tenant B ' + suffix]);
    const tenantAId = tenantA.rows[0].id;
    const tenantBId = tenantB.rows[0].id;
    createdTenantIds.push(tenantAId, tenantBId);

    const userA = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Admin', 'A', TRUE) RETURNING id`,
      ['admin-a-' + suffix + '@example.test']
    );
    const userB = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Admin', 'B', TRUE) RETURNING id`,
      ['admin-b-' + suffix + '@example.test']
    );
    const userAId = userA.rows[0].id;
    const userBId = userB.rows[0].id;
    createdUserIds.push(userAId, userBId);

    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN')`, [tenantAId, userAId]);
    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN')`, [tenantBId, userBId]);

    await registerPushSubscription({
      database: client,
      tenantId: tenantAId,
      userId: userAId,
      subscription: { endpoint: 'https://push.example.test/' + suffix + '/a', keys: { p256dh: 'key-a', auth: 'auth-a' } },
    });
    await registerPushSubscription({
      database: client,
      tenantId: tenantBId,
      userId: userBId,
      subscription: { endpoint: 'https://push.example.test/' + suffix + '/b', keys: { p256dh: 'key-b', auth: 'auth-b' } },
    });

    await client.query('SELECT ensure_tenant_platform_capabilities($1, 1)', [tenantAId]);
    await client.query('SELECT ensure_tenant_platform_capabilities($1, 1)', [tenantBId]);

    const channelA = await client.query(
      `INSERT INTO tenant_channels (tenant_id, channel_type, external_channel_id, display_name, status) VALUES ($1, 'WHATSAPP', $2, 'WhatsApp Channel', 'active') RETURNING id`,
      [tenantAId, 'phone-' + suffix]
    );
    const channelAId = channelA.rows[0].id;

    const convA = await client.query(
      `INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id, status, handling_mode, human_attention_state)
       VALUES ($1, $2, $3, $4, 'open', 'AI', 'NONE') RETURNING id`,
      [tenantAId, channelAId, 'conv-' + suffix, 'customer-' + suffix]
    );
    const convAId = convA.rows[0].id;

    // STEP 1: Customer requests human support
    const handoff = await requestCustomerHumanSupport({
      tenantId: tenantAId,
      conversationId: convAId,
      acknowledgement: 'Canlı temsilciye aktarılıyorsunuz.',
      topicSummary: 'Genel destek',
      database,
    });
    assert.equal(handoff.duplicate, false);
    assert.equal(handoff.conversation.handling_mode, 'HUMAN');
    assert.equal(handoff.conversation.human_attention_state, 'REQUESTED');

    // STEP 2: Claim due escalation (Level 1: ASSIGNED_OWNER claims)
    const claimedL1 = await claimDueHumanSupportEscalations({ database, now: new Date() });
    const claimedL1Tenant = claimedL1.filter((r) => r.tenantId === tenantAId);
    assert.equal(claimedL1Tenant.length, 1);
    assert.equal(claimedL1Tenant[0].level, 1);
    assert.equal(claimedL1Tenant[0].recipientRule, 'ASSIGNED_OWNER');

    // STEP 3: Outbox processes Level 1 - unassigned conversation has 0 recipients.
    // It must record no recipients and advance escalation next_due_at immediately!
    const outboxL1 = await processHumanSupportNotificationOutbox({
      database,
      tenantId: tenantAId,
      resolveRecipients: (input) => resolveHumanSupportRecipients({ database, ...input }),
      deliver: async ({ recipients, tenantId, conversationId, outboxId }) => {
        await enqueueHumanHandoffPushNotification({ database, tenantId, conversationId, handoffOutboxId: outboxId, recipients });
        return { status: 'DELIVERED' };
      },
    });
    assert.equal(outboxL1.noRecipients, 1);
    assert.equal(outboxL1.delivered, 0);

    // STEP 4: Claim due escalation again - Level 2 (ROLE: ADMIN) claims immediately!
    const claimedL2 = await claimDueHumanSupportEscalations({ database, now: new Date() });
    const claimedL2Tenant = claimedL2.filter((r) => r.tenantId === tenantAId);
    assert.equal(claimedL2Tenant.length, 1);
    assert.equal(claimedL2Tenant[0].level, 2);
    assert.equal(claimedL2Tenant[0].recipientRule, 'ROLE');

    // STEP 5: Outbox processes Level 2 - resolves Admin A and enqueues push notification
    const outboxL2 = await processHumanSupportNotificationOutbox({
      database,
      tenantId: tenantAId,
      resolveRecipients: (input) => resolveHumanSupportRecipients({ database, ...input }),
      deliver: async ({ recipients, tenantId, conversationId, outboxId }) => {
        await enqueueHumanHandoffPushNotification({ database, tenantId, conversationId, handoffOutboxId: outboxId, recipients });
        return { status: 'DELIVERED' };
      },
    });
    assert.equal(outboxL2.delivered, 1);

    // STEP 6: Process push notification outbox
    const deliveredEndpoints = [];
    const pushResult = await processPushNotificationOutbox({
      database,
      tenantId: tenantAId,
      deliver: async ({ subscription, notification }) => {
        deliveredEndpoints.push(subscription.endpoint);
        assert.equal(notification.type, 'HUMAN_HANDOFF_REQUESTED');
        assert.equal(notification.deepLink, `/app/${tenantAId}/conversations/whatsapp/${convAId}`);
        return { status: 'DELIVERED' };
      },
    });
    assert.equal(pushResult.delivered, 1);
    assert.deepEqual(deliveredEndpoints, ['https://push.example.test/' + suffix + '/a']);

    // STEP 7: Tenant isolation: verify Tenant B never received or saw Tenant A's push
    const crossTenantOutbox = await client.query(
      `SELECT count(*)::integer AS count FROM push_notification_outbox WHERE tenant_id = $1`,
      [tenantBId]
    );
    assert.equal(crossTenantOutbox.rows[0].count, 0);

    // STEP 8: Operator Takeover cancels pending escalation
    const { operateConversation } = await import('../services/live-inbox-service.js');
    const takenOver = await operateConversation({
      database,
      tenantId: tenantAId,
      conversationId: convAId,
      action: 'takeover',
      actor: { userId: userAId, systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
    });
    assert.equal(takenOver.assigned_agent_user_id, userAId);
    assert.equal(takenOver.human_attention_state, 'ACKNOWLEDGED');

    const completedEscalation = await client.query(
      `SELECT status FROM human_support_escalations WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenantAId, convAId]
    );
    assert.equal(completedEscalation.rows[0].status, 'COMPLETED');

    // STEP 9: Return to AI restores handling_mode to 'AI' and resolves attention
    await client.query("UPDATE tenant_channels SET channel_type = 'SAMCHEGUIDE' WHERE id = $1", [channelAId]);
    const returned = await operateConversation({
      database,
      tenantId: tenantAId,
      conversationId: convAId,
      action: 'return_to_ai',
      actor: { userId: userAId, systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
    });
    assert.equal(returned.handling_mode, 'AI');
    assert.equal(returned.human_attention_state, 'RESOLVED');
  } finally {
    client.release();
  }
});

