import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-key-for-jwt-signing';

const { default: tenantRoutes } = await import('../routes/tenantRoutes.js');
const { default: dashboardRoutes } = await import('../routes/dashboardRoutes.js');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ASSISTANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ASSISTANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHANNEL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function createMockApp({ queryHandler }) {
  const app = express();
  app.use(express.json());

  const mockDb = {
    async query(sql, params) {
      return queryHandler({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
    },
    async connect() {
      return {
        query: mockDb.query,
        release() {},
      };
    },
  };

  app.locals.database = mockDb;
  app.locals.query = mockDb.query;

  app.use('/api/v1/tenants', tenantRoutes);
  app.use('/api/v1/tenants', dashboardRoutes);

  return { app, mockDb };
}

async function withServer({ queryHandler }, run) {
  const { app } = createMockApp({ queryHandler });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1/tenants`;

  try {
    await run({ baseUrl });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function tokenFor({ userId, systemRole = 'CUSTOMER', tenantId = TENANT_A, tenantRole = 'OWNER' }) {
  return jwt.sign(
    {
      user_id: userId,
      system_role: systemRole,
      tenants: [{ tenant_id: tenantId, tenant_role: tenantRole }],
    },
    process.env.JWT_SECRET
  );
}

test('GET /:tenantId/assistants returns tenant_id and status for canonical assistant eligibility', async () => {
  await withServer({
    queryHandler: ({ sql, params }) => {
      if (sql.includes('FROM tenant_users')) {
        return { rows: [{ tenant_role: 'OWNER' }], rowCount: 1 };
      }
      if (sql.includes('FROM ai_assistants') && sql.includes('WHERE tenant_id = $1')) {
        assert.equal(params[0], TENANT_A);
        return {
          rows: [
            {
              id: ASSISTANT_A,
              tenant_id: TENANT_A,
              name: 'Yesil Vadi',
              model: 'gpt-4o-mini',
              status: 'active',
              active_configuration_version_id: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }, async ({ baseUrl }) => {
    const token = tokenFor({ userId: 'user-1', tenantId: TENANT_A });
    const res = await fetch(`${baseUrl}/${TENANT_A}/assistants`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();

test('POST /:tenantId/channels blocks active WhatsApp channel creation without eligible assistant', async () => {
  await withServer({
    queryHandler: ({ sql }) => {
      if (sql.includes('FROM tenant_users')) return { rows: [{ tenant_role: 'ADMIN' }], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }, async ({ baseUrl }) => {
    const token = tokenFor({ userId: 'user-1', tenantId: TENANT_A });
    const res = await fetch(`${baseUrl}/${TENANT_A}/channels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_type: 'WHATSAPP',
        display_name: 'WhatsApp Channel',
        external_channel_id: '948536645017374',
        assistant_id: null,
        status: 'active',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'WHATSAPP_ASSISTANT_REQUIRED');
  });
});

test('PUT /:tenantId/channels/:channelId blocks active WhatsApp channel update without eligible assistant', async () => {
  await withServer({
    queryHandler: ({ sql }) => {
      if (sql.includes('FROM tenant_users')) return { rows: [{ tenant_role: 'ADMIN' }], rowCount: 1 };
      if (sql.includes('SELECT channel_type FROM tenant_channels')) return { rows: [{ channel_type: 'WHATSAPP' }], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }, async ({ baseUrl }) => {
    const token = tokenFor({ userId: 'user-1', tenantId: TENANT_A });
    const res = await fetch(`${baseUrl}/${TENANT_A}/channels/${CHANNEL_ID}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_type: 'WHATSAPP',
        display_name: 'WhatsApp Channel',
        external_channel_id: '948536645017374',
        assistant_id: null,
        status: 'active',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'WHATSAPP_ASSISTANT_REQUIRED');
  });
});

test('WhatsApp channel rejects wrong-tenant assistant assignment (fails closed)', async () => {
  await withServer({
    queryHandler: ({ sql, params }) => {
      if (sql.includes('FROM tenant_users')) return { rows: [{ tenant_role: 'ADMIN' }], rowCount: 1 };
      if (sql.includes('FROM ai_assistants') && sql.includes("lower(status)='active'")) {
        assert.equal(params[0], ASSISTANT_B);
        assert.equal(params[1], TENANT_A);
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }, async ({ baseUrl }) => {
    const token = tokenFor({ userId: 'user-1', tenantId: TENANT_A });
    const res = await fetch(`${baseUrl}/${TENANT_A}/channels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_type: 'WHATSAPP',
        display_name: 'WhatsApp Channel',
        external_channel_id: '948536645017374',
        assistant_id: ASSISTANT_B,
        status: 'active',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Assistant must be active and belong to this tenant');
  });
});

test('GET /:tenantId/channels triggers reconciliation ensuring active WhatsApp channel cannot remain active without assistant', async () => {
  const executed = [];
  await withServer({
    queryHandler: ({ sql }) => {
      executed.push(sql);
      if (sql.includes('FROM tenant_users')) return { rows: [{ tenant_role: 'OWNER' }], rowCount: 1 };
      if (sql.includes('FROM ai_assistants') && sql.includes("status = 'active'")) return { rows: [], rowCount: 0 };
      if (sql.includes('UPDATE tenant_channels tc SET status = \'inactive\'')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE channel_integrations ci SET enabled = FALSE')) return { rows: [], rowCount: 1 };
      if (sql.includes('FROM tenant_channels WHERE tenant_id=$1')) {
        return {
          rows: [
            {
              id: CHANNEL_ID,
              tenant_id: TENANT_A,
              assistant_id: null,
              channel_type: 'WHATSAPP',
              display_name: 'WhatsApp',
              external_channel_id: '948536645017374',
              status: 'inactive',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }, async ({ baseUrl }) => {
    const token = tokenFor({ userId: 'user-1', tenantId: TENANT_A });
    const res = await fetch(`${baseUrl}/${TENANT_A}/channels`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].status, 'inactive');
    assert.ok(executed.some((s) => s.includes("UPDATE tenant_channels tc SET status = 'inactive'")));
  });
});

    assert.equal(body.length, 1);
    assert.equal(body[0].id, ASSISTANT_A);
    assert.equal(body[0].tenant_id, TENANT_A);
    assert.equal(body[0].name, 'Yesil Vadi');
    assert.equal(body[0].status, 'active');
  });
});
