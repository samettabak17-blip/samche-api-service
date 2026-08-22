import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  cleanupFixtureRun,
  createFixtureLifecycle,
  withFixtureLifecycle
} from './stagingCrmIntegration.js';

const databaseUrl = process.env.STAGING_DATABASE_URL;
const passwordHash = '$argon2id$v=19$m=65536,t=3,p=4$Y2ktY3JtLWxvY2FsLXNhbHQ$Y2ktY3JtLXRlc3QtaGFzaA';

function label(prefix) {
  return prefix + '-' + randomUUID().replace(/-/g, '').slice(0, 18);
}

function adminEmail(value) {
  return 'ci-crm-admin-' + value + '@example.test';
}

async function createDependentRows(client, fixture, value) {
  const channel = await client.query(
    "INSERT INTO tenant_channels (tenant_id,channel_type,display_name,status) VALUES ($1,'WEB_CHAT',$2,'active') RETURNING id",
    [fixture.tenantId, 'CI CRM lifecycle ' + value]
  );
  const conversation = await client.query(
    "INSERT INTO conversations (tenant_id,channel_id,external_conversation_id,customer_external_id,status,contact_id) VALUES ($1,$2,$3,$4,'open',$5) RETURNING id",
    [fixture.tenantId, channel.rows[0].id, 'ci-crm-conversation-' + value, 'ci-crm-customer-' + value, fixture.contactId]
  );
  const conversationId = conversation.rows[0].id;
  await client.query(
    "INSERT INTO conversation_messages (tenant_id,conversation_id,external_message_id,sender_type,content) VALUES ($1,$2,$3,'CUSTOMER','CRM fixture message')",
    [fixture.tenantId, conversationId, 'ci-crm-message-' + value]
  );
  await client.query(
    'UPDATE crm_leads SET conversation_id = $1 WHERE id = $2 AND tenant_id = $3',
    [conversationId, fixture.leadId, fixture.tenantId]
  );
  await client.query(
    "INSERT INTO crm_activities (tenant_id,lead_id,conversation_id,event_type) VALUES ($1,$2,$3,'LEAD_CREATED')",
    [fixture.tenantId, fixture.leadId, conversationId]
  );
  await client.query(
    "INSERT INTO crm_lead_analyses (tenant_id,lead_id,conversation_id,analysis_hash,analyzed_customer_message_count) VALUES ($1,$2,$3,$4,1)",
    [fixture.tenantId, fixture.leadId, conversationId, randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')]
  );
}

async function cleanup(client, fixture, value) {
  return cleanupFixtureRun({
    client,
    tenantIds: [fixture.tenantId],
    names: { tenantA: fixture.names.tenantA, tenantB: fixture.names.tenantA, agentEmail: fixture.names.agentEmail },
    agentId: fixture.agentId,
    adminId: fixture.adminId,
    adminEmail: adminEmail(value)
  });
}

const scopedTables = [
  'crm_lead_analyses',
  'crm_activities',
  'crm_deals',
  'crm_leads',
  'conversation_messages',
  'conversations',
  'crm_contacts',
  'crm_companies',
  'knowledge_base_documents',
  'tenant_channels',
  'ai_assistants',
  'crm_pipeline_stages',
  'tenant_users'
];

async function assertNoFixtureResiduals(client, fixture, value) {
  for (const table of scopedTables) {
    const result = await client.query(
      'SELECT COUNT(*)::int AS count FROM ' + table + ' WHERE tenant_id = $1',
      [fixture.tenantId]
    );
    assert.equal(result.rows[0].count, 0, table + ' retains fixture rows');
  }
  const users = await client.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE id = ANY($1::uuid[])',
    [[fixture.adminId, fixture.agentId]]
  );
  assert.equal(users.rows[0].count, 0, 'fixture users remain');
  const tenants = await client.query(
    'SELECT COUNT(*)::int AS count FROM tenants WHERE id = $1',
    [fixture.tenantId]
  );
  assert.equal(tenants.rows[0].count, 0, 'fixture tenant remains');
}

if (!databaseUrl) {
  test('CRM fixture lifecycle integration requires STAGING_DATABASE_URL', { skip: 'STAGING_DATABASE_URL is not available in this process' }, () => {});
} else {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  after(async () => { await pool.end(); });

  test('creates the complete disposable CRM fixture graph and cleans it after success', { concurrency: false }, async () => {
    const client = await pool.connect();
    const value = label('success');
    let captured;
    try {
      await withFixtureLifecycle({
        client,
        label: value,
        passwordHash,
        run: async (fixture) => {
          captured = fixture;
          await createDependentRows(client, fixture, value);
          assert.ok(fixture.tenantId);
          assert.ok(fixture.adminId);
          assert.ok(fixture.agentId);
          assert.ok(fixture.contactId);
          assert.ok(fixture.leadId);
          assert.ok(fixture.dealId);
          const membership = await client.query(
            "SELECT tenant_role FROM tenant_users WHERE tenant_id = $1 AND user_id = ANY($2::uuid[]) ORDER BY tenant_role",
            [fixture.tenantId, [fixture.adminId, fixture.agentId]]
          );
          assert.deepEqual(membership.rows.map((row) => row.tenant_role), ['ADMIN', 'AGENT']);
          const stages = await client.query(
            "SELECT COUNT(*)::int AS count FROM crm_pipeline_stages WHERE tenant_id = $1 AND stage_key = 'NEW_LEAD'",
            [fixture.tenantId]
          );
          assert.equal(stages.rows[0].count, 1);
        }
      });
      await assertNoFixtureResiduals(client, captured, value);
    } finally {
      client.release();
    }
  });

  test('finally cleanup runs after a simulated assertion failure', { concurrency: false }, async () => {
    const client = await pool.connect();
    const value = label('failure');
    let captured;
    try {
      await assert.rejects(
        withFixtureLifecycle({
          client,
          label: value,
          passwordHash,
          run: async (fixture) => {
            captured = fixture;
            await createDependentRows(client, fixture, value);
            throw new Error('simulated lifecycle assertion failure');
          }
        }),
        /simulated lifecycle assertion failure/
      );
      await assertNoFixtureResiduals(client, captured, value);
    } finally {
      client.release();
    }
  });

  test('fixture cleanup is idempotent and tolerates a partial graph', { concurrency: false }, async () => {
    const client = await pool.connect();
    const value = label('partial');
    let fixture;
    try {
      fixture = await createFixtureLifecycle({ client, label: value, passwordHash });
      await createDependentRows(client, fixture, value);
      await client.query('DELETE FROM crm_deals WHERE id = $1 AND tenant_id = $2', [fixture.dealId, fixture.tenantId]);
      await cleanup(client, fixture, value);
      await cleanup(client, fixture, value);
      await assertNoFixtureResiduals(client, fixture, value);
    } finally {
      if (fixture) await cleanup(client, fixture, value).catch(() => {});
      client.release();
    }
  });

  test('FIXTURE_SCOPE_MISMATCH blocks unsafe cleanup without touching the graph', { concurrency: false }, async () => {
    const client = await pool.connect();
    const value = label('scope');
    let fixture;
    try {
      fixture = await createFixtureLifecycle({ client, label: value, passwordHash });
      await createDependentRows(client, fixture, value);
      await assert.rejects(
        cleanupFixtureRun({
          client,
          tenantIds: [fixture.tenantId],
          names: { tenantA: '__not_fixture__', tenantB: '__not_fixture__' },
          agentId: fixture.agentId,
          adminId: fixture.adminId,
          adminEmail: adminEmail(value)
        }),
        /FIXTURE_SCOPE_MISMATCH/
      );
      const stillThere = await client.query('SELECT COUNT(*)::int AS count FROM crm_leads WHERE tenant_id = $1', [fixture.tenantId]);
      assert.equal(stillThere.rows[0].count, 1);
      await cleanup(client, fixture, value);
      await assertNoFixtureResiduals(client, fixture, value);
    } finally {
      if (fixture) await cleanup(client, fixture, value).catch(() => {});
      client.release();
    }
  });

  test('fixture cleanup leaves records outside its explicit tenant scope untouched', { concurrency: false }, async () => {
    const client = await pool.connect();
    const value = label('sentinel');
    const sentinelName = '__non_fixture_crm_' + value;
    let fixture;
    let sentinelId;
    let sentinelUserId;
    try {
      const sentinelTenant = await client.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [sentinelName]);
      sentinelId = sentinelTenant.rows[0].id;
      const sentinelUser = await client.query(
        "INSERT INTO users (email,password_hash,system_role) VALUES ($1,$2,'CUSTOMER') RETURNING id",
        ['non-fixture-' + value + '@example.test', passwordHash]
      );
      sentinelUserId = sentinelUser.rows[0].id;
      await client.query(
        "INSERT INTO tenant_users (tenant_id,user_id,tenant_role) VALUES ($1,$2,'ADMIN')",
        [sentinelId, sentinelUserId]
      );
      await client.query(
        "INSERT INTO crm_contacts (tenant_id,identity_kind,identity_hash,source) VALUES ($1,'ANONYMOUS_SESSION',$2,'SENTINEL')",
        [sentinelId, randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')]
      );

      fixture = await createFixtureLifecycle({ client, label: value, passwordHash });
      await cleanup(client, fixture, value);
      await assertNoFixtureResiduals(client, fixture, value);

      const sentinel = await client.query(
        'SELECT (SELECT COUNT(*) FROM tenants WHERE id = $1)::int AS tenant_count, (SELECT COUNT(*) FROM users WHERE id = $2)::int AS user_count, (SELECT COUNT(*) FROM crm_contacts WHERE tenant_id = $1)::int AS contact_count',
        [sentinelId, sentinelUserId]
      );
      assert.deepEqual(sentinel.rows[0], { tenant_count: 1, user_count: 1, contact_count: 1 });
    } finally {
      if (fixture) await cleanup(client, fixture, value).catch(() => {});
      if (sentinelId) {
        await client.query('DELETE FROM crm_contacts WHERE tenant_id = $1', [sentinelId]);
        await client.query('DELETE FROM tenant_users WHERE tenant_id = $1', [sentinelId]);
        if (sentinelUserId) await client.query('DELETE FROM users WHERE id = $1', [sentinelUserId]);
        await client.query('DELETE FROM crm_pipeline_stages WHERE tenant_id = $1', [sentinelId]);
        await client.query('DELETE FROM tenants WHERE id = $1 AND name = $2', [sentinelId, sentinelName]);
      }
      client.release();
    }
  });
}
