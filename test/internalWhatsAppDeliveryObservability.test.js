import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sendSilentInternalWhatsAppLeadNotification,
  computeLeadNotificationDedupeHash,
  reconstructLeadDetailsFromConversation,
} from '../services/high-intent-lead-service.js';
import { recordWhatsAppDeliveryStatus } from '../services/live-inbox-service.js';
import { safeProviderDiagnostic, WhatsAppDeliveryError } from '../services/whatsapp-delivery-service.js';
import { resolveWhatsAppSenderPhoneNumberId } from '../services/whatsapp-credential-resolution-service.js';

class MockDatabaseClient {
  constructor({ queries = {} } = {}) {
    this.queries = queries;
  }
  async query(sql, params = []) {
    const text = String(sql).trim();
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rowCount: 0, rows: [] };
    }
    for (const [pattern, handler] of Object.entries(this.queries)) {
      if (text.includes(pattern)) {
        return typeof handler === 'function' ? handler(params, text) : handler;
      }
    }
    return { rowCount: 0, rows: [] };
  }
  release() {}
}

class MockDatabasePool {
  constructor(client) {
    this.client = client;
  }
  async connect() {
    return this.client;
  }
}

test('PHASE 4.1 — Internal template HTTP 200 + wamid sets DISPATCH_ACCEPTED (not falsely DELIVERED)', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  const wamid = 'wamid.HBgLMzk3MTUyNzI4ODU4NhUCMRIA';

  let insertedDelivery = null;
  let savedSignals = null;

  const mockHttp = {
    post: async () => ({
      status: 200,
      data: {
        messaging_product: 'whatsapp',
        contacts: [{ input: '+971527288586', wa_id: '971527288586' }],
        messages: [{ id: wamid }],
      },
    }),
  };

  const client = new MockDatabaseClient({
    queries: {
      'integration_type = \'INSTAGRAM\'': () => ({
        rowCount: 1,
        rows: [{
          ig_config: {
            lead_notification_enabled: true,
            lead_whatsapp_destination: '+971527288586',
            lead_notification_template: { name: 'instagram_qualified_lead', language_code: 'tr', status: 'APPROVED' },
          },
        }],
      }),
      'integration_type = \'WHATSAPP\'': () => ({
        rowCount: 1,
        rows: [{ external_channel_id: '1376040765584173', wa_config: { access_token: 'meta_valid_token' } }],
      }),
      'FROM internal_notification_deliveries': () => ({ rowCount: 0, rows: [] }),
      'FROM crm_leads': () => ({ rowCount: 1, rows: [{ lead_id: 'lead-uuid-1', signals: {} }] }),
      'INSERT INTO internal_notification_deliveries': (params) => {
        insertedDelivery = { provider_message_id: params[7], destination: params[3] };
        return { rowCount: 1, rows: [] };
      },
      'INSERT INTO crm_lead_analyses': (params) => {
        savedSignals = JSON.parse(params[4]);
        return { rowCount: 1, rows: [] };
      },
    },
  });

  const res = await sendSilentInternalWhatsAppLeadNotification({
    tenantId,
    conversationId,
    leadDetails: {
      leadId: 'lead-uuid-1',
      customerName: 'Ahmet Soysal',
      phone: '+971501234567',
      serviceRequested: 'Free Zone Şirket Kuruluşu',
      requestedTime: 'Yarın 14:00',
    },
    database: new MockDatabasePool(client),
    env: { WHATSAPP_TOKEN: 'valid_token' },
    httpClient: mockHttp,
  });

  assert.equal(res.sent, true);
  assert.equal(res.deliveryStatus, 'DISPATCH_ACCEPTED');
  assert.equal(res.providerMessageId, wamid);
  assert.equal(insertedDelivery.provider_message_id, wamid);
  assert.equal(savedSignals.notification_delivery_status, 'DISPATCH_ACCEPTED');
  assert.notEqual(savedSignals.notification_delivery_status, 'DELIVERED');
});

test('PHASE 4.2 & 4.3 & 4.4 — Webhook lifecycle: SENT -> DELIVERED -> READ', async () => {
  const wamid = 'wamid.HBgLMzk3MTUyNzI4ODU4NhUCMRIA';
  let recordedStatus = 'DISPATCH_ACCEPTED';

  const client = new MockDatabaseClient({
    queries: {
      'UPDATE conversation_messages': () => ({ rowCount: 0, rows: [] }),
      'UPDATE internal_notification_deliveries': (params) => {
        recordedStatus = params[0];
        return {
          rowCount: 1,
          rows: [{ id: 'notif-1', tenant_id: 'tenant-1', delivery_status: params[0] }],
        };
      },
      'UPDATE crm_lead_analyses': () => ({ rowCount: 1, rows: [] }),
    },
  });

  const poolMock = new MockDatabasePool(client);

  const resSent = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '1376040765584173',
    status: { id: wamid, status: 'sent', timestamp: '1727470000' },
    database: poolMock,
    reconciliationDelaysMs: [0],
  });
  assert.equal(resSent.deliveryStatus, 'SENT');
  assert.equal(resSent.internalNotification, true);
  assert.equal(recordedStatus, 'SENT');

  const resDelivered = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '1376040765584173',
    status: { id: wamid, status: 'delivered', timestamp: '1727470005' },
    database: poolMock,
    reconciliationDelaysMs: [0],
  });
  assert.equal(resDelivered.deliveryStatus, 'DELIVERED');
  assert.equal(recordedStatus, 'DELIVERED');

  const resRead = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '1376040765584173',
    status: { id: wamid, status: 'read', timestamp: '1727470010' },
    database: poolMock,
    reconciliationDelaysMs: [0],
  });
  assert.equal(resRead.deliveryStatus, 'READ');
  assert.equal(recordedStatus, 'READ');
});

test('PHASE 4.5 — Webhook FAILED persists exact sanitized provider error', async () => {
  const wamid = 'wamid.HBgLMzk3MTUyNzI4ODU4NhUCMRIA';
  let recordedStatus = null;
  let recordedFailureCode = null;
  let recordedFailureReason = null;
  let recordedFailureDetails = null;

  const client = new MockDatabaseClient({
    queries: {
      'UPDATE conversation_messages': () => ({ rowCount: 0, rows: [] }),
      'UPDATE internal_notification_deliveries': (params) => {
        recordedStatus = params[0];
        recordedFailureCode = params[1];
        recordedFailureReason = params[2];
        recordedFailureDetails = params[3] ? JSON.parse(params[3]) : null;
        return {
          rowCount: 1,
          rows: [{ id: 'notif-1', tenant_id: 'tenant-1', delivery_status: 'FAILED' }],
        };
      },
      'UPDATE crm_lead_analyses': () => ({ rowCount: 1, rows: [] }),
    },
  });

  const resFailed = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '1376040765584173',
    status: {
      id: wamid,
      status: 'failed',
      timestamp: '1727470020',
      errors: [{
        code: 131026,
        title: 'Message Undeliverable',
        message: 'Message undeliverable due to handset reachability or carrier restriction.',
        error_data: { details: 'Recipient phone number is inactive or barred.' },
      }],
    },
    database: new MockDatabasePool(client),
    reconciliationDelaysMs: [0],
  });

  assert.equal(resFailed.updated, true);
  assert.equal(resFailed.deliveryStatus, 'FAILED');
  assert.equal(recordedStatus, 'FAILED');
  assert.equal(recordedFailureCode, '131026');
  assert.equal(recordedFailureReason, 'Message Undeliverable');
  assert.equal(recordedFailureDetails.code, '131026');
});

test('PHASE 4.6 & 4.7 — Customer messages unaffected and isolation preserved', async () => {
  let customerUpdated = false;
  const client = new MockDatabaseClient({
    queries: {
      'UPDATE conversation_messages': () => {
        customerUpdated = true;
        return { rowCount: 1, rows: [{ id: 'msg-1', tenant_id: 't-1', conversation_id: 'c-1', is_audio: false }] };
      },
    },
  });

  const res = await recordWhatsAppDeliveryStatus({
    phoneNumberId: '1376040765584173',
    status: { id: 'wamid.customer.1', status: 'delivered' },
    database: new MockDatabasePool(client),
    reconciliationDelaysMs: [0],
  });

  assert.equal(res.updated, true);
  assert.equal(res.internalNotification, false);
  assert.equal(customerUpdated, true);
});

test('PHASE 4.8 & 4.9 & 4.10 — Dedupe, in-flight protection and supported retry', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  let httpCalls = 0;

  const mockHttp = {
    post: async () => {
      httpCalls += 1;
      return { status: 200, data: { messages: [{ id: 'wamid.retry.ok' }] } };
    },
  };

  const clientInFlight = new MockDatabaseClient({
    queries: {
      'integration_type = \'INSTAGRAM\'': () => ({
        rowCount: 1,
        rows: [{
          ig_config: {
            lead_notification_enabled: true,
            lead_whatsapp_destination: '+971527288586',
            lead_notification_template: { name: 'instagram_qualified_lead', language_code: 'tr', status: 'APPROVED' },
          },
        }],
      }),
      'integration_type = \'WHATSAPP\'': () => ({
        rowCount: 1,
        rows: [{ external_channel_id: '1376040765584173', wa_config: { access_token: 'meta_token' } }],
      }),
      'FROM internal_notification_deliveries': () => ({
        rowCount: 1,
        rows: [{
          id: 'notif-1',
          delivery_status: 'DISPATCH_ACCEPTED',
          provider_message_id: 'wamid.in.flight',
          dispatched_at: new Date().toISOString(),
        }],
      }),
    },
  });

  const resInFlight = await sendSilentInternalWhatsAppLeadNotification({
    tenantId,
    conversationId,
    leadDetails: { customerName: 'Ahmet', phone: '+971501234567', serviceRequested: 'Setup', requestedTime: '14:00' },
    database: new MockDatabasePool(clientInFlight),
    env: { WHATSAPP_TOKEN: 'valid_token' },
    httpClient: mockHttp,
  });
  assert.equal(resInFlight.skipped, true);
  assert.equal(resInFlight.reason, 'DEDUPE_NOTIFICATION_IN_FLIGHT');
  assert.equal(httpCalls, 0);

  const resRetry = await sendSilentInternalWhatsAppLeadNotification({
    tenantId,
    conversationId,
    leadDetails: { customerName: 'Ahmet', phone: '+971501234567', serviceRequested: 'Setup', requestedTime: '14:00' },
    database: new MockDatabasePool(clientInFlight),
    env: { WHATSAPP_TOKEN: 'valid_token' },
    httpClient: mockHttp,
    forceRetry: true,
  });
  assert.equal(resRetry.sent, true);
  assert.equal(resRetry.providerMessageId, 'wamid.retry.ok');
  assert.equal(httpCalls, 1);
});

test('PHASE 4.11 & 4.12 — Zero LLM calls and zero customer Instagram messages', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  let llmCalls = 0;
  let customerMessages = 0;

  const mockHttp = {
    post: async (url) => {
      if (String(url).includes('openai') || String(url).includes('anthropic')) llmCalls += 1;
      return { status: 200, data: { messages: [{ id: 'wamid.ok' }] } };
    },
  };

  const client = new MockDatabaseClient({
    queries: {
      'integration_type = \'INSTAGRAM\'': () => ({
        rowCount: 1,
        rows: [{
          ig_config: {
            lead_notification_enabled: true,
            lead_whatsapp_destination: '+971527288586',
            lead_notification_template: { name: 'instagram_qualified_lead', language_code: 'tr', status: 'APPROVED' },
          },
        }],
      }),
      'integration_type = \'WHATSAPP\'': () => ({
        rowCount: 1,
        rows: [{ external_channel_id: '1376040765584173', wa_config: { access_token: 'meta_token' } }],
      }),
      'INSERT INTO conversation_messages': () => {
        customerMessages += 1;
        return { rowCount: 1, rows: [] };
      },
    },
  });

  const res = await sendSilentInternalWhatsAppLeadNotification({
    tenantId,
    conversationId,
    leadDetails: { customerName: 'Ahmet', phone: '+971501234567', serviceRequested: 'Setup', requestedTime: '14:00' },
    database: new MockDatabasePool(client),
    env: { WHATSAPP_TOKEN: 'valid_token' },
    httpClient: mockHttp,
  });

  assert.equal(res.sent, true);
  assert.equal(llmCalls, 0);
  assert.equal(customerMessages, 0);
});

test('PHASE 4.13 — Provider error extraction sanitizes Meta error response and excludes secrets', async () => {
  const metaErrorPayload = {
    response: {
      status: 400,
      data: {
        error: {
          message: '(#132000) The number of parameters does not match the expected number of params',
          type: 'OAuthException',
          code: 132000,
          error_subcode: 2494010,
          error_data: {
            messaging_product: 'whatsapp',
            details: 'template parameter length mismatch: expected 2, got 1',
          },
          fbtrace_id: 'A1B2C3D4E5F',
        },
      },
    },
    config: {
      headers: {
        Authorization: 'Bearer SECRET_ACCESS_TOKEN_12345',
      },
    },
  };

  const diag = safeProviderDiagnostic(metaErrorPayload, 'TEMPLATE_SEND');
  assert.equal(diag.providerStatus, 400);
  assert.equal(diag.providerCode, '132000');
  assert.equal(diag.providerSubcode, '2494010');
  assert.equal(diag.providerType, 'OAuthException');
  assert.equal(diag.providerMessage, '(#132000) The number of parameters does not match the expected number of params');
  assert.equal(diag.providerDetails, 'template parameter length mismatch: expected 2, got 1');

  // Verify secrets are strictly excluded
  const serialized = JSON.stringify(diag);
  assert.equal(serialized.includes('SECRET_ACCESS_TOKEN_12345'), false);
  assert.equal(serialized.includes('Authorization'), false);
});

test('PHASE 4.14 — HTTP 400 from Meta persists sanitized failure details to internal_notification_deliveries', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  let recordedFailureCode = null;
  let recordedFailureReason = null;

  const mockHttpError = {
    post: async () => {
      const err = new Error('Request failed with status code 400');
      err.response = {
        status: 400,
        data: {
          error: {
            message: '(#132000) The number of parameters does not match the expected number of params',
            type: 'OAuthException',
            code: 132000,
            error_subcode: 2494010,
            error_data: {
              messaging_product: 'whatsapp',
              details: 'template parameter length mismatch',
            },
          },
        },
      };
      throw err;
    },
  };

  const client = new MockDatabaseClient({
    queries: {
      'integration_type = \'INSTAGRAM\'': () => ({
        rowCount: 1,
        rows: [{
          ig_config: {
            lead_notification_enabled: true,
            lead_whatsapp_destination: '+971527288586',
            lead_notification_template: { name: 'instagram_qualified_lead', language_code: 'tr', status: 'APPROVED' },
          },
        }],
      }),
      'integration_type = \'WHATSAPP\'': () => ({
        rowCount: 1,
        rows: [{ external_channel_id: '1376040765584173', wa_config: { access_token: 'meta_secret_token' } }],
      }),
      'FROM internal_notification_deliveries': () => ({ rowCount: 0, rows: [] }),
      'FROM crm_leads': () => ({ rowCount: 1, rows: [{ lead_id: 'lead-1', signals: {} }] }),
      'INSERT INTO internal_notification_deliveries': (params) => {
        recordedFailureCode = params[7];
        recordedFailureReason = JSON.parse(params[8]);
        return { rowCount: 1, rows: [] };
      },
    },
  });

  const res = await sendSilentInternalWhatsAppLeadNotification({
    tenantId,
    conversationId,
    leadDetails: {
      leadId: 'lead-1',
      customerName: 'Ahmet Soysal',
      phone: '+905312404965',
      serviceRequested: 'Free Zone Şirket Kuruluşu',
      requestedTime: 'Bugün 18:00',
    },
    database: new MockDatabasePool(client),
    env: { WHATSAPP_TOKEN: 'valid_token' },
    httpClient: mockHttpError,
  });

  assert.equal(res.sent, false);
  assert.equal(res.error, 'META_132000');
  assert.equal(recordedFailureCode, 'META_132000');
  assert.equal(recordedFailureReason.http_status, 400);
  assert.equal(recordedFailureReason.code, 132000);
  assert.equal(recordedFailureReason.error_subcode, 2494010);
  assert.equal(recordedFailureReason.details, 'template parameter length mismatch');
});

test('PHASE 4.15 — reconstructLeadDetailsFromConversation uses authoritative persisted data without caller overrides', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';

  const client = new MockDatabaseClient({
    queries: {
      'FROM conversations conv': () => ({
        rowCount: 1,
        rows: [{
          id: conversationId,
          tenant_id: tenantId,
          customer_external_id: 'instagram:797284549839918',
          contact_id: 'contact-uuid-1',
          display_name: 'Ahmet Soysal',
          phone: '+905312404965',
        }],
      }),
      'FROM crm_leads l': () => ({
        rowCount: 1,
        rows: [{
          lead_id: 'lead-uuid-1',
          service_interest: 'Free Zone Şirket Kuruluşu',
          timeline: 'Bugün 18:00',
          activity_metadata: {
            event: 'CONSULTATION_REQUEST_PENDING',
            status: 'PENDING',
            requested_time: 'Bugün 18:00',
          },
        }],
      }),
      'FROM conversation_messages': () => ({
        rowCount: 4,
        rows: [
          { sender_type: 'CUSTOMER', content: 'Merhaba, Free Zone şirket kurmak istiyorum.' },
          { sender_type: 'CUSTOMER', content: 'E-ticaret üzerine olacak.' },
          { sender_type: 'CUSTOMER', content: 'Numaram: +905312404965' },
          { sender_type: 'CUSTOMER', content: 'Bugun saat 18.00 olabilir' },
        ],
      }),
    },
  });

  const reconstructed = await reconstructLeadDetailsFromConversation({
    tenantId,
    conversationId,
    database: new MockDatabasePool(client),
  });

  assert.equal(reconstructed.customerName, 'Ahmet Soysal');
  assert.equal(reconstructed.phone, '+905312404965');
  assert.equal(reconstructed.serviceRequested, 'Free Zone Şirket Kuruluşu');
  assert.equal(reconstructed.requestedTime, 'Bugün 18:00');
  assert.notEqual(reconstructed.requestedTime, 'Yarın 14:00');
});

test('PHASE 4.16 — resolveWhatsAppSenderPhoneNumberId semantically distinguishes WABA ID from Phone Number ID', () => {
  const wabaId = '947279035146304';
  const phoneId = '1376040765584173';

  // Test 1: Config has explicit phone_number_id while external_channel_id has WABA ID
  const resolvedFromConfig = resolveWhatsAppSenderPhoneNumberId({
    tenantChannel: { external_channel_id: wabaId },
    integrationConfig: {
      whatsapp: {
        waba_id: wabaId,
        phone_number_id: phoneId,
      },
    },
    env: {},
  });
  assert.equal(resolvedFromConfig, phoneId);

  // Test 2: Channel has valid phone number and no WABA ID collision
  const resolvedFromChannel = resolveWhatsAppSenderPhoneNumberId({
    tenantChannel: { external_channel_id: phoneId },
    integrationConfig: {},
    env: {},
  });
  assert.equal(resolvedFromChannel, phoneId);

  // Test 3: Channel has WABA ID, config has WABA ID, env has WHATSAPP_PHONE_NUMBER_ID
  const resolvedFromEnv = resolveWhatsAppSenderPhoneNumberId({
    tenantChannel: { external_channel_id: wabaId },
    integrationConfig: { whatsapp: { waba_id: wabaId } },
    env: { WHATSAPP_PHONE_NUMBER_ID: phoneId },
  });
  assert.equal(resolvedFromEnv, phoneId);

  // Test 4: Channel has WABA ID, no phone number configured anywhere -> FAILS CLOSED (returns null)
  const failedClosed = resolveWhatsAppSenderPhoneNumberId({
    tenantChannel: { external_channel_id: wabaId },
    integrationConfig: { whatsapp: { waba_id: wabaId } },
    env: { WHATSAPP_WABA_ID: wabaId },
  });
  assert.equal(failedClosed, null);
});

test('PHASE 4.17 — sendSilentInternalWhatsAppLeadNotification dispatches to resolved Phone Number ID instead of WABA ID', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  const wabaId = '947279035146304';
  const phoneId = '1376040765584173';
  let capturedUrl = null;

  const mockHttp = {
    post: async (url) => {
      capturedUrl = url;
      return { status: 200, data: { messages: [{ id: 'wamid.resolved.phone' }] } };
    },
  };

  const client = new MockDatabaseClient({
    queries: {
      'integration_type = \'INSTAGRAM\'': () => ({
        rowCount: 1,
        rows: [{
          ig_config: {
            lead_notification_enabled: true,
            lead_whatsapp_destination: '+971527288586',
            lead_notification_template: { name: 'instagram_qualified_lead', language_code: 'tr', status: 'APPROVED' },
          },
        }],
      }),
      'integration_type = \'WHATSAPP\'': () => ({
        rowCount: 1,
        rows: [{
          id: 'channel-1',
          external_channel_id: wabaId, // WABA ID in channel
          wa_config: {
            whatsapp: {
              waba_id: wabaId,
              phone_number_id: phoneId, // Canonical phone number in config
            },
          },
        }],
      }),
      'FROM internal_notification_deliveries': () => ({ rowCount: 0, rows: [] }),
      'FROM crm_leads': () => ({ rowCount: 1, rows: [{ lead_id: 'lead-1', signals: {} }] }),
      'INSERT INTO internal_notification_deliveries': () => ({ rowCount: 1, rows: [] }),
      'INSERT INTO crm_lead_analyses': () => ({ rowCount: 1, rows: [] }),
    },
  });

  const res = await sendSilentInternalWhatsAppLeadNotification({
    tenantId,
    conversationId,
    leadDetails: {
      leadId: 'lead-1',
      customerName: 'Ahmet Soysal',
      phone: '+905312404965',
      serviceRequested: 'Free Zone Şirket Kuruluşu',
      requestedTime: 'Bugün 18:00',
    },
    database: new MockDatabasePool(client),
    env: { WHATSAPP_TOKEN: 'valid_token' },
    httpClient: mockHttp,
  });

  assert.equal(res.sent, true);
  assert.equal(capturedUrl.includes(phoneId), true);
  assert.equal(capturedUrl.includes(wabaId), false);
});
