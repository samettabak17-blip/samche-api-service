import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';

process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ||= 'test-secret-value';

const {
  claimDueCustomerSupportLifecycle,
  claimDueHumanSupportEscalations,
  requestCustomerHumanSupport,
  resolveCanonicalHumanSupportOperator,
  triggerImmediateHumanSupportNotificationPipeline,
} = await import('../services/human-support-service.js');
const { resolveHumanSupportRecipients } = await import('../services/human-support-recipient-service.js');
const {
  appendAgentMessage,
  getHumanDeliveryCapability,
  operateConversation,
} = await import('../services/live-inbox-service.js');
const {
  createPushNotificationIntent,
  enqueueHumanHandoffPushNotification,
  processPushNotificationOutbox,
  registerPushSubscription,
  validateInternalDashboardDeepLink,
} = await import('../services/push-notification-service.js');
const {
  loadPlatformLifecycleMessages,
  renderPlatformLifecycleMessage,
  resolvePlatformHumanSupportPolicy,
} = await import('../services/platform-lifecycle-message-service.js');
const { orchestrateWhatsAppInboundAiResponse } = await import('../services/whatsapp-inbound-ai-orchestrator.js');
const {
  deliverAutomatedWhatsAppMessageWithTyping,
  sendWhatsAppTypingIndicator,
} = await import('../services/whatsapp-delivery-service.js');
const { createWebPushDeliveryAdapter } = await import('../services/web-push-delivery-adapter.js');

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
      await database.query('DELETE FROM push_notification_preferences WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
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
      await database.query('DELETE FROM users WHERE id = ANY($1::uuid[]) AND is_test_fixture = TRUE', [createdUserIds]);
    }
  } finally {
    await database.end();
  }
});

test('Exact Canonical Support Lifecycle Templates across TR, EN, AR without Topic Injection', async () => {
  const client = await database.connect();
  try {
    const templates = await loadPlatformLifecycleMessages({ database: client });

    // A. LIVE SUPPORT REQUEST / TRANSFER MESSAGE
    const expectedTrRequest = `Canlı temsilci ile görüşme ilgili talebinizi aldım. Genel Destek konusuyla ilgili size en doğru desteği sağlayabilmek için sizi canlı müşteri temsilcimize aktarıyorum.
Talebiniz işlem sırasına alınacak, en kısa süre içinde canlı müşteri temsilcimize bağlanacaksınız.
Müşteri temsilcimize bağlanırken lütfen beklemede kalın ⏳.`;

    const actualTrRequest = renderPlatformLifecycleMessage({ templates, key: 'human_support_request', locale: 'tr' });
    assert.equal(actualTrRequest.replace(/\r\n/g, '\n'), expectedTrRequest);
    assert.doesNotMatch(actualTrRequest, /\{TOPIC\}/);
    assert.doesNotMatch(actualTrRequest, /konusundaki/);

    // B. HUMAN REPRESENTATIVE HAS TAKEN OVER
    const expectedTrTakeover = `DİKKAT ⚠️ Canlı temsilcimiz bu konuşmayı devralmıştır. Lütfen sohbete bağlanana kadar beklemede kalın ⏳

⚠️ Canlı temsilcimiz bu konuşmayı sonlandırmadığı sürece yapay zeka danışmanı devre dışıdır. 🔒`;

    const actualTrTakeover = renderPlatformLifecycleMessage({ templates, key: 'human_takeover', locale: 'tr' });
    assert.equal(actualTrTakeover.replace(/\r\n/g, '\n'), expectedTrTakeover);

    // C. HUMAN SUPPORT SESSION ENDED / RETURN TO AI
    const expectedTrReturn = `🔒 Canlı destek oturumu sona ermiştir.

Yapay zeka asistanımızla sohbete devam edebilir ya da canlı temsilciye tekrar bağlanmak isterseniz sohbet alanına 'canlı destek' yazmanız yeterlidir.
Ekibimiz size her zaman yardımcı olmaktan mutluluk duyacaktır.`;

    const actualTrReturn = renderPlatformLifecycleMessage({ templates, key: 'return_to_ai', locale: 'tr' });
    assert.equal(actualTrReturn.replace(/\r\n/g, '\n'), expectedTrReturn);

    // EN Parity
    const enPolicy = await resolvePlatformHumanSupportPolicy({ database: client, locale: 'en' });
    const enAck = enPolicy.acknowledgement('random-topic-ignored');
    assert.match(enAck, /I have received your request to speak with a live representative/);
    assert.match(enAck, /General Support/);
    assert.doesNotMatch(enAck, /random-topic-ignored/);
    assert.doesNotMatch(enAck, /\{TOPIC\}/);

    const enTakeover = enPolicy.lifecycleMessage('human_takeover');
    assert.match(enTakeover, /ATTENTION ⚠️ Our live representative has taken over this conversation/);
    assert.match(enTakeover, /AI consultant is disabled/);

    const enReturn = enPolicy.lifecycleMessage('return_to_ai');
    assert.match(enReturn, /The live support session has ended/);
    assert.match(enReturn, /simply type 'live support'/);

    // AR Parity
    const arPolicy = await resolvePlatformHumanSupportPolicy({ database: client, locale: 'ar' });
    const arAck = arPolicy.acknowledgement();
    assert.match(arAck, /لقد تلقيت طلبك للتحدث مع ممثل مباشر/);
    assert.match(arAck, /الدعم العام/);

    const arTakeover = arPolicy.lifecycleMessage('human_takeover');
    assert.match(arTakeover, /تنبيه ⚠️ تولى ممثلنا المباشر هذه المحادثة/);

    const arReturn = arPolicy.lifecycleMessage('return_to_ai');
    assert.match(arReturn, /انتهت جلسة الدعم المباشر/);

    // Fallback to EN on unknown locale
    const dePolicy = await resolvePlatformHumanSupportPolicy({ database: client, locale: 'de' });
    assert.equal(dePolicy.acknowledgement(), enAck);
  } finally {
    client.release();
  }
});

test('WhatsApp Native Typing before Automated Support Lifecycle Messages & Suppression in Human Mode', async () => {
  const client = await database.connect();
  try {
    const tenantRes = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
      ['Typing Test Tenant ' + suffix]
    );
    const tenantId = tenantRes.rows[0].id;
    createdTenantIds.push(tenantId);

    const userRes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Admin', 'Typing', TRUE) RETURNING id`,
      ['admin-typing-' + suffix + '@example.test']
    );
    const userId = userRes.rows[0].id;
    createdUserIds.push(userId);

    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN')`, [tenantId, userId]);

    const phone = '905' + crypto.randomInt(100000000, 999999999);
    const channelRes = await client.query(
      `INSERT INTO tenant_channels (tenant_id, channel_type, external_channel_id, display_name, status)
       VALUES ($1, 'WHATSAPP', $2, 'WhatsApp Typing Channel', 'active') RETURNING id`,
      [tenantId, phone]
    );
    const channelId = channelRes.rows[0].id;

    await client.query(
      `INSERT INTO channel_integrations (integration_key, integration_type, tenant_id, channel_id, enabled)
       VALUES ($1, 'WHATSAPP', $2, $3, TRUE)`,
      ['whatsapp:' + phone, tenantId, channelId]
    );

    const convRes = await client.query(
      `INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id, status, handling_mode, communication_language)
       VALUES ($1, $2, $3, $4, 'open', 'AI', 'tr') RETURNING id`,
      [tenantId, channelId, 'conv-typing-' + suffix, 'customer-typing-' + suffix]
    );
    const conversationId = convRes.rows[0].id;

    // 1. Initial customer message
    await client.query(
      `INSERT INTO conversation_messages (tenant_id, conversation_id, sender_type, content, external_message_id)
       VALUES ($1, $2, 'CUSTOMER', 'Merhaba', 'wamid.CUST_1')`,
      [tenantId, conversationId]
    );

    // 2. Normal AI response: typing indicator is sent
    let aiTypingAttempted = false;
    const aiTurn = await orchestrateWhatsAppInboundAiResponse({
      whatsappInbox: {
        duplicate: false,
        shouldInvokeAi: true,
        conversation: { handling_mode: 'AI' },
        integration: { tenant_id: tenantId, channel_id: channelId, external_channel_id: phone },
      },
      incomingMessageId: 'wamid.CUST_1',
      sendTyping: async ({ phoneNumberId, incomingMessageId }) => {
        assert.equal(phoneNumberId, phone);
        assert.equal(incomingMessageId, 'wamid.CUST_1');
        aiTypingAttempted = true;
        return { ok: true, providerStatus: 200 };
      },
      processAiResponse: async () => ({ delivered: true, aiResponsePath: 'NORMAL_AI' }),
    });
    assert.equal(aiTypingAttempted, true);
    assert.equal(aiTurn.suppressed, false);

    // 3. Customer requests live support: customer wamid used to send native typing before transfer message
    let supportTypingAttempted = false;
    let pacingApplied = false;
    const supportDeliverResult = await deliverAutomatedWhatsAppMessageWithTyping({
      database: client,
      tenantId,
      conversationId,
      phoneNumberId: phone,
      recipient: 'customer-typing-' + suffix,
      content: 'Canlı müşteri temsilcimize aktarıyorum...',
      incomingMessageId: 'wamid.CUST_1',
      sendTyping: async ({ phoneNumberId, incomingMessageId }) => {
        assert.equal(phoneNumberId, phone);
        assert.equal(incomingMessageId, 'wamid.CUST_1');
        supportTypingAttempted = true;
        return { ok: true, providerStatus: 200 };
      },
      deliverText: async (payload) => {
        assert.equal(payload.recipient, 'customer-typing-' + suffix);
        return { delivered: true };
      },
      applyPacing: async () => {
        pacingApplied = true;
        return { delayedMs: 1500 };
      },
    });
    assert.equal(supportTypingAttempted, true);
    assert.equal(pacingApplied, true);
    assert.equal(supportDeliverResult.typing.succeeded, true);

    // 4. In HUMAN mode: AI conversational typing MUST be suppressed
    let humanModeAiTyping = 0;
    const humanModeTurn = await orchestrateWhatsAppInboundAiResponse({
      whatsappInbox: {
        duplicate: false,
        shouldInvokeAi: false,
        conversation: { handling_mode: 'HUMAN' },
        integration: { tenant_id: tenantId, channel_id: channelId, external_channel_id: phone },
      },
      incomingMessageId: 'wamid.CUST_2',
      sendTyping: async () => { humanModeAiTyping++; },
      processAiResponse: async () => { throw new Error('AI must not execute during human mode'); },
    });
    assert.equal(humanModeTurn.suppressed, true);
    assert.equal(humanModeAiTyping, 0);

    // 5. Return to AI: lifecycle notice sends typing indicator based on associated customer wamid
    await client.query(
      `UPDATE conversations SET handling_mode = 'HUMAN', assigned_agent_user_id = $1, human_attention_state = 'ACKNOWLEDGED' WHERE id = $2`,
      [userId, conversationId]
    );

    let returnTypingAttempted = false;
    let returnPacingApplied = false;
    const returnNoticeSent = [];
    await operateConversation({
      database,
      tenantId,
      conversationId,
      action: 'return_to_ai',
      actor: { userId, systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
      deliverWhatsApp: async (payload) => {
        returnNoticeSent.push(payload);
        return { deliveredChunks: 1, failedChunks: 0 };
      },
      sendTyping: async ({ phoneNumberId, incomingMessageId }) => {
        assert.equal(phoneNumberId, phone);
        assert.equal(incomingMessageId, 'wamid.CUST_1');
        returnTypingAttempted = true;
        return { ok: true, providerStatus: 200 };
      },
      applyPacing: async () => {
        returnPacingApplied = true;
        return { delayedMs: 1500 };
      },
    });
    assert.equal(returnTypingAttempted, true);
    assert.equal(returnPacingApplied, true);
    assert.equal(returnNoticeSent.length, 1);
    assert.match(returnNoticeSent[0].content, /sona ermiştir/);

    // 6. Post Return-to-AI: next customer message restores native typing & AI reply
    let postReturnTypingAttempted = false;
    const postReturnAiTurn = await orchestrateWhatsAppInboundAiResponse({
      whatsappInbox: {
        duplicate: false,
        shouldInvokeAi: true,
        conversation: { handling_mode: 'AI' },
        integration: { tenant_id: tenantId, channel_id: channelId, external_channel_id: phone },
      },
      incomingMessageId: 'wamid.POST_RETURN_1',
      sendTyping: async ({ phoneNumberId, incomingMessageId }) => {
        assert.equal(phoneNumberId, phone);
        assert.equal(incomingMessageId, 'wamid.POST_RETURN_1');
        postReturnTypingAttempted = true;
        return { ok: true, providerStatus: 200 };
      },
      processAiResponse: async () => ({ delivered: true, aiResponsePath: 'POST_RETURN_AI' }),
    });
    assert.equal(postReturnTypingAttempted, true);
    assert.equal(postReturnAiTurn.suppressed, false);
  } finally {
    client.release();
  }
});


test('Real PWA Push Delivery Pipeline, Active Subscription Preference, and Diagnostics', async () => {
  const client = await database.connect();
  try {
    const tenantRes = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
      ['Push Test Tenant ' + suffix]
    );
    const tenantId = tenantRes.rows[0].id;
    createdTenantIds.push(tenantId);

    // Ensure platform provisioning (5+5 escalation policy)
    await client.query(`SELECT ensure_tenant_platform_capabilities($1, 1)`, [tenantId]);

    // Create 2 users: Seed Admin (no push sub) and Device Admin (has active push sub)
    const seedAdminRes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Seed', 'Admin', TRUE) RETURNING id`,
      ['seed-admin-' + suffix + '@example.test']
    );
    const seedAdminId = seedAdminRes.rows[0].id;

    const deviceAdminRes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Device', 'Admin', TRUE) RETURNING id`,
      ['device-admin-' + suffix + '@example.test']
    );
    const deviceAdminId = deviceAdminRes.rows[0].id;
    createdUserIds.push(seedAdminId, deviceAdminId);

    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN')`, [tenantId, seedAdminId]);
    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN')`, [tenantId, deviceAdminId]);

    // Register active push subscription for deviceAdminId
    await registerPushSubscription({
      database: client,
      tenantId,
      userId: deviceAdminId,
      subscription: {
        endpoint: 'https://push.example.test/device-' + suffix,
        keys: { p256dh: 'test-p256dh-' + suffix, auth: 'test-auth-' + suffix },
      },
    });

    // 1. Verify operator resolution prefers operator with active push subscription!
    const resolvedOperator = await resolveCanonicalHumanSupportOperator({
      client,
      tenantId,
    });
    assert.equal(resolvedOperator, deviceAdminId, 'Canonical operator assignment must prioritize operator with active push subscription');

    const pushPhone = '905' + crypto.randomInt(100000000, 999999999);
    const pushChannelRes = await client.query(
      `INSERT INTO tenant_channels (tenant_id, channel_type, external_channel_id, display_name, status)
       VALUES ($1, 'WHATSAPP', $2, 'Push Channel', 'active') RETURNING id`,
      [tenantId, pushPhone]
    );
    const pushChannelId = pushChannelRes.rows[0].id;

    // 2. Open conversation and request human support
    const convRes = await client.query(
      `INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id, status, handling_mode, human_attention_state)
       VALUES ($1, $2, $3, $4, 'open', 'AI', 'NONE') RETURNING id`,
      [tenantId, pushChannelId, 'conv-push-' + suffix, 'customer-push-' + suffix]
    );
    const conversationId = convRes.rows[0].id;

    const handoff = await requestCustomerHumanSupport({
      tenantId,
      conversationId,
      acknowledgement: 'Destek aktarılıyor',
      database,
    });
    assert.equal(handoff.assignedOperatorId, deviceAdminId);

    // 3. Immediate Push Notification Delivery
    const pushedPwaNotifications = [];
    await triggerImmediateHumanSupportNotificationPipeline({
      database,
      tenantId,
      conversationId,
      deliverWebPush: async ({ subscription, notification }) => {
        pushedPwaNotifications.push({ subscription, notification });
        return { status: 'DELIVERED' };
      },
    });

    assert.equal(pushedPwaNotifications.length, 1, 'Immediate push notification must be delivered to device admin');
    assert.equal(pushedPwaNotifications[0].subscription.endpoint, 'https://push.example.test/device-' + suffix);
    assert.equal(pushedPwaNotifications[0].notification.type, 'HUMAN_HANDOFF_REQUESTED');
    assert.equal(pushedPwaNotifications[0].notification.deepLink, `/app/${tenantId}/conversations/whatsapp/${conversationId}`);

    // 4. Verify Deep Link Validation: only internal dashboard route permitted, cross-tenant rejected
    const validLink = validateInternalDashboardDeepLink(`/app/${tenantId}/conversations/whatsapp/${conversationId}`, tenantId);
    assert.equal(validLink, `/app/${tenantId}/conversations/whatsapp/${conversationId}`);
    assert.throws(
      () => validateInternalDashboardDeepLink(`/app/00000000-0000-0000-0000-000000000000/conversations/whatsapp/${conversationId}`, tenantId),
      /PUSH_DEEP_LINK_INVALID/,
      'Cross-tenant deep link must fail closed'
    );

    // 5. Stale Subscription Invalidation (410 Gone / 404 Not Found)
    const outboxRes = await client.query(
      `SELECT id, subscription_id FROM push_notification_outbox WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    const testOutboxId = outboxRes.rows[0].id;
    // Mark as pending to simulate retry/delivery attempt with expired endpoint
    await client.query(`UPDATE push_notification_outbox SET status = 'PENDING' WHERE id = $1`, [testOutboxId]);

    const outcome = await processPushNotificationOutbox({
      database,
      tenantId,
      deliver: async () => ({ statusCode: 410 }), // Expired
    });
    assert.equal(outcome.expired, 1);

    const subState = await client.query(
      `SELECT enabled, failure_code FROM push_notification_subscriptions WHERE id = $1`,
      [outboxRes.rows[0].subscription_id]
    );
    assert.equal(subState.rows[0].enabled, false, 'Expired subscription must be disabled');
    assert.equal(subState.rows[0].failure_code, 'EXPIRED');

    // 6. Web Push Delivery Adapter payload creation check
    const webpushModule = await import('web-push');
    const webpushLib = webpushModule.default ?? webpushModule;
    const testVapid = webpushLib.generateVAPIDKeys();
    const adapter = await createWebPushDeliveryAdapter({
      configuration: { publicKey: testVapid.publicKey, privateKey: testVapid.privateKey, subject: 'mailto:test@example.com' },
    });
    assert.ok(adapter, 'Web push adapter must be initialized when config is present');
  } finally {
    client.release();
  }
});



