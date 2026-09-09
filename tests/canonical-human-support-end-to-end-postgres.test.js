import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';

process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ||= 'test-secret-value';

const {
  claimDueHumanSupportEscalations,
  requestCustomerHumanSupport,
  triggerImmediateHumanSupportNotificationPipeline,
} = await import('../services/human-support-service.js');
const { resolveHumanSupportRecipients } = await import('../services/human-support-recipient-service.js');
const {
  appendAgentMessage,
  getHumanDeliveryCapability,
  operateConversation,
} = await import('../services/live-inbox-service.js');
const { processPushNotificationOutbox, registerPushSubscription } = await import('../services/push-notification-service.js');
const { resolvePlatformHumanSupportPolicy } = await import('../services/platform-lifecycle-message-service.js');
const { orchestrateWhatsAppInboundAiResponse } = await import('../services/whatsapp-inbound-ai-orchestrator.js');

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) throw new Error('TEST_DATABASE_URL_REQUIRED');
const database = new pg.Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }),
  max: 5,
});

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const createdTenantIds = [];
const createdUserIds = [];

test.after(async () => {
  try {
    if (createdTenantIds.length) {
      await database.query('DELETE FROM crm_pipeline_stages WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_contacts WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM push_notification_outbox WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM push_notification_intents WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM push_notification_subscriptions WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_notification_outbox WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversation_messages WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversation_audit_events WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM channel_integrations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_channels WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM ai_assistants WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalation_levels WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalation_policies WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_platform_provisioning WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_users WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [createdTenantIds]);
    }
    if (createdUserIds.length) {
      await database.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
    }
  } finally {
    await database.end();
  }
});

test('canonical human-support end-to-end: support request, auto-assignment, instant push, live inbox delivery, anti-hijack, return to ai, and typing resumption', async () => {
  const client = await database.connect();
  try {
    // 1. Provision Tenant
    const tenantRes = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['Yeşil Vadi ' + suffix]);
    const tenantId = tenantRes.rows[0].id;
    createdTenantIds.push(tenantId);

    // 2. Provision Users: Operator (Admin), Peer Agent
    const adminUserRes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Operator', 'Admin', TRUE) RETURNING id`,
      ['operator-admin-' + suffix + '@example.test']
    );
    const peerUserRes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Peer', 'Agent', TRUE) RETURNING id`,
      ['peer-agent-' + suffix + '@example.test']
    );
    const adminId = adminUserRes.rows[0].id;
    const peerId = peerUserRes.rows[0].id;
    createdUserIds.push(adminId, peerId);

    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN')`, [tenantId, adminId]);
    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'AGENT')`, [tenantId, peerId]);

    // Register active push subscription for Operator Admin
    await registerPushSubscription({
      database: client,
      tenantId,
      userId: adminId,
      subscription: { endpoint: 'https://push.example.test/device-' + suffix, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } },
    });

    // Run platform provisioning capabilities
    await client.query('SELECT ensure_tenant_platform_capabilities($1, 1)', [tenantId]);

    // 3. Provision WhatsApp Channel and Assistant
    const assistantRes = await client.query(
      `INSERT INTO ai_assistants (tenant_id, name, model, status) VALUES ($1, 'Yeşil Vadi AI', 'gpt-4o-mini', 'active') RETURNING id`,
      [tenantId]
    );
    const assistantId = assistantRes.rows[0].id;

    const phoneNumber = '9053' + crypto.randomBytes(4).toString('hex').replace(/[^0-9]/g, '9').slice(0, 8);
    const channelRes = await client.query(
      `INSERT INTO tenant_channels (tenant_id, channel_type, external_channel_id, display_name, status, assistant_id)
       VALUES ($1, 'WHATSAPP', $2, 'Yeşil Vadi WhatsApp', 'active', $3) RETURNING id`,
      [tenantId, phoneNumber, assistantId]
    );
    const channelId = channelRes.rows[0].id;

    // Provision conversation initially handled by AI
    const convRes = await client.query(
      `INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id, status, handling_mode, human_attention_state, communication_language)
       VALUES ($1, $2, $3, $4, 'open', 'AI', 'NONE', 'tr') RETURNING id`,
      [tenantId, channelId, 'conv-' + suffix, 'customer-' + suffix]
    );
    const conversationId = convRes.rows[0].id;

    // Initial customer question handled by AI: verify native typing executed
    let typingAttempted = false;
    const initialAiTurn = await orchestrateWhatsAppInboundAiResponse({
      whatsappInbox: {
        duplicate: false,
        shouldInvokeAi: true,
        conversation: { handling_mode: 'AI' },
        integration: { tenant_id: tenantId, channel_id: channelId, external_channel_id: phoneNumber },
      },
      incomingMessageId: 'wamid.INITIAL_QUESTION',
      sendTyping: async ({ phoneNumberId, incomingMessageId }) => {
        assert.equal(phoneNumberId, phoneNumber);
        assert.equal(incomingMessageId, 'wamid.INITIAL_QUESTION');
        typingAttempted = true;
        return { ok: true, providerStatus: 200 };
      },
      processAiResponse: async () => ({ delivered: true, aiResponsePath: 'KNOWLEDGE_INTELLIGENCE' }),
    });
    assert.equal(typingAttempted, true);

    // =========================================================================
    // STEP 1: CUSTOMER REQUESTS LIVE SUPPORT ("CANLI DESTEK ALMAK İSTİYORUM")
    // =========================================================================
    const policy = await resolvePlatformHumanSupportPolicy({ database: client, locale: 'tr' });
    const acknowledgement = policy.acknowledgement();

    // Verify deterministic acknowledgement: does NOT quote previous question, does NOT contain TOPIC placeholders
    assert.equal(acknowledgement, 'Canlı destek talebinizi aldık. Görüşmeniz canlı destek ekibimize aktarılıyor, bir ekip üyesi en kısa sürede yardımcı olacaktır.');
    assert.doesNotMatch(acknowledgement, /CANLI DESTEK ALMAK İSTİYORUM/);
    assert.doesNotMatch(acknowledgement, /\{TOPIC\}/);
    assert.doesNotMatch(acknowledgement, /Maltepe/);

    const handoff = await requestCustomerHumanSupport({
      tenantId,
      conversationId,
      acknowledgement,
      topicSummary: policy.defaultTopic,
      database,
    });

    assert.equal(handoff.duplicate, false);
    assert.equal(handoff.conversation.handling_mode, 'HUMAN');
    assert.equal(handoff.conversation.human_attention_state, 'REQUESTED');
    // Automatic operator assignment resolved Admin A!
    assert.equal(handoff.conversation.assigned_agent_user_id, adminId);
    assert.equal(handoff.assignedOperatorId, adminId);

    // =========================================================================
    // STEP 2: INSTANT PUSH DISPATCH PIPELINE
    // =========================================================================
    const pushedNotifications = [];
    await triggerImmediateHumanSupportNotificationPipeline({
      database,
      tenantId,
      conversationId,
      deliverWebPush: async ({ subscription, notification }) => {
        pushedNotifications.push({ subscription, notification });
        return { status: 'DELIVERED' };
      },
    });

    assert.equal(pushedNotifications.length, 1);
    assert.equal(pushedNotifications[0].subscription.endpoint, 'https://push.example.test/device-' + suffix);
    assert.equal(pushedNotifications[0].notification.type, 'HUMAN_HANDOFF_REQUESTED');
    assert.equal(pushedNotifications[0].notification.deepLink, `/app/${tenantId}/conversations/whatsapp/${conversationId}`);

    // =========================================================================
    // STEP 3: LIVE INBOX CAPABILITY & COMPOSER USABILITY
    // =========================================================================
    const capability = await getHumanDeliveryCapability({ database, tenantId, conversationId });
    assert.equal(capability.configured, true);
    assert.equal(capability.channelType, 'WHATSAPP');

    // Assigned operator can reply immediately
    const sentWhatsAppMessages = [];
    const replyResult = await appendAgentMessage({
      database,
      tenantId,
      conversationId,
      actor: { userId: adminId, systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
      content: 'Merhaba, ben operatörünüzüm. Nasıl yardımcı olabilirim?',
      deliverWhatsApp: async (payload) => {
        sentWhatsAppMessages.push(payload);
        return { deliveredChunks: 1, failedChunks: 0 };
      },
    });

    assert.equal(replyResult.delivery, 'SENT_TO_WHATSAPP');
    assert.equal(sentWhatsAppMessages.length, 1);
    assert.equal(sentWhatsAppMessages[0].recipient, 'customer-' + suffix);
    assert.equal(sentWhatsAppMessages[0].content, 'Merhaba, ben operatörünüzüm. Nasıl yardımcı olabilirim?');

    // =========================================================================
    // STEP 4: ANTI-HIJACKING & IDEMPOTENT TAKEOVER
    // =========================================================================
    // Peer agent CANNOT hijack the assigned conversation
    await assert.rejects(
      operateConversation({
        database,
        tenantId,
        conversationId,
        action: 'takeover',
        actor: { userId: peerId, systemRole: 'CUSTOMER', tenantRole: 'AGENT' },
      }),
      (err) => err.code === 'CONVERSATION_ALREADY_ASSIGNED' && err.status === 409
    );

    // Current assigned operator can perform idempotent takeover safely
    const idempotentTakeover = await operateConversation({
      database,
      tenantId,
      conversationId,
      action: 'takeover',
      actor: { userId: adminId, systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
    });
    assert.equal(idempotentTakeover.assigned_agent_user_id, adminId);

    // =========================================================================
    // STEP 5: AI FULLY SUPPRESSED DURING HUMAN MODE (ZERO TYPING, ZERO AI)
    // =========================================================================
    let typingDuringHuman = 0;
    const humanInboundTurn = await orchestrateWhatsAppInboundAiResponse({
      whatsappInbox: {
        duplicate: false,
        shouldInvokeAi: false,
        conversation: { handling_mode: 'HUMAN' },
        integration: { tenant_id: tenantId, channel_id: channelId, external_channel_id: phoneNumber },
      },
      incomingMessageId: 'wamid.CUSTOMER_REPLY_DURING_HUMAN',
      sendTyping: async () => { typingDuringHuman += 1; },
      processAiResponse: async () => { throw new Error('AI must not execute'); },
    });
    assert.equal(humanInboundTurn.suppressed, true);
    assert.equal(typingDuringHuman, 0);

    // =========================================================================
    // STEP 6: RETURN TO AI LIFECYCLE
    // =========================================================================
    const returnNoticeSent = [];
    const returnedConv = await operateConversation({
      database,
      tenantId,
      conversationId,
      action: 'return_to_ai',
      actor: { userId: adminId, systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
      deliverWhatsApp: async (payload) => {
        returnNoticeSent.push(payload);
        return { deliveredChunks: 1, failedChunks: 0 };
      },
    });

    assert.equal(returnedConv.handling_mode, 'AI');
    assert.equal(returnedConv.assigned_agent_user_id, null);
    assert.equal(returnedConv.human_attention_state, 'RESOLVED');

    assert.equal(returnNoticeSent.length, 1);
    assert.equal(returnNoticeSent[0].content, 'Canlı destek oturumu sona erdi. AI asistanıyla sohbete devam edebilirsiniz.');

    // Escalations must be completed / closed
    const escResult = await client.query(
      `SELECT status FROM human_support_escalations WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenantId, conversationId]
    );
    assert.equal(escResult.rows[0].status, 'COMPLETED');

    // =========================================================================
    // STEP 7: NEXT CUSTOMER MESSAGE RESTORES NATIVE TYPING & AI REPLY
    // =========================================================================
    let postReturnTypingAttempted = false;
    const postReturnAiTurn = await orchestrateWhatsAppInboundAiResponse({
      whatsappInbox: {
        duplicate: false,
        shouldInvokeAi: true,
        conversation: { handling_mode: 'AI', human_support_closed_at: new Date().toISOString() },
        integration: { tenant_id: tenantId, channel_id: channelId, external_channel_id: phoneNumber },
      },
      incomingMessageId: 'wamid.POST_RETURN_MESSAGE',
      sendTyping: async ({ phoneNumberId, incomingMessageId }) => {
        assert.equal(phoneNumberId, phoneNumber);
        assert.equal(incomingMessageId, 'wamid.POST_RETURN_MESSAGE');
        postReturnTypingAttempted = true;
        return { ok: true, providerStatus: 200 };
      },
      processAiResponse: async () => ({ delivered: true, aiResponsePath: 'POST_RETURN_TO_AI' }),
    });

    assert.equal(postReturnTypingAttempted, true);
    assert.equal(postReturnAiTurn.suppressed, false);
    assert.equal(postReturnAiTurn.aiResponsePath, 'POST_RETURN_TO_AI');
  } finally {
    client.release();
  }
});
