import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) {
  throw new Error('CONVERSATION_PERSISTENCE_POSTGRES_REQUIRES_TEST_DATABASE_URL');
}

process.env.DATABASE_URL ||= connectionString;
process.env.JWT_SECRET ||= 'test-secret-value';

const {
  saveWebChatSessionBrowsingState,
  loadWebChatSessionBrowsingState,
  formatVisitorContextForHandoff,
} = await import('../services/contextual-intelligence-service.js');
const {
  persistWebChatInbound,
  getWebChatPublicFeed,
  persistAssistantResponseIfCurrent,
} = await import('../services/live-inbox-service.js');

const database = new pg.Pool({
  connectionString,
  ssl: resolvePostgresSsl({ connectionString, databaseSsl: process.env.DATABASE_SSL || 'strict', nodeEnv: 'test' }),
  max: 3,
});

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
const createdTenantIds = [];

test.after(async () => {
  try {
    if (createdTenantIds.length) {
      await database.query('DELETE FROM web_chat_public_sessions WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('UPDATE conversations SET contact_id = NULL WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_activities WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_deals WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_leads WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversation_messages WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM conversations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_contacts WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM channel_integrations WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenant_channels WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM ai_assistants WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM crm_pipeline_stages WHERE tenant_id = ANY($1::uuid[])', [createdTenantIds]);
      await database.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [createdTenantIds]);
    }
  } finally {
    await database.end();
  }
});

async function createTenantFixture(client, label) {
  const tRes = await client.query(
    `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
    [`persist-${label}-${suffix}`],
  );
  const tenantId = tRes.rows[0].id;
  createdTenantIds.push(tenantId);

  const aRes = await client.query(
    `INSERT INTO ai_assistants (tenant_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [tenantId, `Assistant ${label}`],
  );
  const assistantId = aRes.rows[0].id;

  const cRes = await client.query(
    `INSERT INTO tenant_channels (tenant_id, channel_type, display_name, status, assistant_id)
     VALUES ($1, 'WEB_CHAT', $2, 'active', $3) RETURNING id`,
    [tenantId, `Web Chat ${label}`, assistantId],
  );
  const channelId = cRes.rows[0].id;

  const widgetKey = `widget_p_${label}_${suffix}`;
  await client.query(
    `INSERT INTO channel_integrations (tenant_id, channel_id, assistant_id, integration_type, integration_key, enabled)
     VALUES ($1, $2, $3, 'WEB_CHAT', $4, TRUE)`,
    [tenantId, channelId, assistantId, widgetKey],
  );

  return { tenantId, assistantId, channelId, widgetKey };
}

test('Real PostgreSQL: multi-turn conversation persistence and hydration', async () => {
  const client = await database.connect();
  try {
    const fixture = await createTenantFixture(client, 'multi-turn');
    const sessionId = crypto.randomUUID();
    const integration = {
      tenant_id: fixture.tenantId,
      channel_id: fixture.channelId,
      assistant_id: fixture.assistantId,
      channel_status: 'active',
    };

    // Turn 1: Customer
    const inbound1 = await persistWebChatInbound({
      externalSessionId: sessionId,
      content: 'Saat modellerinizi öğrenebilir miyim?',
      integration,
      database,
    });
    assert.ok(inbound1);
    assert.equal(inbound1.shouldInvokeAi, true);

    // Turn 1: Assistant
    await persistAssistantResponseIfCurrent({
      tenantId: fixture.tenantId,
      conversationId: inbound1.conversation.id,
      content: 'Titan Akıllı Saat Pro modelimiz bulunmaktadır.',
      handlingVersion: inbound1.handlingVersion,
      database,
    });

    // Turn 2: Customer
    const inbound2 = await persistWebChatInbound({
      externalSessionId: sessionId,
      content: 'Pil ömrü ne kadar?',
      integration,
      database,
    });
    assert.ok(inbound2);
    assert.equal(inbound2.conversation.id, inbound1.conversation.id, 'Must reuse same conversation ID');

    // Turn 2: Assistant
    await persistAssistantResponseIfCurrent({
      tenantId: fixture.tenantId,
      conversationId: inbound2.conversation.id,
      content: 'Tipik kullanımda 14 güne kadar sürmektedir.',
      handlingVersion: inbound2.handlingVersion,
      database,
    });

    // Hydrate Feed
    const feed = await getWebChatPublicFeed({
      externalSessionId: sessionId,
      integration,
      database,
    });

    assert.ok(feed);
    assert.equal(feed.conversationId, inbound1.conversation.id);
    assert.equal(feed.messages.length, 4);
    assert.equal(feed.messages[0].role, 'user');
    assert.equal(feed.messages[0].content, 'Saat modellerinizi öğrenebilir miyim?');
    assert.equal(feed.messages[1].role, 'assistant');
    assert.equal(feed.messages[1].content, 'Titan Akıllı Saat Pro modelimiz bulunmaktadır.');
    assert.equal(feed.messages[2].role, 'user');
    assert.equal(feed.messages[2].content, 'Pil ömrü ne kadar?');
    assert.equal(feed.messages[3].role, 'assistant');
  } finally {
    client.release();
  }
});

test('Real PostgreSQL: duplicate conversation prevention on refresh and navigation', async () => {
  const client = await database.connect();
  try {
    const fixture = await createTenantFixture(client, 'no-dupes');
    const sessionId = crypto.randomUUID();
    const integration = {
      tenant_id: fixture.tenantId,
      channel_id: fixture.channelId,
      assistant_id: fixture.assistantId,
      channel_status: 'active',
    };

    // Message 1 on Product A
    const res1 = await persistWebChatInbound({
      externalSessionId: sessionId,
      content: 'Product A hakkinda bilgi',
      integration,
      database,
    });

    // SPA Navigation to Product B & Message 2
    const res2 = await persistWebChatInbound({
      externalSessionId: sessionId,
      content: 'Product B hakkinda bilgi',
      integration,
      database,
    });

    // Refresh simulation (Message 3 with same session)
    const res3 = await persistWebChatInbound({
      externalSessionId: sessionId,
      content: 'Sayfayi yeniledim, devam ediyoruz',
      integration,
      database,
    });

    assert.equal(res1.conversation.id, res2.conversation.id);
    assert.equal(res2.conversation.id, res3.conversation.id);

    // Verify exactly 1 conversation exists in the database for this session
    const totalConv = await client.query(
      `SELECT count(*)::int as count FROM conversations WHERE tenant_id = $1 AND channel_id = $2`,
      [fixture.tenantId, fixture.channelId]
    );
    assert.equal(totalConv.rows[0].count, 1, 'Exactly one conversation record must exist, no duplicates');
  } finally {
    client.release();
  }
});


test('Real PostgreSQL: human takeover state survives refresh and suppresses AI', async () => {
  const client = await database.connect();
  try {
    const fixture = await createTenantFixture(client, 'human-mode');
    const sessionId = crypto.randomUUID();
    const integration = {
      tenant_id: fixture.tenantId,
      channel_id: fixture.channelId,
      assistant_id: fixture.assistantId,
      channel_status: 'active',
    };

    // Initial visitor message
    const inbound = await persistWebChatInbound({
      externalSessionId: sessionId,
      content: 'Canlı bir temsilci ile görüşmek istiyorum.',
      integration,
      database,
    });
    assert.ok(inbound);
    assert.equal(inbound.shouldInvokeAi, true);

    // Operator takes over conversation
    await database.query(
      `UPDATE conversations SET handling_mode = 'HUMAN', handling_version = handling_version + 1 WHERE id = $1 AND tenant_id = $2`,
      [inbound.conversation.id, fixture.tenantId]
    );

    // Visitor refreshes and sends another message
    const afterRefreshInbound = await persistWebChatInbound({
      externalSessionId: sessionId,
      content: 'Orada mısınız?',
      integration,
      database,
    });

    assert.ok(afterRefreshInbound);
    assert.equal(afterRefreshInbound.handlingMode, 'HUMAN');
    assert.equal(afterRefreshInbound.shouldInvokeAi, false, 'AI must NOT be invoked when handling_mode is HUMAN');
    assert.equal(afterRefreshInbound.conversation.id, inbound.conversation.id);
  } finally {
    client.release();
  }
});

test('Real PostgreSQL: strict tenant isolation on conversation feed', async () => {
  const client = await database.connect();
  try {
    const tenantA = await createTenantFixture(client, 'iso-a');
    const tenantB = await createTenantFixture(client, 'iso-b');
    const sessionA = crypto.randomUUID();

    const integA = {
      tenant_id: tenantA.tenantId,
      channel_id: tenantA.channelId,
      assistant_id: tenantA.assistantId,
      channel_status: 'active',
    };
    const integB = {
      tenant_id: tenantB.tenantId,
      channel_id: tenantB.channelId,
      assistant_id: tenantB.assistantId,
      channel_status: 'active',
    };

    // Tenant A message
    await persistWebChatInbound({
      externalSessionId: sessionA,
      content: 'Gizli Tenant A mesajı',
      integration: integA,
      database,
    });

    // Tenant B attempts to fetch feed using sessionA
    const feedB = await getWebChatPublicFeed({
      externalSessionId: sessionA,
      integration: integB,
      database,
    });

    assert.ok(feedB);
    assert.equal(feedB.conversationId, null);
    assert.equal(feedB.messages.length, 0, 'Tenant B must NEVER access Tenant A conversation messages');
  } finally {
    client.release();
  }
});
