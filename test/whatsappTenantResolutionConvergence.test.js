import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWhatsAppIntegration } from '../services/whatsapp-live-inbox-service.js';
import { sendWhatsAppTypingIndicator, WhatsAppDeliveryError } from '../services/whatsapp-delivery-service.js';

test('WhatsApp tenant resolution: authoritative tenant_channels overrides stale channel_integrations', async () => {
  const queries = [];
  const fakeClient = {
    async query(sql, params) {
      queries.push({ sql, params });

      // First query in resolveWhatsAppIntegration is direct check on tenant_channels
      if (sql.includes('FROM tenant_channels tc')) {
        return {
          rowCount: 1,
          rows: [
            {
              tenant_id: 'target-tenant-1111-1111-111111111111',
              channel_id: 'channel-2222-2222-222222222222',
              assistant_id: 'assistant-3333-3333-333333333333',
              channel_assistant_id: 'assistant-3333-3333-333333333333',
              channel_type: 'WHATSAPP',
              channel_status: 'active',
              assistant_status: 'active',
              tenant_name: 'Fresh Customer Corp',
              assistant_name: 'Fresh AI Assistant',
              assistant_system_prompt: 'Authoritative tenant policy.',
              assistant_whatsapp_response_templates: { first_contact: { en: 'Hello from Fresh AI' } },
            },
          ],
        };
      }

      // Upsert into channel_integrations
      if (sql.includes('INSERT INTO channel_integrations')) {
        return { rowCount: 1, rows: [{ id: 'int-1' }] };
      }

      return { rowCount: 0, rows: [] };
    },
  };

  const integration = await resolveWhatsAppIntegration(fakeClient, '948536645017374');

  assert.ok(integration, 'integration must resolve successfully');
  assert.equal(integration.tenant_id, 'target-tenant-1111-1111-111111111111');
  assert.equal(integration.tenant_name, 'Fresh Customer Corp');
  assert.notEqual(integration.tenant_name, 'Blue Dune Event Management LLC');

  // Verify that convergence upsert occurred
  const upsertQuery = queries.find((q) => q.sql.includes('INSERT INTO channel_integrations'));
  assert.ok(upsertQuery, 'channel_integrations convergence upsert must be executed');
  assert.equal(upsertQuery.params[0], 'whatsapp:948536645017374');
  assert.equal(upsertQuery.params[1], 'target-tenant-1111-1111-111111111111');
});

test('WhatsApp tenant resolution: stale integration history cannot override missing canonical ownership', async () => {
  const fakeClient = {
    async query(sql, params) {
      // Direct tenant_channels check returns 0 (e.g. historical migration record)
      if (sql.includes('FROM tenant_channels tc') && !sql.includes('channel_integrations ci')) {
        return { rowCount: 0, rows: [] };
      }

      // channel_integrations query with case-insensitive check
      if (sql.includes('FROM channel_integrations ci')) {
        return {
          rowCount: 1,
          rows: [
            {
              tenant_id: 'historical-tenant-4444',
              channel_id: 'chan-4444',
              assistant_id: 'asst-4444',
              channel_assistant_id: 'asst-4444',
              channel_type: 'WHATSAPP',
              channel_status: 'active',
              assistant_status: 'active',
              tenant_name: 'Historical Tenant LLC',
              assistant_name: 'Historical Assistant',
              assistant_system_prompt: 'Historical policy.',
              assistant_whatsapp_response_templates: null,
            },
          ],
        };
      }

      return { rowCount: 0, rows: [] };
    },
  };

  const integration = await resolveWhatsAppIntegration(fakeClient, '948536645017374');
  assert.equal(integration, null);
});

test('WhatsApp native typing indicator: supports multi-tenant phone ID without mismatch failure', async () => {
  const posted = [];
  const fakeHttpClient = {
    async post(url, payload, options) {
      posted.push({ url, payload, options });
      return { data: { success: true } };
    },
  };

  // When env.WHATSAPP_PHONE_ID is empty or different tenant number is used:
  const result = await sendWhatsAppTypingIndicator({
    phoneNumberId: '987654321098765',
    incomingMessageId: 'wamid.TEST_MULTI_TENANT_TYPING',
    env: {
      WHATSAPP_PHONE_ID: '',
      WHATSAPP_TOKEN: 'valid-tenant-token',
    },
    httpClient: fakeHttpClient,
  });

  assert.equal(result.ok, true);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'https://graph.facebook.com/v20.0/987654321098765/messages');
  assert.deepEqual(posted[0].payload, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: 'wamid.TEST_MULTI_TENANT_TYPING',
    typing_indicator: { type: 'text' },
  });
});

test('WhatsApp tenant resolution: co-existing inactive source (Blue Dune) and active target (Yeşil Vadi) resolves exclusively to Yeşil Vadi', async () => {
  const queries = [];
  const fakeClient = {
    async query(sql, params) {
      queries.push({ sql, params });

      // The query in resolveWhatsAppIntegration filters by tc.status = 'active'.
      // If the database has both Blue Dune (status = 'inactive') and Yeşil Vadi (status = 'active')
      // for the same external phone number '948536645017374', only Yeşil Vadi is returned.
      if (sql.includes('FROM tenant_channels tc')) {
        return {
          rowCount: 1,
          rows: [
            {
              tenant_id: 'yesil-vadi-tenant-id-0001',
              channel_id: 'yesil-vadi-channel-id-0001',
              assistant_id: 'yesil-vadi-assistant-id-0001',
              channel_assistant_id: 'yesil-vadi-assistant-id-0001',
              channel_type: 'WHATSAPP',
              channel_status: 'active',
              assistant_status: 'active',
              tenant_name: 'Yeşil Vadi',
              assistant_name: 'Yeşil Vadi Asistanı',
              assistant_system_prompt: 'Yeşil Vadi canonical master policy.',
              assistant_whatsapp_response_templates: { first_contact: { tr: 'Merhaba, Yeşil Vadiye hoş geldiniz.' } },
            },
          ],
        };
      }

      if (sql.includes('INSERT INTO channel_integrations')) {
        return { rowCount: 1, rows: [{ id: 'int-yesil-vadi' }] };
      }

      return { rowCount: 0, rows: [] };
    },
  };

  const integration = await resolveWhatsAppIntegration(fakeClient, '948536645017374');

  assert.ok(integration, 'Yeşil Vadi must resolve successfully');
  assert.equal(integration.tenant_id, 'yesil-vadi-tenant-id-0001');
  assert.equal(integration.tenant_name, 'Yeşil Vadi');
  assert.notEqual(integration.tenant_name, 'Blue Dune');

  const upsertQuery = queries.find((q) => q.sql.includes('INSERT INTO channel_integrations'));
  assert.ok(upsertQuery, 'channel_integrations convergence upsert must target Yeşil Vadi');
  assert.equal(upsertQuery.params[0], 'whatsapp:948536645017374');
  assert.equal(upsertQuery.params[1], 'yesil-vadi-tenant-id-0001');
  assert.equal(upsertQuery.params[2], 'yesil-vadi-channel-id-0001');
  assert.equal(upsertQuery.params[3], 'yesil-vadi-assistant-id-0001');
});

