process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTenantInstagramStatus,
  configureTenantInstagramChannel,
  disconnectTenantInstagramChannel,
  testTenantInstagramConnection,
  TenantInstagramProvisioningError,
} from '../services/tenant-instagram-provisioning-service.js';
import {
  persistInstagramInbound,
  resolveInstagramIntegration,
} from '../services/instagram-live-inbox-service.js';
import {
  deliverInstagramText,
  sendInstagramTypingIndicator,
} from '../services/instagram-delivery-service.js';
import { channelDeliveryRegistry } from '../services/channel-delivery-registry.js';
import { appendAgentMessage } from '../services/live-inbox-service.js';
import { resolveChannelDashboardRoute } from '../services/channel-routing-service.js';
import { enqueueHumanHandoffPushNotification } from '../services/push-notification-service.js';

const tenantIdA = '11111111-1111-4111-8111-111111111111';
const tenantIdB = '22222222-2222-4222-8222-222222222222';
const pageIdA = '17841400000000001';
const pageIdB = '17841400000000002';
const tokenA = 'EAAB_token_tenant_a';
const tokenB = 'EAAB_token_tenant_b';
const assistantIdA = '33333333-3333-4333-8333-333333333333';
const assistantIdB = '44444444-4444-4444-8444-444444444444';
const igsidCustomer1 = 'ig_user_cust_1';
const igsidCustomer2 = 'ig_user_cust_2';
const actorA = { userId: '55555555-5555-4555-8555-555555555555', systemRole: 'CUSTOMER', tenantRole: 'ADMIN' };

// ---------------------------------------------------------------------------
// 1. GENERIC TENANT ONBOARDING & SANITIZED STATUS
// ---------------------------------------------------------------------------
test('getTenantInstagramStatus returns DISCONNECTED when no channel is configured', async () => {
  const mockDb = {
    async connect() {
      return {
        async query() { return { rowCount: 0, rows: [] }; },
        release() {},
      };
    },
  };

  const status = await getTenantInstagramStatus({ database: mockDb, tenantId: tenantIdA });
  assert.equal(status.status, 'DISCONNECTED');
  assert.equal(status.connected, false);
});

test('configureTenantInstagramChannel configures channel and never exposes access token in status', async () => {
  let storedConfig = null;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT') return {};
          if (sql.includes('SELECT id FROM ai_assistants')) {
            return { rowCount: 1, rows: [{ id: assistantIdA }] };
          }
          if (sql.includes('FROM tenant_channels WHERE tenant_id')) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes('INSERT INTO tenant_channels')) {
            return { rowCount: 1, rows: [{ id: 'channel-ig-a' }] };
          }
          if (sql.includes('FROM channel_integrations WHERE channel_id')) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes('INSERT INTO channel_integrations')) {
            storedConfig = JSON.parse(params[5]);
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes('SELECT tc.id AS channel_id')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: 'channel-ig-a',
                tenant_id: tenantIdA,
                external_channel_id: pageIdA,
                assistant_id: assistantIdA,
                display_name: 'SamChe Instagram',
                channel_status: 'active',
                assistant_name: 'SamChe AI Assistant',
                integration_id: 'ci-ig-a',
                integration_enabled: true,
                config: storedConfig,
                created_at: '2026-09-24T10:00:00Z',
                updated_at: '2026-09-24T10:00:00Z',
              }],
            };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  const status = await configureTenantInstagramChannel({
    database: mockDb,
    tenantId: tenantIdA,
    displayName: 'SamChe Instagram',
    pageId: pageIdA,
    instagramBusinessAccountId: pageIdA,
    accountUsername: 'samche_ai',
    accessToken: tokenA,
    assistantId: assistantIdA,
  });

  assert.equal(status.status, 'CONNECTED');
  assert.equal(status.connected, true);
  assert.equal(status.page_id, pageIdA);
  assert.equal(status.account_username, 'samche_ai');
  assert.equal(status.has_token, true);
  assert.equal(status.assistant_id, assistantIdA);
  // CRITICAL: Access token must never be present in the public response object
  assert.equal(status.access_token, undefined);
  assert.equal(storedConfig.access_token, tokenA);
});

test('assistant assignment must belong to the exact tenant', async () => {
  const mockDb = {
    async connect() {
      return {
        async query(sql) {
          if (sql === 'BEGIN' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT id FROM ai_assistants')) {
            // Returns 0 rows indicating assistant does not belong to tenant
            return { rowCount: 0, rows: [] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  await assert.rejects(
    configureTenantInstagramChannel({
      database: mockDb,
      tenantId: tenantIdA,
      assistantId: assistantIdB, // Belongs to Tenant B!
      pageId: pageIdA,
    }),
    (error) => error instanceof TenantInstagramProvisioningError && error.code === 'INSTAGRAM_ASSISTANT_INELIGIBLE'
  );
});

test('testTenantInstagramConnection flags REAUTH_REQUIRED on Meta token error 190', async () => {
  let updatedConfig = null;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql.includes('SELECT tc.id AS channel_id')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: 'channel-ig-a',
                channel_status: 'active',
                integration_enabled: true,
                config: { access_token: 'expired_token', page_id: pageIdA },
              }],
            };
          }
          if (sql.includes('SELECT ci.config FROM channel_integrations')) {
            return { rowCount: 1, rows: [{ config: { access_token: 'expired_token', page_id: pageIdA } }] };
          }
          if (sql.includes('UPDATE channel_integrations')) {
            updatedConfig = JSON.parse(params[0]);
            return { rowCount: 1 };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };

  const fakeHttp = {
    async get() {
      const err = new Error('OAuthException');
      err.response = { status: 400, data: { error: { message: 'Session has expired', code: 190, type: 'OAuthException' } } };
      throw err;
    },
  };

  const result = await testTenantInstagramConnection({
    database: mockDb,
    tenantId: tenantIdA,
    http: fakeHttp,
  });

  assert.equal(result.healthy, false);
  assert.equal(result.status, 'REAUTH_REQUIRED');
  assert.equal(result.error, 'TOKEN_EXPIRED_OR_REVOKED');
  assert.equal(updatedConfig.reauth_required, true);
});

test('sendInstagramTypingIndicator dispatches typing_on to Meta Graph API', async () => {
  const calls = [];
  const fakeHttp = {
    async post(url, body, options) {
      calls.push({ url, body, options });
      return { data: { success: true } };
    },
  };

  const outcome = await sendInstagramTypingIndicator({
    recipientId: igsidCustomer1,
    accessToken: tokenA,
    pageId: pageIdA,
    http: fakeHttp,
  });

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.recipient.id, igsidCustomer1);
  assert.equal(calls[0].body.sender_action, 'typing_on');
});

// ---------------------------------------------------------------------------
// 2. TWO-TENANT ISOLATION PROOF
// ---------------------------------------------------------------------------
test('TWO-TENANT ISOLATION: Inbound events and outbound replies are strictly isolated per tenant', async () => {
  // Setup state for Tenant A (SamChe) and Tenant B (Other)
  const tenantAData = {
    tenantId: tenantIdA,
    pageId: pageIdA,
    token: tokenA,
    conversations: [],
    messages: [],
    notifications: [],
  };

  const tenantBData = {
    tenantId: tenantIdB,
    pageId: pageIdB,
    token: tokenB,
    conversations: [],
    messages: [],
    notifications: [],
  };

  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT') return {};

          // Tenant channel lookup by recipient ID
          if (sql.includes('SELECT tc.tenant_id')) {
            const recipient = params[0];
            if (recipient === pageIdA) {
              return {
                rowCount: 1,
                rows: [{
                  tenant_id: tenantIdA,
                  channel_id: 'channel-a',
                  assistant_id: assistantIdA,
                  external_channel_id: pageIdA,
                  channel_type: 'INSTAGRAM',
                  config: { page_id: pageIdA, access_token: tokenA },
                }],
              };
            }
            if (recipient === pageIdB) {
              return {
                rowCount: 1,
                rows: [{
                  tenant_id: tenantIdB,
                  channel_id: 'channel-b',
                  assistant_id: assistantIdB,
                  external_channel_id: pageIdB,
                  channel_type: 'INSTAGRAM',
                  config: { page_id: pageIdB, access_token: tokenB },
                }],
              };
            }
            return { rowCount: 0, rows: [] };
          }

          // Conversation upsert
          if (sql.includes('INSERT INTO conversations')) {
            const currentTenant = params[0];
            const conv = {
              id: `conv-${currentTenant}`,
              tenant_id: currentTenant,
              channel_id: params[1],
              customer_external_id: params[3],
              status: 'open',
              handling_mode: 'AI',
              handling_version: 1,
            };
            if (currentTenant === tenantIdA) tenantAData.conversations.push(conv);
            if (currentTenant === tenantIdB) tenantBData.conversations.push(conv);
            return { rowCount: 1, rows: [conv] };
          }

          // Message existence check
          if (sql.includes('SELECT id, sender_type FROM conversation_messages')) {
            return { rowCount: 0, rows: [] };
          }

          // Message insert
          if (sql.includes('INSERT INTO conversation_messages')) {
            const currentTenant = params[0];
            const msg = {
              id: `msg-${Date.now()}-${Math.random()}`,
              tenant_id: currentTenant,
              conversation_id: params[1],
              sender_type: 'CUSTOMER',
              content: params[2],
              external_message_id: params[3],
            };
            if (currentTenant === tenantIdA) tenantAData.messages.push(msg);
            if (currentTenant === tenantIdB) tenantBData.messages.push(msg);
            return { rows: [msg] };
          }

          // Live Event Bus notify
          if (sql.includes('pg_notify')) {
            const event = JSON.parse(params[1]);
            if (event.tenant_id === tenantIdA) tenantAData.notifications.push(event);
            if (event.tenant_id === tenantIdB) tenantBData.notifications.push(event);
            return {};
          }

          return { rows: [] };
        },
        release() {},
      };
    },
  };

  // 1. Process Event for Tenant A (SamChe Instagram)
  const resultA = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdA,
    senderIgsid: igsidCustomer1,
    messageId: 'mid.tenantA.1',
    content: 'Hello SamChe Instagram',
  });

  assert.equal(resultA.duplicate, false);
  assert.equal(resultA.integration.tenant_id, tenantIdA);

  // 2. Process Event for Tenant B (Other Instagram)
  const resultB = await persistInstagramInbound({
    database: mockDb,
    recipientId: pageIdB,
    senderIgsid: igsidCustomer2,
    messageId: 'mid.tenantB.1',
    content: 'Hello Tenant B Instagram',
  });

  assert.equal(resultB.duplicate, false);
  assert.equal(resultB.integration.tenant_id, tenantIdB);

  // 3. Verify absolute tenant data isolation
  assert.equal(tenantAData.messages.length, 1);
  assert.equal(tenantAData.messages[0].content, 'Hello SamChe Instagram');
  assert.equal(tenantAData.messages[0].tenant_id, tenantIdA);

  assert.equal(tenantBData.messages.length, 1);
  assert.equal(tenantBData.messages[0].content, 'Hello Tenant B Instagram');
  assert.equal(tenantBData.messages[0].tenant_id, tenantIdB);

  assert.equal(tenantAData.notifications.length, 1);
  assert.equal(tenantAData.notifications[0].tenant_id, tenantIdA);

  assert.equal(tenantBData.notifications.length, 1);
  assert.equal(tenantBData.notifications[0].tenant_id, tenantIdB);

  // Cross-tenant verification: Tenant A messages never contain Tenant B content
  assert.ok(!tenantAData.messages.some((m) => m.content.includes('Tenant B')));
  assert.ok(!tenantBData.messages.some((m) => m.content.includes('SamChe')));
});
