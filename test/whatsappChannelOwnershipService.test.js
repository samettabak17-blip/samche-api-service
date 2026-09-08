import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WhatsAppChannelOwnershipError,
  configureWhatsAppChannel,
  normalizeWhatsAppExternalId,
  reconcileWhatsAppChannelIntegrity,
  transferWhatsAppChannelOwnership,
} from '../services/whatsapp-channel-ownership-service.js';

function createScriptedDatabase(handler) {
  const calls = [];
  let released = false;
  const client = {
    async query(text, params = []) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      calls.push({ sql, params });
      return handler({ sql, params, calls });
    },
    release() {
      released = true;
    },
  };
  return {
    calls,
    get released() { return released; },
    async connect() { return client; },
  };
}

test('normalizes one canonical WhatsApp physical external id', () => {
  assert.equal(normalizeWhatsAppExternalId(' whatsapp: 948536645017374 '), '948536645017374');
  assert.equal(normalizeWhatsAppExternalId('9485 3664-5017-374'), '948536645017374');
  assert.throws(
    () => normalizeWhatsAppExternalId('not-a-meta-phone-id'),
    (error) => error instanceof WhatsAppChannelOwnershipError && error.code === 'WHATSAPP_EXTERNAL_ID_INVALID'
  );
});

test('ordinary tenant configuration fails closed with a structured cross-tenant ownership conflict', async () => {
  const database = createScriptedDatabase(({ sql }) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM tenant_channels') && sql.includes("channel_type = 'WHATSAPP'")) {
      return { rows: [{ id: 'source-channel', tenant_id: 'source-tenant', status: 'active' }], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(
    configureWhatsAppChannel({
      database,
      tenantId: 'target-tenant',
      displayName: 'WhatsApp',
      externalChannelId: '948536645017374',
      assistantId: null,
      status: 'active',
    }),
    (error) => error instanceof WhatsAppChannelOwnershipError
      && error.code === 'WHATSAPP_CHANNEL_OWNERSHIP_CONFLICT'
      && error.details.ownership === 'OTHER_TENANT'
      && error.details.transferRequired === true
  );

  assert.ok(database.calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(!database.calls.some(({ sql }) => /^UPDATE tenant_channels/i.test(sql)));
  assert.ok(!database.calls.some(({ sql }) => /UPDATE conversations/i.test(sql)));
});

test('Tenant A OWNER cannot transfer Tenant B channel', async () => {
  let connected = false;
  const database = { async connect() { connected = true; throw new Error('must not connect'); } };

  await assert.rejects(
    transferWhatsAppChannelOwnership({
      database,
      actorSystemRole: 'CUSTOMER',
      actorUserId: 'tenant-a-owner-user',
      targetTenantId: 'tenant-a',
      targetAssistantId: 'tenant-a-assistant',
      externalChannelId: '948536645017374',
      expectedSourceChannelId: 'tenant-b-source-channel',
      confirmation: 'TRANSFER',
    }),
    (error) => error instanceof WhatsAppChannelOwnershipError
      && error.code === 'PLATFORM_OWNER_REQUIRED'
  );

  assert.equal(connected, false);
});

test('Tenant A ADMIN cannot transfer Tenant B channel', async () => {
  let connected = false;
  const database = { async connect() { connected = true; throw new Error('must not connect'); } };

  await assert.rejects(
    transferWhatsAppChannelOwnership({
      database,
      actorSystemRole: 'CUSTOMER',
      actorUserId: 'tenant-a-admin-user',
      targetTenantId: 'tenant-a',
      targetAssistantId: 'tenant-a-assistant',
      externalChannelId: '948536645017374',
      expectedSourceChannelId: 'tenant-b-source-channel',
      confirmation: 'TRANSFER',
    }),
    (error) => error instanceof WhatsAppChannelOwnershipError
      && error.code === 'PLATFORM_OWNER_REQUIRED'
  );

  assert.equal(connected, false);
});

test('Tenant A MEMBER cannot transfer Tenant B channel', async () => {
  let connected = false;
  const database = { async connect() { connected = true; throw new Error('must not connect'); } };

  await assert.rejects(
    transferWhatsAppChannelOwnership({
      database,
      actorSystemRole: 'CUSTOMER',
      actorUserId: 'tenant-a-member-user',
      targetTenantId: 'tenant-a',
      targetAssistantId: 'tenant-a-assistant',
      externalChannelId: '948536645017374',
      expectedSourceChannelId: 'tenant-b-source-channel',
      confirmation: 'TRANSFER',
    }),
    (error) => error instanceof WhatsAppChannelOwnershipError
      && error.code === 'PLATFORM_OWNER_REQUIRED'
  );

  assert.equal(connected, false);
});

test('platform owner transfer atomically retires the source, establishes one target owner, converges integration, and appends audit', async () => {
  const database = createScriptedDatabase(({ sql }) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM tenant_channels') && sql.includes("status = 'active'") && sql.includes('FOR UPDATE')) {
      return {
        rows: [{ id: 'source-channel', tenant_id: 'source-tenant', display_name: 'Old WhatsApp' }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM tenants') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: 'target-tenant', status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM ai_assistants')) {
      return { rows: [{ id: 'target-assistant', tenant_id: 'target-tenant', status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM tenant_channels') && sql.includes('tenant_id = $1') && sql.includes("status = 'inactive'")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('UPDATE tenant_channels') && sql.includes("SET status = 'inactive'")) {
      return { rows: [{ id: 'source-channel' }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO tenant_channels')) {
      return {
        rows: [{
          id: 'target-channel',
          tenant_id: 'target-tenant',
          assistant_id: 'target-assistant',
          external_channel_id: '948536645017374',
          status: 'active',
        }],
        rowCount: 1,
      };
    }
    if (sql.startsWith('UPDATE channel_integrations')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO channel_integrations')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO whatsapp_channel_ownership_events')) {
      return { rows: [{ id: 'immutable-event' }], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const result = await transferWhatsAppChannelOwnership({
    database,
    actorSystemRole: 'OWNER',
    actorUserId: 'platform-owner-user',
    targetTenantId: 'target-tenant',
    targetAssistantId: 'target-assistant',
    externalChannelId: 'whatsapp:948536645017374',
    expectedSourceChannelId: 'source-channel',
    displayName: 'Target WhatsApp',
    confirmation: 'TRANSFER',
  });

  assert.deepEqual(result, {
    channel: {
      id: 'target-channel',
      tenant_id: 'target-tenant',
      assistant_id: 'target-assistant',
      external_channel_id: '948536645017374',
      status: 'active',
    },
    sourceChannelId: 'source-channel',
    sourceTenantId: 'source-tenant',
    auditEventId: 'immutable-event',
    externalChannelId: '948536645017374',
  });
  assert.ok(database.calls.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(database.released);
  assert.ok(database.calls.some(({ sql }) => sql.startsWith('INSERT INTO whatsapp_channel_ownership_events')));
  assert.ok(!database.calls.some(({ sql }) => /UPDATE conversations/i.test(sql)));
  assert.ok(!database.calls.some(({ sql }) => /DELETE FROM conversations/i.test(sql)));
});

test('platform transfer fails atomically when canonical active ownership is ambiguous', async () => {
  const database = createScriptedDatabase(({ sql }) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM tenant_channels') && sql.includes("status = 'active'")) {
      return {
        rows: [
          { id: 'source-channel-a', tenant_id: 'source-tenant-a' },
          { id: 'source-channel-b', tenant_id: 'source-tenant-b' },
        ],
        rowCount: 2,
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  await assert.rejects(
    transferWhatsAppChannelOwnership({
      database,
      actorSystemRole: 'OWNER',
      actorUserId: 'platform-owner-user',
      targetTenantId: 'target-tenant',
      targetAssistantId: 'target-assistant',
      externalChannelId: '948536645017374',
      expectedSourceChannelId: 'source-channel-a',
      confirmation: 'TRANSFER',
    }),
    (error) => error instanceof WhatsAppChannelOwnershipError
      && error.code === 'WHATSAPP_CHANNEL_OWNERSHIP_AMBIGUOUS'
  );

  assert.ok(database.calls.some(({ sql }) => sql === 'ROLLBACK'));
  assert.ok(!database.calls.some(({ sql }) => sql === 'COMMIT'));
});

test('reconcileWhatsAppChannelIntegrity deactivates active WhatsApp channels that lack an eligible assistant and disables integrations', async () => {
  const queries = [];
  const database = {
    async query(sql, params) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows: [], rowCount: 1 };
    },
  };

  await reconcileWhatsAppChannelIntegrity({ database, tenantId: 'tenant-test-123' });

  assert.equal(queries.length, 2);
  assert.ok(queries[0].sql.includes("UPDATE tenant_channels tc SET status = 'inactive'"));
  assert.ok(queries[0].sql.includes("tc.channel_type = 'WHATSAPP' AND tc.status = 'active'"));
  assert.ok(queries[0].sql.includes("lower(aa.status) = 'active'"));
  assert.deepEqual(queries[0].params, ['tenant-test-123']);

  assert.ok(queries[1].sql.includes("UPDATE channel_integrations ci SET enabled = FALSE"));
  assert.ok(queries[1].sql.includes("integration_type = 'WHATSAPP'"));
  assert.deepEqual(queries[1].params, ['tenant-test-123']);
});

test('reconcileWhatsAppChannelIntegrity safely handles missing tenantId or database', async () => {
  await reconcileWhatsAppChannelIntegrity({ database: null, tenantId: 'tenant-1' });
  await reconcileWhatsAppChannelIntegrity({ database: { query() {} }, tenantId: null });
});
