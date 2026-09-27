import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { evaluateAndProcessHighIntentLead } from '../services/high-intent-lead-service.js';
import { resolveInstagramIntegration } from '../services/instagram-live-inbox-service.js';

const { Client } = pg;

test('real PostgreSQL: progressive Instagram qualification converges to one pending consultation', async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required; this PostgreSQL contract must not be skipped');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  try {
    const suffix = crypto.randomUUID();
    const tenant = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
      [`Task 9 PostgreSQL ${suffix}`]
    );
    const tenantId = tenant.rows[0].id;
    const channel = await client.query(
      `INSERT INTO tenant_channels (tenant_id, channel_type, external_channel_id, display_name, status)
       VALUES ($1, 'INSTAGRAM', $2, 'Instagram', 'active') RETURNING id`,
      [tenantId, `ig-${suffix}`]
    );
    const channelId = channel.rows[0].id;
    await client.query(
      `INSERT INTO channel_integrations
        (integration_key, integration_type, tenant_id, channel_id, enabled, config)
       VALUES ($1, 'INSTAGRAM', $2, $3, TRUE, $4::jsonb)`,
      [`instagram:${tenantId}:${suffix}`, tenantId, channelId, JSON.stringify({ lead_notification_enabled: false })]
    );
    const contact = await client.query(
      `INSERT INTO crm_contacts
        (tenant_id, identity_kind, identity_hash, display_name, source)
       VALUES ($1, 'EXTERNAL_CUSTOMER', $2, 'Test Customer (@task9)', 'INSTAGRAM') RETURNING id`,
      [tenantId, crypto.createHash('sha256').update(`task9:${suffix}`).digest('hex')]
    );
    const contactId = contact.rows[0].id;
    const conversation = await client.query(
      `INSERT INTO conversations
        (tenant_id, channel_id, external_conversation_id, customer_external_id, contact_id, status, handling_mode)
       VALUES ($1, $2, $3, $4, $5, 'open', 'AI') RETURNING id`,
      [tenantId, channelId, `conversation-${suffix}`, `instagram:${suffix}`, contactId]
    );
    const conversationId = conversation.rows[0].id;
    const newStage = await client.query(
      `SELECT id FROM crm_pipeline_stages WHERE tenant_id = $1 AND stage_key = 'NEW_LEAD'`,
      [tenantId]
    );
    const lead = await client.query(
      `INSERT INTO crm_leads
        (tenant_id, contact_id, conversation_id, source_channel, pipeline_stage_id)
       VALUES ($1, $2, $3, 'INSTAGRAM', $4) RETURNING id`,
      [tenantId, contactId, conversationId, newStage.rows[0].id]
    );
    const leadId = lead.rows[0].id;
    await client.query(
      `INSERT INTO conversation_messages (tenant_id, conversation_id, external_message_id, sender_type, content)
       VALUES
        ($1, $2, $3, 'CUSTOMER', 'Dubai şirket kuruluşu için görüşme istiyorum.'),
        ($1, $2, $4, 'CUSTOMER', 'E-ticaret faaliyeti için Free Zone kurmak istiyorum. +971 50 123 4567, Salı saat 14:00 Dubai saati.')`,
      [tenantId, conversationId, `mid-${suffix}-1`, `mid-${suffix}-2`]
    );

    const transactionDatabase = { query: client.query.bind(client) };
    const first = await evaluateAndProcessHighIntentLead({ tenantId, conversationId, database: transactionDatabase, env: {} });
    const second = await evaluateAndProcessHighIntentLead({ tenantId, conversationId, database: transactionDatabase, env: {} });

    assert.equal(first.qualified, true);
    assert.equal(first.consultationStatus, 'PENDING');
    assert.equal(first.notificationLlmCalls, 0);
    assert.equal(first.notificationAiTokens, 0);
    assert.equal(second.qualified, true);

    const state = await client.query(
      `SELECT l.temperature, l.lead_score, s.stage_key,
              (SELECT COUNT(*)::int FROM crm_activities a
                WHERE a.tenant_id = l.tenant_id AND a.lead_id = l.id
                  AND a.event_type = 'AI_QUALIFICATION'
                  AND a.metadata->>'event' = 'CONSULTATION_REQUEST_PENDING') AS consultation_count
         FROM crm_leads l
         JOIN crm_pipeline_stages s ON s.id = l.pipeline_stage_id AND s.tenant_id = l.tenant_id
        WHERE l.id = $1 AND l.tenant_id = $2`,
      [leadId, tenantId]
    );
    assert.equal(state.rows[0].temperature, 'HOT');
    assert.equal(state.rows[0].stage_key, 'QUALIFIED');
    assert.equal(state.rows[0].consultation_count, 1);
    assert.ok(state.rows[0].lead_score >= 85);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

test('real PostgreSQL: duplicate enabled integration rows for one Instagram channel resolve to one owner', async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required; this PostgreSQL contract must not be skipped');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  try {
    const suffix = crypto.randomUUID();
    const recipientId = `1784${Date.now()}`;
    const tenant = await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ($1, 'STARTER') RETURNING id`,
      [`Task 9 resolver ${suffix}`]
    );
    const tenantId = tenant.rows[0].id;
    const channel = await client.query(
      `INSERT INTO tenant_channels (tenant_id, channel_type, external_channel_id, display_name, status)
       VALUES ($1, 'INSTAGRAM', $2, 'Instagram', 'active') RETURNING id`,
      [tenantId, recipientId]
    );
    const channelId = channel.rows[0].id;
    const config = JSON.stringify({ instagram_business_account_id: recipientId });
    await client.query(
      `INSERT INTO channel_integrations
        (integration_key, integration_type, tenant_id, channel_id, enabled, config)
       VALUES
        ($1, 'INSTAGRAM', $3, $4, TRUE, $5::jsonb),
        ($2, 'INSTAGRAM', $3, $4, TRUE, $5::jsonb)`,
      [`instagram:${tenantId}:one:${suffix}`, `instagram:${tenantId}:two:${suffix}`, tenantId, channelId, config]
    );

    const resolved = await resolveInstagramIntegration(client, recipientId);
    assert.equal(resolved.tenant_id, tenantId);
    assert.equal(resolved.channel_id, channelId);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
