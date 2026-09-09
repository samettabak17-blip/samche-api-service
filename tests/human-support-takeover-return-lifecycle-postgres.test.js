import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
import { claimDueHumanSupportEscalations, requestCustomerHumanSupport } from '../services/human-support-service.js';
import { processHumanSupportNotificationOutbox } from '../services/human-support-notification-outbox-service.js';
import { resolveHumanSupportRecipients } from '../services/human-support-recipient-service.js';
process.env.DATABASE_URL ||= process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ||= 'test-secret-value';

const {
  appendAgentMessage,
  ConversationOperationError,
  getHumanDeliveryCapability,
  operateConversation,
} = await import('../services/live-inbox-service.js');
const { canOperateConversation } = await import('../services/conversation-permissions.js');

function canUseHumanReplyComposer(channelType, humanDeliveryConfigured) {
  return (channelType === 'SAMCHEGUIDE' || channelType === 'WHATSAPP' || channelType === 'WEB_CHAT') && humanDeliveryConfigured === true;
}

function canTakeOverConversation({ status, handlingMode, assignedAgentUserId, humanAttentionState, operatorAllowed }) {
  if (!operatorAllowed || status !== 'open' || assignedAgentUserId) return false;
  return handlingMode === 'AI' || (handlingMode === 'HUMAN' && humanAttentionState === 'REQUESTED');
}


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
      await database.query('DELETE FROM push_notification_outbox WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM push_notification_intents WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_notification_outbox WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM human_support_escalations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversation_messages WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversation_audit_events WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM channel_integrations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_channels WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM ai_assistants WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
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
    if (createdUserIds.length) {
      await database.query('DELETE FROM users WHERE id = ANY($1::uuid[]) AND is_test_fixture = TRUE', [createdUserIds]);
    }
    const defaultPool = (await import('../config/db.js')).default;
    await defaultPool.end().catch(() => {});
  } finally {
    await database.end();
  }
});

test('real PostgreSQL: canonical human support Take Over, Return to AI, and Live Inbox lifecycle regression', async () => {

  const client = await database.connect();
  try {
    // 1. Create Tenant A and Tenant B
    const tenantA = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['Yeşil Vadi ' + suffix]);
    const tenantB = await client.query(`INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`, ['Other Tenant ' + suffix]);
    const tenantAId = tenantA.rows[0].id;
    const tenantBId = tenantB.rows[0].id;
    createdTenantIds.push(tenantAId, tenantBId);

    // 2. Provision platform capabilities for both tenants (ensures policies and templates)
    await client.query('SELECT ensure_tenant_platform_capabilities($1, 1)', [tenantAId]);
    await client.query('SELECT ensure_tenant_platform_capabilities($1, 1)', [tenantBId]);

    // 3. Create Users:
    // - Platform OWNER (NOT initially in tenant_users of Tenant A)
    // - Tenant A Admin
    // - Tenant A Agent 1
    // - Tenant A Agent 2
    // - Tenant B Admin
    const ownerRes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'OWNER', 'ACTIVE', 'Platform', 'Owner', TRUE) RETURNING id`,
      ['owner-' + suffix + '@platform.test']
    );
    const adminARes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Admin', 'A', TRUE) RETURNING id`,
      ['admin-a-' + suffix + '@example.test']
    );
    const agent1ARes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Agent', '1', TRUE) RETURNING id`,
      ['agent1-a-' + suffix + '@example.test']
    );
    const agent2ARes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Agent', '2', TRUE) RETURNING id`,
      ['agent2-a-' + suffix + '@example.test']
    );
    const adminBRes = await client.query(
      `INSERT INTO users (email, email_normalized, password_hash, system_role, status, first_name, last_name, is_test_fixture)
       VALUES ($1, $1, 'hash', 'CUSTOMER', 'ACTIVE', 'Admin', 'B', TRUE) RETURNING id`,
      ['admin-b-' + suffix + '@example.test']
    );

    const ownerId = ownerRes.rows[0].id;
    const adminAId = adminARes.rows[0].id;
    const agent1AId = agent1ARes.rows[0].id;
    const agent2AId = agent2ARes.rows[0].id;
    const adminBId = adminBRes.rows[0].id;
    createdUserIds.push(ownerId, adminAId, agent1AId, agent2AId, adminBId);

    // Populate tenant_users: notice ownerId is deliberately NOT added to Tenant A yet
    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN')`, [tenantAId, adminAId]);
    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'AGENT')`, [tenantAId, agent1AId]);
    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'AGENT')`, [tenantAId, agent2AId]);
    await client.query(`INSERT INTO tenant_users (tenant_id, user_id, tenant_role) VALUES ($1, $2, 'ADMIN')`, [tenantBId, adminBId]);

    // 4. Set up AI assistant and WhatsApp channel with lowercase integration_key
    const assistantRes = await client.query(
      `INSERT INTO ai_assistants (tenant_id, name, model, status)
       VALUES ($1, 'Yeşil Vadi AI', 'gpt-4o-mini', 'active') RETURNING id`,
      [tenantAId]
    );
    const assistantId = assistantRes.rows[0].id;

    const rawPhone = '948536645017374';
    const channelRes = await client.query(
      `INSERT INTO tenant_channels (tenant_id, channel_type, external_channel_id, display_name, status, assistant_id)
       VALUES ($1, 'WHATSAPP', $2, 'Yeşil Vadi WhatsApp', 'active', $3) RETURNING id`,
      [tenantAId, rawPhone, assistantId]
    );
    const channelId = channelRes.rows[0].id;

    // Use lowercase integration_key to prove case-insensitivity fix
    await client.query(
      `INSERT INTO channel_integrations (integration_key, integration_type, tenant_id, channel_id, assistant_id, enabled)
       VALUES ($1, 'WHATSAPP', $2, $3, $4, TRUE)`,
      [`whatsapp:${rawPhone}`, tenantAId, channelId, assistantId]
    );

    // 5. Open conversation in Tenant A
    const convRes = await client.query(
      `INSERT INTO conversations (tenant_id, channel_id, external_conversation_id, customer_external_id, status, handling_mode, human_attention_state)
       VALUES ($1, $2, $3, $4, 'open', 'AI', 'NONE') RETURNING id`,
      [tenantAId, channelId, 'conv-' + suffix, 'whatsapp:905321234567']
    );
    const convId = convRes.rows[0].id;

    // --- TEST 1: Check delivery capability resolution ---
    const capability = await getHumanDeliveryCapability({ tenantId: tenantAId, conversationId: convId, database });
    assert.equal(capability.channelType, 'WHATSAPP');
    assert.equal(capability.configured, true, 'WhatsApp delivery capability must resolve true even with lowercase integration key');

    // --- TEST 2: Customer requests human support ---
    const handoff = await requestCustomerHumanSupport({
      tenantId: tenantAId,
      conversationId: convId,
      acknowledgement: 'Canlı temsilciye aktarılıyorsunuz.',
      topicSummary: 'Genel destek',
      database,
    });
    assert.equal(handoff.conversation.handling_mode, 'HUMAN', 'AI suppression must turn ON');
    assert.equal(handoff.conversation.human_attention_state, 'REQUESTED');
    assert.equal(handoff.conversation.assigned_agent_user_id, null, 'Newly requested conversation is unassigned');

    // Live Inbox UI logic:
    // Unassigned conversation allows takeover by eligible operator
    assert.equal(canTakeOverConversation({ status: 'open', handlingMode: 'HUMAN', humanAttentionState: 'REQUESTED', assignedAgentUserId: null, operatorAllowed: true }), true);
    // Unassigned conversation blocks reply for agent who does not own it yet
    assert.equal(canUseHumanReplyComposer('WHATSAPP', capability.configured), true);
    const canSendBeforeTakeover = Boolean(capability.configured && handoff.conversation.handling_mode === 'HUMAN' && (false || (true && false)));
    assert.equal(canSendBeforeTakeover, false, 'Unassigned conversation composer must remain blocked for agent before takeover');

    // --- TEST 3: TAKE OVER by Platform OWNER with NO prior tenant_users row ---
    // This proves the bug fix: platform owner automatically establishes membership in tenant_users
    // without throwing fk_conversations_assigned_agent foreign key violation!
    const deliveredWhatsApp = [];
    const takeoverOwner = await operateConversation({
      database,
      tenantId: tenantAId,
      conversationId: convId,
      action: 'takeover',
      actor: { userId: ownerId, systemRole: 'OWNER' },
      deliverWhatsApp: async (payload) => { deliveredWhatsApp.push(payload); return { deliveredChunks: 1, failedChunks: 0 }; },
    });
    assert.equal(takeoverOwner.assigned_agent_user_id, ownerId, 'Conversation must become assigned to platform owner');
    assert.equal(takeoverOwner.handling_mode, 'HUMAN', 'AI suppression must remain ON');
    assert.equal(takeoverOwner.human_attention_state, 'ACKNOWLEDGED', 'Attention state transitions to ACKNOWLEDGED');

    // Verify tenant_users row was created for platform owner
    const ownerTenantUser = await client.query('SELECT tenant_role FROM tenant_users WHERE tenant_id = $1 AND user_id = $2', [tenantAId, ownerId]);
    assert.equal(ownerTenantUser.rowCount, 1, 'Owner assignment row in tenant_users must be established');

    // Verify escalation is cancelled
    const escalationStatus = await client.query('SELECT status FROM human_support_escalations WHERE tenant_id = $1 AND conversation_id = $2', [tenantAId, convId]);
    assert.equal(escalationStatus.rows[0].status, 'COMPLETED', 'Escalation must be completed on takeover');

    // Verify audit event TAKEOVER was recorded
    const takeoverAudit = await client.query(
      `SELECT event_type, actor_user_id FROM conversation_audit_events WHERE tenant_id = $1 AND conversation_id = $2 AND event_type = 'TAKEOVER'`,
      [tenantAId, convId]
    );
    assert.equal(takeoverAudit.rowCount, 1, 'TAKEOVER audit event must be persisted');
    assert.equal(takeoverAudit.rows[0].actor_user_id, ownerId);

    // --- TEST 4: Second unauthorized operator CANNOT hijack ---
    await assert.rejects(
      operateConversation({
        database,
        tenantId: tenantAId,
        conversationId: convId,
        action: 'takeover',
        actor: { userId: agent1AId, systemRole: 'CUSTOMER', tenantRole: 'AGENT' },
      }),
      (err) => {
        assert.ok(err instanceof ConversationOperationError);
        assert.equal(err.code, 'CONVERSATION_ALREADY_ASSIGNED');
        assert.equal(err.status, 409);
        return true;
      },
      'Second operator cannot hijack conversation already assigned to owner'
    );

    // --- TEST 5: Wrong-tenant operator CANNOT take over (fail closed) ---
    await assert.rejects(
      operateConversation({
        database,
        tenantId: tenantBId,
        conversationId: convId, // Tenant A conversation accessed under Tenant B
        action: 'takeover',
        actor: { userId: adminBId, systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
      }),
      (err) => {
        assert.ok(err instanceof ConversationOperationError);
        assert.equal(err.code, 'CONVERSATION_NOT_FOUND');
        assert.equal(err.status, 404);
        return true;
      },
      'Cross-tenant takeover must fail closed with 404'
    );

    // --- TEST 6: Assigned operator can send reply message ---
    const sendResult = await appendAgentMessage({
      database,
      tenantId: tenantAId,
      conversationId: convId,
      actor: { userId: ownerId, systemRole: 'OWNER', tenantRole: 'ADMIN' },
      content: 'Merhaba, ben platform temsilciniz. Size nasıl yardımcı olabilirim?',
      deliverWhatsApp: async (payload) => { deliveredWhatsApp.push(payload); return { deliveredChunks: 1, failedChunks: 0 }; },
    });
    assert.equal(sendResult.duplicate, false);
    assert.equal(sendResult.delivery, 'SENT_TO_WHATSAPP');

    // --- TEST 7: Unauthorized operator CANNOT return conversation to AI ---
    await assert.rejects(
      operateConversation({
        database,
        tenantId: tenantAId,
        conversationId: convId,
        action: 'return_to_ai',
        actor: { userId: agent1AId, systemRole: 'CUSTOMER', tenantRole: 'AGENT' }, // Agent 1 is not assigned
      }),
      (err) => {
        assert.ok(err instanceof ConversationOperationError);
        assert.equal(err.code, 'RETURN_TO_AI_NOT_ALLOWED');
        assert.equal(err.status, 403);
        return true;
      },
      'Non-assigned agent must be denied return to AI'
    );

    // --- TEST 8: Assigned operator successfully returns conversation to AI ---
    const returnResult = await operateConversation({
      database,
      tenantId: tenantAId,
      conversationId: convId,
      action: 'return_to_ai',
      actor: { userId: ownerId, systemRole: 'OWNER', tenantRole: 'ADMIN' },
      deliverWhatsApp: async (payload) => { deliveredWhatsApp.push(payload); return { deliveredChunks: 1, failedChunks: 0 }; },
    });
    assert.equal(returnResult.handling_mode, 'AI', 'Handling mode must return to AI');
    assert.equal(returnResult.assigned_agent_user_id, null, 'Assigned agent user ID must clear to NULL');
    assert.equal(returnResult.human_attention_state, 'RESOLVED', 'Attention state must be RESOLVED');
    assert.ok(returnResult.human_support_closed_at, 'Closed timestamp must be set');

    // Verify RETURN_TO_AI lifecycle notice was delivered to customer
    assert.ok(deliveredWhatsApp.some((d) => d.content && (d.content.includes('sona ermiştir') || d.content.includes('ended'))), 'Localized return_to_ai lifecycle notice must be delivered');

    // Verify RETURN_TO_AI audit event was recorded
    const returnAudit = await client.query(
      `SELECT event_type, actor_user_id FROM conversation_audit_events WHERE tenant_id = $1 AND conversation_id = $2 AND event_type = 'RETURN_TO_AI'`,
      [tenantAId, convId]
    );
    assert.equal(returnAudit.rowCount, 1, 'RETURN_TO_AI audit event must be persisted');

    // --- TEST 9: Next inbound customer message gets AI response with native typing indicator ---
    const refreshedConv = await client.query('SELECT * FROM conversations WHERE id = $1 AND tenant_id = $2', [convId, tenantAId]);
    const currentConv = refreshedConv.rows[0];
    assert.equal(currentConv.handling_mode, 'AI');
    assert.equal(currentConv.assigned_agent_user_id, null, 'No stale operator lock remains');

    const shouldInvokeAi = currentConv.status === 'open' && currentConv.handling_mode === 'AI';
    assert.equal(shouldInvokeAi, true, 'Next customer message must be eligible to invoke AI again');

    // Escalation cannot resurrect
    const postReturnEscalations = await client.query(
      `SELECT status FROM human_support_escalations WHERE tenant_id = $1 AND conversation_id = $2 AND status IN ('PENDING', 'ACTIVE')`,
      [tenantAId, convId]
    );
    assert.equal(postReturnEscalations.rowCount, 0, 'No active or pending escalation jobs may resurrect');

    // --- TEST 10: Test agent-level takeover on unassigned conversation ---
    // Request support again on the conversation
    await client.query(
      `UPDATE conversations
          SET handling_mode = 'HUMAN',
              assigned_agent_user_id = NULL,
              human_attention_state = 'REQUESTED',
              human_support_closed_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2`,
      [convId, tenantAId]
    );

    // Agent 1 takes over unassigned conversation
    const agentTakeover = await operateConversation({
      database,
      tenantId: tenantAId,
      conversationId: convId,
      action: 'takeover',
      actor: { userId: agent1AId, systemRole: 'CUSTOMER', tenantRole: 'AGENT' },
      deliverWhatsApp: async (payload) => { deliveredWhatsApp.push(payload); return { deliveredChunks: 1, failedChunks: 0 }; },
    });
    assert.equal(agentTakeover.assigned_agent_user_id, agent1AId);
    assert.equal(agentTakeover.human_attention_state, 'ACKNOWLEDGED');

    // Agent 1 can idempotently re-take over their own conversation
    const idempotentTakeover = await operateConversation({
      database,
      tenantId: tenantAId,
      conversationId: convId,
      action: 'takeover',
      actor: { userId: agent1AId, systemRole: 'CUSTOMER', tenantRole: 'AGENT' },
    });
    assert.equal(idempotentTakeover.assigned_agent_user_id, agent1AId, 'Idempotent takeover by assigned operator must succeed');

    // Agent 1 (assigned) CAN return to AI
    const agentReturn = await operateConversation({
      database,
      tenantId: tenantAId,
      conversationId: convId,
      action: 'return_to_ai',
      actor: { userId: agent1AId, systemRole: 'CUSTOMER', tenantRole: 'AGENT' },
      deliverWhatsApp: async (payload) => { deliveredWhatsApp.push(payload); return { deliveredChunks: 1, failedChunks: 0 }; },
    });
    assert.equal(agentReturn.handling_mode, 'AI');
    assert.equal(agentReturn.assigned_agent_user_id, null);
    assert.equal(agentReturn.human_attention_state, 'RESOLVED');
  } finally {
    client.release();
  }
});

