import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-only-whatsapp-transfer-secret';

const { default: dashboardRoutes } = await import('../routes/dashboardRoutes.js');

const TARGET_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const SOURCE_TENANT_ID = '00000000-0000-4000-8000-000000000020';
const SOURCE_CHANNEL_ID = '00000000-0000-4000-8000-000000000003';
const TARGET_ASSISTANT_ID = '00000000-0000-4000-8000-000000000004';
const EXTERNAL_PHONE_ID = '948536645017374';

function createMockDatabase(handler) {
  const executedQueries = [];
  const client = {
    async query(sql, params) {
      executedQueries.push({ sql: String(sql).trim(), params });
      return handler({ sql: String(sql).trim(), params });
    },
    release() {},
  };
  return {
    executedQueries,
    async connect() {
      return client;
    },
    async query(sql, params) {
      executedQueries.push({ sql: String(sql).trim(), params });
      return handler({ sql: String(sql).trim(), params });
    },
  };
}

async function withTestServer(options = {}, callback) {
  const app = express();
  app.use(express.json());
  if (options.database) {
    app.locals.database = options.database;
  }
  if (options.query) {
    app.locals.query = options.query;
  }
  app.use('/api/v1/tenants', dashboardRoutes);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1/tenants`;
    await callback({ baseUrl });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Tenant A OWNER cannot transfer Tenant B channel', async () => {
  await withTestServer({}, async ({ baseUrl }) => {
    // Tenant A owner user: in customer workspace, has system_role CUSTOMER with tenant owner role/status
    const token = jwt.sign(
      {
        user_id: '00000000-0000-4000-8000-000000000001',
        system_role: 'CUSTOMER',
        role: 'OWNER',
        tenant_role: 'OWNER',
        tenant_id: TARGET_TENANT_ID,
      },
      process.env.JWT_SECRET
    );

    const response = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'OWNER access required' });
  });
});

test('Tenant A ADMIN cannot transfer Tenant B channel', async () => {
  await withTestServer({}, async ({ baseUrl }) => {
    // Tenant A admin: system_role CUSTOMER, tenant_role ADMIN
    const token = jwt.sign(
      {
        user_id: '00000000-0000-4000-8000-000000000005',
        system_role: 'CUSTOMER',
        tenant_role: 'ADMIN',
        tenant_id: TARGET_TENANT_ID,
      },
      process.env.JWT_SECRET
    );

    const response = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'OWNER access required' });
  });
});

test('Tenant A MEMBER cannot transfer Tenant B channel', async () => {
  await withTestServer({}, async ({ baseUrl }) => {
    // Tenant A member/agent: system_role CUSTOMER, tenant_role AGENT
    const token = jwt.sign(
      {
        user_id: '00000000-0000-4000-8000-000000000006',
        system_role: 'CUSTOMER',
        tenant_role: 'AGENT',
        role: 'MEMBER',
        tenant_id: TARGET_TENANT_ID,
      },
      process.env.JWT_SECRET
    );

    const response = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'OWNER access required' });
  });
});

test('canonical platform-level admin CAN transfer with explicit confirmation', async () => {
  const mockDb = createMockDatabase(({ sql }) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('SELECT id FROM tenants WHERE id = $1')) {
      return { rows: [{ id: TARGET_TENANT_ID }], rowCount: 1 };
    }
    if (sql.includes('FROM tenant_channels') && sql.includes("status = 'active'") && sql.includes('FOR UPDATE')) {
      return {
        rows: [{
          id: SOURCE_CHANNEL_ID,
          tenant_id: SOURCE_TENANT_ID,
          display_name: 'Tenant B WhatsApp',
          assistant_id: '00000000-0000-4000-8000-000000000099',
          external_channel_id: EXTERNAL_PHONE_ID,
          status: 'active',
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM tenants') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: TARGET_TENANT_ID, status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM ai_assistants')) {
      return { rows: [{ id: TARGET_ASSISTANT_ID, tenant_id: TARGET_TENANT_ID, status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM tenant_channels') && sql.includes("status = 'inactive'")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('UPDATE tenant_channels') && sql.includes("SET status = 'inactive'")) {
      return { rows: [{ id: SOURCE_CHANNEL_ID }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE channel_integrations')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO tenant_channels')) {
      return {
        rows: [{
          id: '00000000-0000-4000-8000-000000000007',
          tenant_id: TARGET_TENANT_ID,
          assistant_id: TARGET_ASSISTANT_ID,
          external_channel_id: EXTERNAL_PHONE_ID,
          status: 'active',
        }],
        rowCount: 1,
      };
    }
    if (sql.startsWith('INSERT INTO channel_integrations')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO whatsapp_channel_ownership_events')) {
      return { rows: [{ id: '00000000-0000-4000-8000-000000000088' }], rowCount: 1 };
    }
    throw new Error(`Unexpected query in test: ${sql}`);
  });

  await withTestServer({ database: mockDb, query: mockDb.query }, async ({ baseUrl }) => {
    // Canonical platform-level administrator: system_role OWNER
    const platformAdminToken = jwt.sign(
      {
        user_id: '00000000-0000-4000-8000-000000000099',
        system_role: 'OWNER',
      },
      process.env.JWT_SECRET
    );

    const response = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${platformAdminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data, {
      channel: {
        id: '00000000-0000-4000-8000-000000000007',
        tenant_id: TARGET_TENANT_ID,
        assistant_id: TARGET_ASSISTANT_ID,
        external_channel_id: EXTERNAL_PHONE_ID,
        status: 'active',
      },
      transfer: {
        source_channel_id: SOURCE_CHANNEL_ID,
        source_tenant_id: SOURCE_TENANT_ID,
        audit_event_id: '00000000-0000-4000-8000-000000000088',
        external_channel_id: EXTERNAL_PHONE_ID,
      },
    });

    assert.ok(mockDb.executedQueries.some(({ sql }) => sql === 'COMMIT'));
    assert.ok(mockDb.executedQueries.some(({ sql }) => sql.startsWith('INSERT INTO whatsapp_channel_ownership_events')));
  });
});

test('spoofed tenant/role request fails closed', async () => {
  await withTestServer({}, async ({ baseUrl }) => {
    // 1. Forged token signature
    const forgedToken = jwt.sign(
      { user_id: '00000000-0000-4000-8000-000000000099', system_role: 'OWNER' },
      'completely-fake-secret-key'
    );
    const forgedResponse = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${forgedToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );
    assert.equal(forgedResponse.status, 401);
    assert.deepEqual(await forgedResponse.json(), { error: 'Invalid or expired token' });

    // 2. Unauthenticated request (no token)
    const unauthResponse = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );
    assert.equal(unauthResponse.status, 401);
    assert.deepEqual(await unauthResponse.json(), { error: 'Authentication token required' });

    // 3. Spoofed role claims in valid JWT but lacking canonical system_role: 'OWNER'
    const spoofedClaimsToken = jwt.sign(
      {
        user_id: '00000000-0000-4000-8000-000000000001',
        role: 'OWNER',
        is_platform_admin: true,
        is_admin: true,
        permissions: ['ALL', 'TRANSFER_CHANNEL'],
      },
      process.env.JWT_SECRET
    );
    const spoofedClaimsResponse = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${spoofedClaimsToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );
    assert.equal(spoofedClaimsResponse.status, 403);
    assert.deepEqual(await spoofedClaimsResponse.json(), { error: 'OWNER access required' });
  });
});

test('transfer endpoint cannot escalate privileges through request body', async () => {
  await withTestServer({}, async ({ baseUrl }) => {
    // Ordinary customer token
    const customerToken = jwt.sign(
      { user_id: '00000000-0000-4000-8000-000000000001', system_role: 'CUSTOMER' },
      process.env.JWT_SECRET
    );

    // Request body attempts to inject platform owner privileges and spoof actor role
    const response = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_role: 'OWNER',
          role: 'OWNER',
          actorSystemRole: 'OWNER',
          actor_system_role: 'OWNER',
          actorUserId: '00000000-0000-4000-8000-000000000099',
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'OWNER access required' });
  });
});

test('historical conversations remain untouched after authorized transfer', async () => {
  const executedStatements = [];
  const mockDb = createMockDatabase(({ sql }) => {
    executedStatements.push(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    if (sql.includes('SELECT id FROM tenants WHERE id = $1')) {
      return { rows: [{ id: TARGET_TENANT_ID }], rowCount: 1 };
    }
    if (sql.includes('FROM tenant_channels') && sql.includes("status = 'active'") && sql.includes('FOR UPDATE')) {
      return {
        rows: [{
          id: SOURCE_CHANNEL_ID,
          tenant_id: SOURCE_TENANT_ID,
          display_name: 'Tenant B WhatsApp',
          assistant_id: '00000000-0000-4000-8000-000000000099',
          external_channel_id: EXTERNAL_PHONE_ID,
          status: 'active',
        }],
        rowCount: 1,
      };
    }
    if (sql.includes('FROM tenants') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: TARGET_TENANT_ID, status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM ai_assistants')) {
      return { rows: [{ id: TARGET_ASSISTANT_ID, tenant_id: TARGET_TENANT_ID, status: 'active' }], rowCount: 1 };
    }
    if (sql.includes('FROM tenant_channels') && sql.includes("status = 'inactive'")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('UPDATE tenant_channels') && sql.includes("SET status = 'inactive'")) {
      return { rows: [{ id: SOURCE_CHANNEL_ID }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE channel_integrations')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO tenant_channels')) {
      return {
        rows: [{
          id: '00000000-0000-4000-8000-000000000007',
          tenant_id: TARGET_TENANT_ID,
          assistant_id: TARGET_ASSISTANT_ID,
          external_channel_id: EXTERNAL_PHONE_ID,
          status: 'active',
        }],
        rowCount: 1,
      };
    }
    if (sql.startsWith('INSERT INTO channel_integrations')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO whatsapp_channel_ownership_events')) {
      return { rows: [{ id: '00000000-0000-4000-8000-000000000088' }], rowCount: 1 };
    }
    throw new Error(`Unexpected query in test: ${sql}`);
  });

  await withTestServer({ database: mockDb, query: mockDb.query }, async ({ baseUrl }) => {
    const platformAdminToken = jwt.sign(
      {
        user_id: '00000000-0000-4000-8000-000000000099',
        system_role: 'OWNER',
      },
      process.env.JWT_SECRET
    );

    const response = await fetch(
      `${baseUrl}/${TARGET_TENANT_ID}/channels/transfer-whatsapp`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${platformAdminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          external_channel_id: EXTERNAL_PHONE_ID,
          expected_source_channel_id: SOURCE_CHANNEL_ID,
          target_assistant_id: TARGET_ASSISTANT_ID,
          confirmation: 'TRANSFER',
        }),
      }
    );

    assert.equal(response.status, 200);

    // Verify historical conversations table was NEVER accessed, modified, or reassigned
    const conversationQueries = executedStatements.filter((stmt) => /conversations/i.test(stmt));
    assert.equal(
      conversationQueries.length,
      0,
      `Expected zero queries touching conversations table, found: ${JSON.stringify(conversationQueries)}`
    );

    // Explicitly verify no UPDATE or DELETE on conversation rows
    assert.ok(!executedStatements.some((stmt) => /UPDATE\s+conversations/i.test(stmt)));
    assert.ok(!executedStatements.some((stmt) => /DELETE\s+FROM\s+conversations/i.test(stmt)));
  });
});