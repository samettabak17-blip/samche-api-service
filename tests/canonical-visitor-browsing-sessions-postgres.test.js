import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { resolvePostgresSsl } from '../config/postgres-ssl.js';
import { isSafeTestDatabaseUrl } from '../scripts/test-database-safety.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !isSafeTestDatabaseUrl(connectionString)) {
  throw new Error('CANONICAL_BROWSING_POSTGRES_REQUIRES_TEST_DATABASE_URL');
}

process.env.DATABASE_URL ||= connectionString;
process.env.JWT_SECRET ||= 'test-secret-value';

const {
  saveWebChatSessionBrowsingState,
  loadWebChatSessionBrowsingState,
  cleanupExpiredWebChatSessions,
  updateSessionBrowsingState,
  formatVisitorContextForHandoff,
  updateWebChatSessionEngagementState,
} = await import('../services/contextual-intelligence-service.js');
const { persistWebChatInbound } = await import('../services/live-inbox-service.js');

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
    [`browsing-${label}-${suffix}`],
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

  const widgetKey = `widget_${label}_${suffix}`;
  await client.query(
    `INSERT INTO channel_integrations (tenant_id, channel_id, assistant_id, integration_type, integration_key, enabled)
     VALUES ($1, $2, $3, 'WEB_CHAT', $4, TRUE)`,
    [tenantId, channelId, assistantId, widgetKey],
  );

  return { tenantId, assistantId, channelId, widgetKey };
}

test('Migration 077 applies cleanly and idempotently', async () => {
  const client = await database.connect();
  try {
    const migrationSql = fs.readFileSync(
      new URL('../migrations/077_canonical_visitor_browsing_sessions.sql', import.meta.url),
      'utf8',
    );
    await client.query(migrationSql);
    await client.query(migrationSql);

    const checkTable = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'web_chat_public_sessions'`,
    );
    assert.ok(checkTable.rows.some((r) => r.column_name === 'session_id'));
    assert.ok(checkTable.rows.some((r) => r.column_name === 'current_page'));
    assert.ok(checkTable.rows.some((r) => r.column_name === 'browsing_history'));

    const checkConv = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'visitor_context'`,
    );
    assert.equal(checkConv.rowCount, 1);
  } finally {
    client.release();
  }
});

test('Migration 078 applies cleanly and idempotently', async () => {
  const client = await database.connect();
  try {
    const migrationSql = fs.readFileSync(
      new URL('../migrations/078_canonical_web_chat_proactive_engagement.sql', import.meta.url),
      'utf8',
    );
    await client.query(migrationSql);
    await client.query(migrationSql);

    const checkTable = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'web_chat_public_sessions' AND column_name = 'engagement_state'`,
    );
    assert.equal(checkTable.rowCount, 1);
  } finally {
    client.release();
  }
});



test('Real PostgreSQL: session storage, loading, updating, tenant isolation, and TTL cleanup', async () => {
  const client = await database.connect();
  try {
    const tenantA = await createTenantFixture(client, 'tenant-a');
    const tenantB = await createTenantFixture(client, 'tenant-b');

    const sessionAId = crypto.randomUUID();
    const sessionBId = crypto.randomUUID();

    // 1. Save browsing state for Tenant A
    const initialBrowsingA = updateSessionBrowsingState({
      rawPageContext: {
        url: 'https://site-a.com/projects/tower-a',
        entity_id: 'proj_a',
        entity_name: 'Tower A',
        entity_type: 'PROJECT',
        attributes: { price: '1.2M AED' },
      },
    });

    const savedA = await saveWebChatSessionBrowsingState({
      database,
      tenantId: tenantA.tenantId,
      assistantId: tenantA.assistantId,
      channelId: tenantA.channelId,
      widgetKey: tenantA.widgetKey,
      sessionId: sessionAId,
      browsingState: initialBrowsingA,
    });
    assert.equal(savedA, true);

    // 2. Load browsing state for Tenant A
    const loadedA = await loadWebChatSessionBrowsingState({
      database,
      tenantId: tenantA.tenantId,
      sessionId: sessionAId,
    });
    assert.ok(loadedA);
    assert.equal(loadedA.currentEntity.entity_name, 'Tower A');
    assert.equal(loadedA.currentEntity.attributes.price, '1.2M AED');

    // 3. Strict Tenant Isolation: Tenant B CANNOT read Tenant A session
    const leakAttempt = await loadWebChatSessionBrowsingState({
      database,
      tenantId: tenantB.tenantId,
      sessionId: sessionAId,
    });
    assert.equal(leakAttempt, null);

    // 4. Update session A with navigation to Tower B
    const updatedBrowsingA = updateSessionBrowsingState({
      currentState: loadedA,
      rawPageContext: {
        url: 'https://site-a.com/projects/tower-b',
        entity_id: 'proj_b',
        entity_name: 'Tower B',
        entity_type: 'PROJECT',
        attributes: { price: '2.5M AED' },
      },
    });

    await saveWebChatSessionBrowsingState({
      database,
      tenantId: tenantA.tenantId,
      assistantId: tenantA.assistantId,
      channelId: tenantA.channelId,
      widgetKey: tenantA.widgetKey,
      sessionId: sessionAId,
      browsingState: updatedBrowsingA,
    });

    const reloadedA = await loadWebChatSessionBrowsingState({
      database,
      tenantId: tenantA.tenantId,
      sessionId: sessionAId,
    });
    assert.equal(reloadedA.currentEntity.entity_name, 'Tower B');
    assert.equal(reloadedA.previousEntities.length, 1);
    assert.equal(reloadedA.previousEntities[0].entity_name, 'Tower A');

    // 4b. Test engagement state updating and loading
    const updatedEngagement = await updateWebChatSessionEngagementState({
      database,
      tenantId: tenantA.tenantId,
      sessionId: sessionAId,
      engagementState: {
        proactiveMessageSent: true,
        intentState: 'HIGH',
        intentScore: 85,
        dismissedAt: null,
      },
    });
    assert.equal(updatedEngagement, true);

    const reloadedWithEngagement = await loadWebChatSessionBrowsingState({
      database,
      tenantId: tenantA.tenantId,
      sessionId: sessionAId,
    });
    assert.equal(reloadedWithEngagement.engagementState.proactiveMessageSent, true);
    assert.equal(reloadedWithEngagement.engagementState.intentState, 'HIGH');
    assert.equal(reloadedWithEngagement.engagementState.intentScore, 85);

    // 5. Save expired session for Tenant B to verify TTL cleanup
    const expiredBrowsingB = updateSessionBrowsingState({
      rawPageContext: {
        url: '/expired',
        entity_name: 'Old Page',
      },
    });
    await saveWebChatSessionBrowsingState({
      database,
      tenantId: tenantB.tenantId,
      assistantId: tenantB.assistantId,
      channelId: tenantB.channelId,
      widgetKey: tenantB.widgetKey,
      sessionId: sessionBId,
      browsingState: expiredBrowsingB,
      ttlHours: -1,
    });

    const loadedExpired = await loadWebChatSessionBrowsingState({
      database,
      tenantId: tenantB.tenantId,
      sessionId: sessionBId,
    });
    assert.equal(loadedExpired, null);

    const purgedCount = await cleanupExpiredWebChatSessions({ database });
    assert.ok(purgedCount >= 1);

    const stillActiveA = await loadWebChatSessionBrowsingState({
      database,
      tenantId: tenantA.tenantId,
      sessionId: sessionAId,
    });
    assert.ok(stillActiveA);
    assert.equal(stillActiveA.currentEntity.entity_name, 'Tower B');
  } finally {
    client.release();
  }
});

test('Real PostgreSQL: persistWebChatInbound records conversation and visitor_context for human handoff', async () => {
  const client = await database.connect();
  try {
    const fixture = await createTenantFixture(client, 'handoff-pg');
    const sessionId = crypto.randomUUID();

    const browsingState = {
      currentEntity: {
        entity_name: 'Skyline Penthouse',
        entity_type: 'PROJECT',
        canonical_url: '/projects/skyline',
        attributes: { price: '4,000,000 AED' },
      },
      previousEntities: [
        { entity_name: 'Marina Studio', entity_type: 'PROJECT', canonical_url: '/projects/marina' },
      ],
    };

    const visitorHandoffContext = formatVisitorContextForHandoff(browsingState);

    const integration = {
      tenant_id: fixture.tenantId,
      channel_id: fixture.channelId,
      assistant_id: fixture.assistantId,
      channel_status: 'active',
    };

    const inboundResult = await persistWebChatInbound({
      externalSessionId: sessionId,
      content: 'Canlı destek almak istiyorum',
      integration,
      visitorContext: visitorHandoffContext,
      database,
    });

    assert.ok(inboundResult);
    assert.ok(inboundResult.conversation);

    const convRecord = await client.query(
      `SELECT visitor_context FROM conversations WHERE id = $1 AND tenant_id = $2`,
      [inboundResult.conversation.id, fixture.tenantId],
    );

    assert.equal(convRecord.rowCount, 1);
    const storedContext = convRecord.rows[0].visitor_context;
    assert.ok(storedContext);
    assert.equal(storedContext.current_entity.name, 'Skyline Penthouse');
    assert.equal(storedContext.previous_entities.length, 1);
    assert.match(storedContext.summary_text, /Skyline Penthouse/);
  } finally {
    client.release();
  }
});
