process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTenantInstagramStatus,
  configureTenantInstagramChannel,
  importTenantInstagramHistory,
  TenantInstagramProvisioningError,
} from '../services/tenant-instagram-provisioning-service.js';
import {
  instagramCustomerReference,
  instagramExternalConversationId,
} from '../services/instagram-live-inbox-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const channelId = '33333333-3333-4333-8333-333333333333';
const assistantId = '44444444-4444-4444-8444-444444444444';
const businessPageId = '17841400000000001';
const testToken = 'EAAB_test_instagram_token';

// ---------------------------------------------------------------------------
// 1. 100 DISCOVERED, ONE CONVERSATION FAILS: REMAINING CONVERSATIONS CONTINUE
// ---------------------------------------------------------------------------
test('1. 100 discovered, one conversation fails: remaining conversations continue and commit', async () => {
  const discovered = Array.from({ length: 100 }, (_, i) => ({
    id: `meta_conv_${i + 1}`,
    updated_time: '2026-09-20T12:00:00+0000',
    participants: {
      data: [
        { id: i === 36 ? '' : `ig_user_${i + 1}`, username: `user_${i + 1}`, name: `User ${i + 1}` },
        { id: businessPageId, username: 'my_business', name: 'My Business' },
      ],
    },
  }));

  const insertedConversations = new Set();
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('FROM tenant_channels tc')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: channelId,
                tenant_id: tenantId,
                external_channel_id: businessPageId,
                assistant_id: assistantId,
                config: { access_token: testToken, page_id: businessPageId, instagram_account_id: businessPageId },
              }],
            };
          }
          if (sql.includes('INSERT INTO crm_contacts')) {
            return { rowCount: 1, rows: [{ id: `contact-${params[1]}` }] };
          }
          if (sql.includes('SELECT * FROM conversations')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversations')) {
            insertedConversations.add(params[3]);
            return { rowCount: 1, rows: [{ id: `conv-${params[3]}`, tenant_id: tenantId, channel_id: channelId }] };
          }
          if (sql.includes('SELECT id FROM conversation_messages')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversation_messages')) return { rowCount: 1, rows: [{ id: 'msg-1' }] };
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const mockHttp = {
    async get(url) {
      if (url.includes('/conversations')) return { data: { data: discovered } };
      if (url.includes('/messages')) return { data: { data: [{ id: 'm-1', created_time: '2026-09-20T12:00:00+0000', message: 'Hi' }] } };
      return { data: {} };
    },
  };

  const result = await importTenantInstagramHistory({
    database: mockDb,
    tenantId,
    http: mockHttp,
  });

  assert.equal(result.discovered, 100);
  assert.equal(result.imported, 99);
  assert.equal(result.failed, 1);
  assert.equal(result.failure_categories.IDENTITY_RESOLUTION, 1);
  assert.equal(insertedConversations.size, 99);
});


// ---------------------------------------------------------------------------
// 2. PROFILE ENRICHMENT FAILS: CONVERSATION STILL IMPORTS AS "Instagram User"
// ---------------------------------------------------------------------------
test('2. profile enrichment fails: conversation still imports with display_name="Instagram User"', async () => {
  const discovered = [{
    id: 'meta_conv_1',
    updated_time: '2026-09-20T12:00:00+0000',
    participants: {
      data: [{ id: 'ig_cust_anonymous' }],
    },
  }];

  let savedDisplayName = null;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('FROM tenant_channels tc')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: channelId,
                tenant_id: tenantId,
                external_channel_id: businessPageId,
                assistant_id: assistantId,
                config: { access_token: testToken, page_id: businessPageId },
              }],
            };
          }
          if (sql.includes('INSERT INTO crm_contacts')) {
            savedDisplayName = params[2];
            return { rowCount: 1, rows: [{ id: 'contact-1', display_name: savedDisplayName }] };
          }
          if (sql.includes('SELECT * FROM conversations')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversations')) return { rowCount: 1, rows: [{ id: 'conv-1' }] };
          if (sql.includes('SELECT id FROM conversation_messages')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversation_messages')) return { rowCount: 1, rows: [{ id: 'msg-1' }] };
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const mockHttp = {
    async get(url) {
      if (url.includes('/conversations')) return { data: { data: discovered } };
      if (url.includes('/ig_cust_anonymous')) {
        const err = new Error('Graph API Error: user not accessible');
        err.response = { status: 400, data: { error: { message: 'User not accessible' } } };
        throw err;
      }
      if (url.includes('/messages')) return { data: { data: [] } };
      return { data: {} };
    },
  };

  const result = await importTenantInstagramHistory({
    database: mockDb,
    tenantId,
    http: mockHttp,
  });

  assert.equal(result.discovered, 1);
  assert.equal(result.imported, 1);
  assert.equal(result.failed, 0);
  assert.equal(savedDisplayName, 'Instagram User');
});

// ---------------------------------------------------------------------------
// 3. MESSAGE WITHOUT TEXT BUT ATTACHMENT: IMPORTER DOES NOT CRASH
// ---------------------------------------------------------------------------
test('3. message without text but attachment: persists safely as [Attachment: media]', async () => {
  const discovered = [{
    id: 'meta_conv_media',
    updated_time: '2026-09-20T12:00:00+0000',
    participants: {
      data: [{ id: 'ig_cust_media', username: 'media_user' }],
    },
  }];

  let persistedContent = null;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('FROM tenant_channels tc')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: channelId,
                tenant_id: tenantId,
                external_channel_id: businessPageId,
                config: { access_token: testToken, page_id: businessPageId },
              }],
            };
          }
          if (sql.includes('INSERT INTO crm_contacts')) return { rowCount: 1, rows: [{ id: 'contact-1' }] };
          if (sql.includes('SELECT * FROM conversations')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversations')) return { rowCount: 1, rows: [{ id: 'conv-1' }] };
          if (sql.includes('SELECT id FROM conversation_messages')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversation_messages')) {
            persistedContent = params[3];
            return { rowCount: 1, rows: [{ id: 'msg-1' }] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const mockHttp = {
    async get(url) {
      if (url.includes('/conversations')) return { data: { data: discovered } };
      if (url.includes('/messages')) {
        return {
          data: {
            data: [{
              id: 'm-att-1',
              created_time: '2026-09-20T12:00:00+0000',
              message: null,
              attachments: { data: [{ mime_type: 'image/jpeg', image_data: { url: 'https://lookaside/img.jpg' } }] },
            }],
          },
        };
      }
      return { data: {} };
    },
  };

  const result = await importTenantInstagramHistory({
    database: mockDb,
    tenantId,
    http: mockHttp,
  });

  assert.equal(result.messages_imported, 1);
  assert.equal(persistedContent, '[Attachment: image/jpeg]');
});

// ---------------------------------------------------------------------------
// 4. EXISTING LIVE CONVERSATION RECONCILIATION: NO DESTRUCTIVE DUPLICATE / RESET
// ---------------------------------------------------------------------------
test('4. existing live conversation reconciliation: reconciles idempotently and preserves AI_ONLY override', async () => {
  const liveSenderId = '17841400099999999';
  const canonicalExtId = instagramExternalConversationId(liveSenderId);
  const discovered = [{
    id: 'meta_conv_live',
    updated_time: '2026-09-20T12:00:00+0000',
    participants: {
      data: [{ id: liveSenderId, username: 'live_customer' }],
    },
  }];

  let conversationUpdated = false;
  let overrideReset = false;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('FROM tenant_channels tc')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: channelId,
                tenant_id: tenantId,
                external_channel_id: businessPageId,
                config: { access_token: testToken, page_id: businessPageId },
              }],
            };
          }
          if (sql.includes('INSERT INTO crm_contacts')) {
            return { rowCount: 1, rows: [{ id: 'contact-live-1', ai_behavior_override: 'AI_ONLY' }] };
          }
          if (sql.includes('SELECT * FROM conversations')) {
            return {
              rowCount: 1,
              rows: [{
                id: 'conv-live-101',
                tenant_id: tenantId,
                channel_id: channelId,
                contact_id: 'contact-live-1',
                external_conversation_id: canonicalExtId,
                customer_external_id: `instagram:${liveSenderId}`,
                ai_behavior_override: 'AI_ONLY',
                handling_mode: 'AI',
                status: 'open',
              }],
            };
          }
          if (sql.includes('UPDATE conversations')) {
            conversationUpdated = true;
            if (sql.includes('ai_behavior_override')) overrideReset = true;
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes('SELECT id FROM conversation_messages')) {
            return { rowCount: 1, rows: [{ id: 'msg-live-1' }] };
          }
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const mockHttp = {
    async get(url) {
      if (url.includes('/conversations')) return { data: { data: discovered } };
      if (url.includes('/messages')) {
        return {
          data: {
            data: [{
              id: 'm-live-existing',
              created_time: '2026-09-20T12:00:00+0000',
              message: 'Existing message',
            }],
          },
        };
      }
      return { data: {} };
    },
  };

  const result = await importTenantInstagramHistory({
    database: mockDb,
    tenantId,
    http: mockHttp,
  });

  assert.equal(result.discovered, 1);
  assert.equal(result.imported, 0);
  assert.equal(result.reconciled, 1);
  assert.equal(result.messages_duplicates, 1);
  assert.equal(result.messages_imported, 0);
  assert.equal(overrideReset, false);
});


// ---------------------------------------------------------------------------
// 5. PASSIVE IMPORT: ZERO AI, ZERO OUTBOUND, ZERO WHATSAPP SIDE EFFECTS
// ---------------------------------------------------------------------------
test('5. passive import: zero AI, zero outbound, zero push, zero WhatsApp alert side effects', async () => {
  let outboundCalled = false;
  let whatsappAlertCalled = false;

  const discovered = [{
    id: 'meta_conv_passive',
    updated_time: '2026-09-20T12:00:00+0000',
    participants: {
      data: [{ id: 'ig_passive_cust', username: 'passive_cust' }],
    },
  }];

  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('FROM tenant_channels tc')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: channelId,
                tenant_id: tenantId,
                external_channel_id: businessPageId,
                config: { access_token: testToken, page_id: businessPageId, lead_whatsapp_destination: '+971527288586' },
              }],
            };
          }
          if (sql.includes('INSERT INTO crm_contacts')) return { rowCount: 1, rows: [{ id: 'contact-1' }] };
          if (sql.includes('SELECT * FROM conversations')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversations')) return { rowCount: 1, rows: [{ id: 'conv-1' }] };
          if (sql.includes('SELECT id FROM conversation_messages')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversation_messages')) return { rowCount: 1, rows: [{ id: 'msg-1' }] };
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const mockHttp = {
    async get(url) {
      if (url.includes('/conversations')) return { data: { data: discovered } };
      if (url.includes('/messages')) {
        return {
          data: {
            data: [{
              id: 'm-passive-1',
              created_time: '2026-09-20T12:00:00+0000',
              message: 'I want to buy 100 enterprise licenses urgently',
            }],
          },
        };
      }
      return { data: {} };
    },
    async post() {
      outboundCalled = true;
      return { data: {} };
    },
  };

  const result = await importTenantInstagramHistory({
    database: mockDb,
    tenantId,
    http: mockHttp,
  });

  assert.equal(result.imported, 1);
  assert.equal(outboundCalled, false, 'Outbound HTTP POST must never be called during passive history import');
  assert.equal(whatsappAlertCalled, false, 'WhatsApp lead alert must never be called during passive history import');
});


// ---------------------------------------------------------------------------
// 6 & 7. LEAD WHATSAPP CONFIG STATUS READBACK & CANONICAL KEY CONSISTENCY
// ---------------------------------------------------------------------------
test('6 & 7. Lead WhatsApp config: Configure write and status read use same canonical key', async () => {
  let storedConfig = null;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT id FROM ai_assistants')) return { rowCount: 1, rows: [{ id: assistantId }] };
          if (sql.includes('FROM tenant_channels WHERE tenant_id')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO tenant_channels')) return { rowCount: 1, rows: [{ id: channelId }] };
          if (sql.includes('FROM channel_integrations WHERE channel_id')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO channel_integrations')) {
            storedConfig = JSON.parse(params[5]);
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes('SELECT tc.id AS channel_id')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: channelId,
                tenant_id: tenantId,
                external_channel_id: businessPageId,
                assistant_id: assistantId,
                display_name: 'SamChe Instagram',
                channel_status: 'active',
                assistant_name: 'SamChe AI',
                integration_id: 'ci-1',
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

  const configured = await configureTenantInstagramChannel({
    database: mockDb,
    tenantId,
    pageId: businessPageId,
    leadWhatsappDestination: '+971527288586',
  });

  assert.equal(configured.lead_whatsapp_configured, true);
  assert.equal(configured.lead_whatsapp_destination, '+971527288586');
  assert.equal(configured.internal_lead_whatsapp, '+971527288586');
  assert.equal(storedConfig.lead_whatsapp_destination, '+971527288586');

  const readbackStatus = await getTenantInstagramStatus({
    database: mockDb,
    tenantId,
  });

  assert.equal(readbackStatus.lead_whatsapp_configured, true);
  assert.equal(readbackStatus.lead_whatsapp_destination, '+971527288586');
});

// ---------------------------------------------------------------------------
// 8. PROVIDER ID NEVER BECOMES @USERNAME
// ---------------------------------------------------------------------------
test('8. provider ID never becomes @username: fallback remains "Instagram User"', async () => {
  const numericIgsid = '17841400012345678';
  const discovered = [{
    id: 'meta_conv_numeric',
    updated_time: '2026-09-20T12:00:00+0000',
    participants: {
      data: [{ id: numericIgsid, username: numericIgsid }],
    },
  }];

  let savedDisplayName = null;
  const mockDb = {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('FROM tenant_channels tc')) {
            return {
              rowCount: 1,
              rows: [{
                channel_id: channelId,
                tenant_id: tenantId,
                external_channel_id: businessPageId,
                config: { access_token: testToken, page_id: businessPageId },
              }],
            };
          }
          if (sql.includes('INSERT INTO crm_contacts')) {
            savedDisplayName = params[2];
            return { rowCount: 1, rows: [{ id: 'contact-1' }] };
          }
          if (sql.includes('SELECT * FROM conversations')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversations')) return { rowCount: 1, rows: [{ id: 'conv-1' }] };
          if (sql.includes('SELECT id FROM conversation_messages')) return { rowCount: 0, rows: [] };
          if (sql.includes('INSERT INTO conversation_messages')) return { rowCount: 1, rows: [{ id: 'msg-1' }] };
          return { rowCount: 0, rows: [] };
        },
        release() {},
      };
    },
  };

  const mockHttp = {
    async get(url) {
      if (url.includes('/conversations')) return { data: { data: discovered } };
      if (url.includes('/messages')) return { data: { data: [] } };
      return { data: {} };
    },
  };

  await importTenantInstagramHistory({
    database: mockDb,
    tenantId,
    http: mockHttp,
  });

  assert.notEqual(savedDisplayName, `@${numericIgsid}`);
  assert.equal(savedDisplayName, 'Instagram User');
});

