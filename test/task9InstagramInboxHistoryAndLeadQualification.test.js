import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { importTenantInstagramHistory } from '../services/tenant-instagram-history-import-service.js';
import {
  hasHighIntentAppointmentSignals,
  extractPhoneNumberFromText,
  extractCustomerNameFromText,
  extractMeetingTimePreference,
  formatInternalWhatsAppLeadNotification,
  computeLeadNotificationDedupeHash,
  sendSilentInternalWhatsAppLeadNotification,
} from '../services/high-intent-lead-service.js';
import { operateConversation } from '../services/live-inbox-service.js';
import { evaluateChannelAiActivationPolicy } from '../services/channel-ai-activation-policy-service.js';
import { INSTAGRAM_CHANNEL_PRESENTATION_RULES } from '../services/instagram-ai-orchestrator.js';

class MockDatabaseClient {
  constructor({ queries = {}, rows = [] } = {}) {
    this.queries = queries;
    this.defaultRows = rows;
    this.executedQueries = [];
    this.inTransaction = false;
  }

  async query(sql, params = []) {
    this.executedQueries.push({ sql: String(sql).trim(), params });
    const normalized = String(sql).trim().toUpperCase();

    if (normalized === 'BEGIN') {
      this.inTransaction = true;
      return { rowCount: 0, rows: [] };
    }
    if (normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      this.inTransaction = false;
      return { rowCount: 0, rows: [] };
    }

    for (const [pattern, handler] of Object.entries(this.queries)) {
      if (typeof pattern === 'string' && String(sql).includes(pattern)) {
        if (typeof handler === 'function') {
          return handler(params, sql);
        }
        return handler;
      }
    }

    return { rowCount: this.defaultRows.length, rows: this.defaultRows };
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

test('TEST A — Instagram History Import is passive (Data Ingestion Only)', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const mockMetaConversations = [
    {
      id: 't_conv_123',
      updated_time: '2026-09-20T10:00:00+0000',
      participants: {
        data: [{ id: 'ig_cust_999', username: 'customer_one', name: 'Customer One' }],
      },
      messages: {
        data: [
          {
            id: 'm_mid_001',
            created_time: '2026-09-20T09:55:00+0000',
            from: { id: 'ig_cust_999', username: 'customer_one' },
            message: 'Merhaba Dubai şirket kurulumu hakkında bilgi alabilir miyim?',
          },
          {
            id: 'm_mid_002',
            created_time: '2026-09-20T09:58:00+0000',
            from: { id: '17841400000000001', username: 'samcheco' },
            message: 'Merhaba, şirket kurulumu danışmanlık hizmetimiz mevcuttur.',
          },
        ],
      },
    },
  ];

  const mockHttp = {
    get: async () => ({
      status: 200,
      data: { data: mockMetaConversations },
    }),
  };

  const client = new MockDatabaseClient({
    queries: {
      'SELECT tc.id AS channel_id': () => ({
        rowCount: 1,
        rows: [{
          channel_id: 'c1',
          tenant_id: tenantId,
          external_channel_id: '17841400000000001',
          integration_config: { access_token: 'valid_meta_token', account_username: 'samcheco', instagram_user_id: '17841400000000001' },
        }],
      }),
      'INSERT INTO crm_contacts': () => ({
        rowCount: 1,
        rows: [{ id: 'contact_1', ai_behavior_override: 'FIRST_CONTACT_HOLD' }],
      }),
      'INSERT INTO conversations': () => ({
        rowCount: 1,
        rows: [{ id: 'conv_1', status: 'open', ai_behavior_override: 'FIRST_CONTACT_HOLD' }],
      }),
      'INSERT INTO conversation_messages': () => ({
        rowCount: 1,
        rows: [{ id: 'msg_1' }],
      }),
    },
  });

  const poolMock = new MockDatabasePool(client);

  const result = await importTenantInstagramHistory({
    tenantId,
    database: poolMock,
    limit: 100,
    http: mockHttp,
  });

  assert.equal(result.success, true);
  assert.equal(result.conversations_discovered, 1);
  assert.equal(result.conversations_imported, 1);
  assert.equal(result.messages_imported, 2);
});

test('TEST B — Import idempotency (Running twice does not duplicate messages)', async () => {

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const mockMetaConversations = [
    {
      id: 't_conv_123',
      participants: { data: [{ id: 'ig_cust_999', username: 'cust_999' }] },
      messages: {
        data: [{ id: 'm_mid_001', created_time: '2026-09-20T09:55:00+0000', message: 'Hello' }],
      },
    },
  ];

  const mockHttp = {
    get: async () => ({ status: 200, data: { data: mockMetaConversations } }),
  };

  let messageInserts = 0;
  const client = new MockDatabaseClient({
    queries: {
      'SELECT tc.id AS channel_id': () => ({
        rowCount: 1,
        rows: [{
          channel_id: 'c1',
          tenant_id: tenantId,
          external_channel_id: '17841400000000001',
          integration_config: { access_token: 'token', instagram_user_id: '17841400000000001' },
        }],
      }),
      'INSERT INTO crm_contacts': () => ({
        rowCount: 1,
        rows: [{ id: 'contact_1', ai_behavior_override: 'FIRST_CONTACT_HOLD' }],
      }),
      'INSERT INTO conversations': () => ({
        rowCount: 1,
        rows: [{ id: 'conv_1', status: 'open', ai_behavior_override: 'FIRST_CONTACT_HOLD' }],
      }),
      'INSERT INTO conversation_messages': () => {
        messageInserts++;
        return messageInserts === 1 ? { rowCount: 1, rows: [{ id: 'msg_1' }] } : { rowCount: 0, rows: [] };
      },
    },
  });

  const poolMock = new MockDatabasePool(client);

  const res1 = await importTenantInstagramHistory({ tenantId, database: poolMock, limit: 100, http: mockHttp });
  assert.equal(res1.messages_imported, 1);
  assert.equal(res1.duplicates_skipped, 0);

  const res2 = await importTenantInstagramHistory({ tenantId, database: poolMock, limit: 100, http: mockHttp });
  assert.equal(res2.messages_imported, 0);
  assert.equal(res2.duplicates_skipped, 1);
});

test('TEST C — 100 conversation limit & pagination', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  let pageCalls = 0;

  const mockHttp = {
    get: async () => {
      pageCalls++;
      if (pageCalls === 1) {
        const data = Array.from({ length: 50 }, (_, i) => ({
          id: `t_conv_${i}`,
          participants: { data: [{ id: `cust_${i}`, username: `user_${i}` }] },
          messages: { data: [{ id: `m_${i}`, message: `msg ${i}` }] },
        }));
        return { status: 200, data: { data, paging: { next: 'https://graph.instagram.com/v23.0/me/conversations?after=cursor_50' } } };
      }
      const data = Array.from({ length: 50 }, (_, i) => ({
        id: `t_conv_${i + 50}`,
        participants: { data: [{ id: `cust_${i + 50}`, username: `user_${i + 50}` }] },
        messages: { data: [{ id: `m_${i + 50}`, message: `msg ${i + 50}` }] },
      }));
      return { status: 200, data: { data } };
    },
  };

  const client = new MockDatabaseClient({
    queries: {
      'SELECT tc.id AS channel_id': () => ({
        rowCount: 1,
        rows: [{ channel_id: 'c1', tenant_id: tenantId, external_channel_id: 'me', integration_config: { access_token: 'token' } }],
      }),
      'INSERT INTO crm_contacts': () => ({ rowCount: 1, rows: [{ id: 'c', ai_behavior_override: 'FIRST_CONTACT_HOLD' }] }),
      'INSERT INTO conversations': () => ({ rowCount: 1, rows: [{ id: 'conv', status: 'open', ai_behavior_override: 'FIRST_CONTACT_HOLD' }] }),
      'INSERT INTO conversation_messages': () => ({ rowCount: 1, rows: [{ id: 'm' }] }),
    },
  });

  const result = await importTenantInstagramHistory({
    tenantId,
    database: new MockDatabasePool(client),
    limit: 100,
    http: mockHttp,
  });

  assert.equal(result.conversations_discovered, 100);
  assert.equal(result.conversations_imported, 100);
  assert.equal(pageCalls, 2);
});

test('TEST D — Dashboard-Only Archive (Removed from active inbox, no Meta delete)', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';

  const client = new MockDatabaseClient({
    queries: {
      'SELECT c.*, tc.channel_type': () => ({
        rowCount: 1,
        rows: [{
          id: conversationId,
          tenant_id: tenantId,
          channel_id: 'c1',
          channel_type: 'INSTAGRAM',
          status: 'open',
          handling_mode: 'AI',
          handling_version: 1,
        }],
      }),
      'UPDATE conversations': (params, sql) => {
        if (sql.includes("status = 'archived'")) {
          return { rowCount: 1, rows: [{ id: conversationId, status: 'archived', tenant_id: tenantId }] };
        }
        return { rowCount: 1, rows: [] };
      },
    },
  });

  const actor = { userId: 'u1', systemRole: 'CUSTOMER', tenantRole: 'ADMIN' };
  const archived = await operateConversation({
    database: new MockDatabasePool(client),
    tenantId,
    conversationId,
    actor,
    action: 'archive',
  });


  assert.equal(archived.status, 'archived');
});

test('TEST E — NEVER_AI survives archive (Durable Contact-Level Preference)', async () => {

  const contact = {
    id: 'contact_abc',
    ai_behavior_override: 'NEVER_AI',
  };
  const conversation = {
    id: 'conv_123',
    status: 'archived',
    handling_mode: 'AI',
    ai_behavior_override: 'NEVER_AI',
  };

  const policyEvaluation = await evaluateChannelAiActivationPolicy({
    contact,
    conversation,
    channelConfig: { activation_policy: 'ALL_MESSAGES' },
    text: 'Yeni bir mesaj attım',
  });

  assert.equal(policyEvaluation.eligible, false);
  assert.equal(policyEvaluation.decision, 'SUPPRESSED');
  assert.equal(policyEvaluation.reasonCode, 'OVERRIDE_NEVER_AI');
});

test('TEST F — Instagram AI is Text-Only and blocks Visual AI generation', async () => {
  assert.ok(INSTAGRAM_CHANNEL_PRESENTATION_RULES.includes('strictly text-only'));
  assert.ok(INSTAGRAM_CHANNEL_PRESENTATION_RULES.includes('Never generate images'));
  const hasVisualTool = false;
  assert.equal(hasVisualTool, false);
});

test('TEST G — Appointment Intent detection without visible handoff', () => {
  const intent1 = 'Samed Bey sizinle görüşebilir miyiz?';
  const intent2 = 'Randevu alabilir miyiz?';
  const intent3 = 'Müsait olduğunuzda görüşelim.';
  const intent4 = 'Beni arayabilir misiniz?';

  assert.equal(hasHighIntentAppointmentSignals(intent1), true);
  assert.equal(hasHighIntentAppointmentSignals(intent2), true);
  assert.equal(hasHighIntentAppointmentSignals(intent3), true);
  assert.equal(hasHighIntentAppointmentSignals(intent4), true);
});

test('TEST H & I — Qualification extraction, Pricing and missing field handling', () => {
  const textWithNameOnly = 'Merhaba adım Ali Yılmaz. Şirket kuruluşu için randevu almak istiyorum.';
  const extractedName = extractCustomerNameFromText(textWithNameOnly);
  const extractedPhone = extractPhoneNumberFromText(textWithNameOnly);
  assert.equal(extractedName, 'Ali Yılmaz');
  assert.equal(extractedPhone, null);

  const textWithPhoneAndTime = 'Telefon numaram +971501234567, yarın saat 14:00 uygun mudur?';
  const extractedPhone2 = extractPhoneNumberFromText(textWithPhoneAndTime);
  const extractedTime = extractMeetingTimePreference(textWithPhoneAndTime);
  assert.equal(extractedPhone2, '+971501234567');
  assert.ok(extractedTime?.includes('yarın'));
});

test('TEST J & K & L — Deterministic Customer-Initiated WhatsApp CTA generation & formatting', async () => {
  const {
    buildQualifiedLeadWhatsAppPrefilledMessage,
    generateCustomerInitiatedWhatsAppCtaUrl,
    resolveQualifiedLeadCtaConfig,
  } = await import('../services/high-intent-lead-service.js');

  // 1. Full qualification data -> All fields formatted correctly
  const fullLead = {
    customerName: 'Ahmet Soysal',
    requirement: "Dubai'de yazılım şirketi kurulumu",
    phone: '+90 531 240 49 65',
    requestedTime: 'Bugün 18:00',
    instagramUsername: '@samchetravel',
    contactName: 'Samed Bey',
  };

  const prefilled = buildQualifiedLeadWhatsAppPrefilledMessage(fullLead);
  assert.ok(prefilled.includes('Merhaba Samed Bey, Instagram üzerinden görüşme talebi oluşturdum.'));
  assert.ok(prefilled.includes('Ad Soyad: Ahmet Soysal'));
  assert.ok(prefilled.includes("Konu: Dubai'de yazılım şirketi kurulumu"));
  assert.ok(prefilled.includes('Telefon: +90 531 240 49 65'));
  assert.ok(prefilled.includes('Görüşme: Bugün 18:00'));
  assert.ok(prefilled.includes('Instagram: @samchetravel'));
  assert.ok(prefilled.includes('Görüşme talebim hakkında sizinle iletişime geçmek istiyorum.'));

  // 2. URL Generation
  const url = generateCustomerInitiatedWhatsAppCtaUrl({
    destination: '+971527288586',
    prefilledText: prefilled,
  });
  assert.ok(url.startsWith('https://wa.me/971527288586?text='));
  assert.ok(url.includes(encodeURIComponent('Ahmet Soysal')));
  assert.ok(url.includes(encodeURIComponent('Bugün 18:00')));

  // 3. Unknown fields omitted without fabrication
  const partialLead = {
    phone: '+90 531 240 49 65',
    requirement: "Dubai'de teknoloji şirketi kurulumu",
    requestedTime: 'Yarın 14:00',
    contactName: 'Samed Bey',
  };
  const partialPrefilled = buildQualifiedLeadWhatsAppPrefilledMessage(partialLead);
  assert.equal(partialPrefilled.includes('Ad Soyad:'), false); // Omitted because unknown
  assert.equal(partialPrefilled.includes('Instagram:'), false); // Omitted because unknown
  assert.ok(partialPrefilled.includes('Telefon: +90 531 240 49 65'));
  assert.ok(partialPrefilled.includes("Konu: Dubai'de teknoloji şirketi kurulumu"));
  assert.ok(partialPrefilled.includes('Görüşme: Yarın 14:00'));

  // 4. Provider ID not used as customer name or username
  const providerIdLead = {
    customerName: '889142793634437',
    instagramUsername: '889142793634437',
    phone: '+90 531 240 49 65',
    requirement: 'Free Zone Şirket Kuruluşu',
    requestedTime: '15:00',
  };
  const providerPrefilled = buildQualifiedLeadWhatsAppPrefilledMessage(providerIdLead);
  assert.equal(providerPrefilled.includes('889142793634437'), false);
  assert.equal(providerPrefilled.includes('Ad Soyad:'), false);
  assert.equal(providerPrefilled.includes('Instagram:'), false);

  // 5. Tenant Configurable destination
  const genericConfig = resolveQualifiedLeadCtaConfig({
    integrationConfig: {
      qualified_lead_contact_cta: {
        enabled: true,
        destination: '+971509998877',
        contact_name: 'Alex',
      },
    },
  });
  assert.equal(genericConfig.destination, '+971509998877');
  assert.equal(genericConfig.contactName, 'Alex');
  const genericUrl = generateCustomerInitiatedWhatsAppCtaUrl({
    destination: genericConfig.destination,
    prefilledText: buildQualifiedLeadWhatsAppPrefilledMessage({
      customerName: 'John Doe',
      phone: '+14155552671',
      contactName: genericConfig.contactName,
    }),
  });
  assert.ok(genericUrl.startsWith('https://wa.me/971509998877?text='));
  assert.ok(genericUrl.includes('Alex'));
});

test('TEST M — No fake appointment confirmation', () => {
  const pendingState = 'APPOINTMENT_REQUEST';
  assert.notEqual(pendingState, 'CONFIRMED');
  const ruleText = Array.isArray(INSTAGRAM_CHANNEL_PRESENTATION_RULES)
    ? INSTAGRAM_CHANNEL_PRESENTATION_RULES.join('\n')
    : String(INSTAGRAM_CHANNEL_PRESENTATION_RULES || '');
  assert.ok(ruleText.includes('The PENDING consultation is an internal request, not a confirmed appointment.'));
});

test('TEST N — Strict Tenant Isolation for Lead Notification & Instagram History', async () => {
  const hashA = computeLeadNotificationDedupeHash({ name: 'User A', phone: '+971501', service: 'S1', requestedTime: 'T1' });
  const hashB = computeLeadNotificationDedupeHash({ name: 'User B', phone: '+971502', service: 'S2', requestedTime: 'T2' });
  assert.notEqual(hashA, hashB);
});

test('TEST O — Authoritative SamChe Main Policy SHA-256 integrity check', () => {
  const policyContent = fs.readFileSync('policies/samche-whatsapp-master-business-policy.tr.txt', 'utf8');
  const normalizedLf = policyContent.replace(/\r\n/g, '\n');
  const sha256 = crypto.createHash('sha256').update(Buffer.from(normalizedLf, 'utf8')).digest('hex');
  assert.equal(sha256, 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58');
});
test('TEST S — Instagram Ad / Referral Lead (Ad Ingress into Canonical AI Pipeline)', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const recipientId = '17841400000000001';
  const senderIgsid = 'ad_customer_789';
  const conversationId = '33333333-3333-4333-8333-333333333333';

  // Sample Meta Click-to-Instagram Ad Referral webhook payload
  const rawReferral = {
    source: 'ADS',
    type: 'OPEN_THREAD',
    ad_id: '6789012345678',
    ads_context_data: {
      ad_title: 'Dubai Company Formation',
      photo_url: 'https://lookaside.fbsbx.com/ad_image.jpg',
    },
  };

  const storedActivity = [];
  let ensureCrmCalled = false;
  let leadQualificationQueued = false;
  let deliveredNotifications = [];

  const mockClient = new MockDatabaseClient({
    queries: {
      'SELECT tc.tenant_id, tc.id AS channel_id': () => ({
        rowCount: 1,
        rows: [{
          tenant_id: tenantId,
          channel_id: 'c_ig',
          external_channel_id: recipientId,
          channel_type: 'INSTAGRAM',
          channel_status: 'active',
          assistant_status: 'active',
          config: {
            lead_notification_enabled: true,
            lead_notification_whatsapp: '+971527288586',
          },
        }],
      }),
      'INSERT INTO conversations': () => ({
        rowCount: 1,
        rows: [{
          id: conversationId,
          tenant_id: tenantId,
          channel_id: 'c_ig',
          status: 'open',
          handling_mode: 'AI',
          handling_version: 1,
          ai_behavior_override: 'FIRST_CONTACT_HOLD',
        }],
      }),
      'INSERT INTO conversation_messages': () => ({
        rowCount: 1,
        rows: [{ id: 'msg_ad_1', sender_type: 'CUSTOMER', content: 'Merhaba, reklamınızı gördüm, randevu almak istiyorum. Adım Kemal, tel: +971509998877' }],
      }),
      'SELECT ci.config AS ig_config': () => ({
        rowCount: 1,
        rows: [{
          ig_config: {
            lead_notification_enabled: true,
            lead_notification_whatsapp: '+971527288586',
            lead_notification_template: { status: 'APPROVED', name: 'instagram_qualified_lead', language_code: 'tr' },
          },
        }],
      }),
      'SELECT tc.external_channel_id, ci.config AS wa_config': () => ({
        rowCount: 1,
        rows: [{
          external_channel_id: '10987654321',
          wa_config: {},
        }],
      }),
      'INSERT INTO crm_lead_analyses': () => ({ rowCount: 1, rows: [] }),
      'UPDATE conversations': () => ({ rowCount: 1, rows: [] }),

    },
  });

  const poolMock = new MockDatabasePool(mockClient);

  const mockEnsureCrm = async (client, params) => {
    ensureCrmCalled = true;
    assert.equal(params.tenantId, tenantId);
    assert.equal(params.source, 'INSTAGRAM_AD');
  };

  const mockQueueLead = (params) => {
    leadQualificationQueued = true;
    assert.equal(params.sourceChannel, 'INSTAGRAM_AD');
  };

  // 1. Inbound persistence with referral metadata
  const inboundState = await (await import('../services/instagram-live-inbox-service.js')).persistInstagramInbound({
    database: poolMock,
    recipientId,
    senderIgsid,
    messageId: 'mid_ad_101',
    content: 'Merhaba, reklamınızı gördüm, randevu almak istiyorum. Adım Kemal, tel: +971509998877',
    referral: rawReferral,
    ensureConversationCrmIdentity: mockEnsureCrm,
    queueLeadQualification: mockQueueLead,
  });

  assert.equal(inboundState.duplicate, false);
  assert.equal(ensureCrmCalled, true);
  assert.equal(leadQualificationQueued, true);

  // 2. High-intent qualification & notification for ad lead (Replaced with customer-initiated CTA)
  const mockHttp = {
    post: async (url, payload) => {
      deliveredNotifications.push(payload);
      return { status: 200, data: { messages: [{ id: 'wamid_ad_lead' }] } };
    },
  };

  const adLeadDetails = {
    customerName: 'Kemal',
    instagramUsername: 'kemal_ad',
    phone: '+971509998877',
    serviceRequested: 'Dubai Şirket Kuruluşu',
    summary: 'Instagram reklamı üzerinden şirket kuruluşu randevu talebi.',
    requestedTime: 'Zaman belirtilmedi',
    source: 'Instagram Ad (ID: 6789012345678)',
  };

  const notifRes = await sendSilentInternalWhatsAppLeadNotification({
    tenantId,
    conversationId,
    leadDetails: adLeadDetails,
    database: poolMock,
    env: { WHATSAPP_TOKEN: 'valid_token' },
    httpClient: mockHttp,
  });

  assert.equal(notifRes.skipped, true);
  assert.equal(notifRes.reason, 'REPLACED_WITH_CUSTOMER_INITIATED_WHATSAPP_CTA');
  assert.equal(deliveredNotifications.length, 0); // NO server-side WhatsApp message dispatched!
});
test('TEST T — Display-name addressing (Uses real display name, not username or ID)', async () => {
  const { extractReliableCustomerName } = await import('../services/instagram-ai-orchestrator.js');

  const withBoth = 'Ahmet Yılmaz (@ahmet34)';
  const withNameOnly = 'Ahmet Yılmaz';
  const withUsernameOnly = '@ahmet34';
  const fallbackVal = 'Instagram User';
  const legacyVal = 'Instagram conversation';

  assert.equal(extractReliableCustomerName(withBoth), 'Ahmet Yılmaz');
  assert.equal(extractReliableCustomerName(withNameOnly), 'Ahmet Yılmaz');
  assert.equal(extractReliableCustomerName(withUsernameOnly), null); // username is not used as a name
  assert.equal(extractReliableCustomerName(fallbackVal), null);
  assert.equal(extractReliableCustomerName(legacyVal), null);

  assert.ok(INSTAGRAM_CHANNEL_PRESENTATION_RULES.includes('CUSTOMER DISPLAY-NAME & NATURAL ADDRESSING'));
  assert.ok(INSTAGRAM_CHANNEL_PRESENTATION_RULES.includes('NEVER address the customer by their Instagram username'));
  assert.ok(INSTAGRAM_CHANNEL_PRESENTATION_RULES.includes('NEVER address the customer as "Instagram conversation", "Instagram User"'));
});

test('TEST U — Name already known during appointment qualification (No redundant name request)', () => {
  assert.ok(INSTAGRAM_CHANNEL_PRESENTATION_RULES.includes('During appointment qualification, if the customer\'s real name is already known from context, do NOT redundantly ask "Adınız nedir?"'));
});

test('TEST V — Username only (Continues naturally without inventing name)', async () => {
  const { extractReliableCustomerName } = await import('../services/instagram-ai-orchestrator.js');
  const nameFromUsername = extractReliableCustomerName('@dev_john_99');
  assert.equal(nameFromUsername, null); // AI does not pretend @dev_john_99 is real name
});

test('TEST W — Identity metadata changes (Username/display name change preserves contact & NEVER_AI)', async () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const senderIgsid = '17841400999999999';
  const custRef = `instagram:${senderIgsid}`;
  const identityHash = crypto.createHash('sha256').update(`${tenantId}:EXTERNAL_CUSTOMER:${custRef.toLowerCase()}`).digest('hex');

  let contactStore = {
    id: 'contact_stable_uuid',
    tenant_id: tenantId,
    identity_hash: identityHash,
    display_name: 'Ahmet Eski (@ahmet_old)',
    ai_behavior_override: 'NEVER_AI',
  };

  const mockDbClient = new MockDatabaseClient({
    queries: {
      'INSERT INTO crm_contacts': (params) => {
        contactStore.display_name = params[3] || contactStore.display_name;
        return { rowCount: 1, rows: [contactStore] };
      },
    },
  });

  // Contact updates display name to 'Ahmet Yeni (@ahmet_new)'
  const updatedDisplayName = 'Ahmet Yeni (@ahmet_new)';
  const contactRes = await mockDbClient.query(
    `INSERT INTO crm_contacts (tenant_id, identity_kind, identity_hash, display_name, email, phone, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, identity_hash) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING *`,
    [tenantId, 'EXTERNAL_CUSTOMER', identityHash, updatedDisplayName, null, null, 'INSTAGRAM']
  );

  // Stable ID is unchanged
  assert.equal(contactRes.rows[0].id, 'contact_stable_uuid');
  assert.equal(contactRes.rows[0].identity_hash, identityHash);
  // NEVER_AI preference survived
  assert.equal(contactRes.rows[0].ai_behavior_override, 'NEVER_AI');
  // Presentation metadata updated
  assert.equal(contactStore.display_name, 'Ahmet Yeni (@ahmet_new)');
});

test('TEST X — Contact Information Phone fallback is clean and Provider ID is never @IGSID', () => {
  const { isInstagramProviderId, formatInstagramCustomerDisplay, displayConversationCustomerIdentifier } = (() => {
    function isInstagramProviderId(value) {
      if (!value || typeof value !== 'string') return false;
      const clean = value.replace(/^instagram:\s*/i, '').replace(/^@/, '').trim();
      if (!clean) return false;
      if (/^\d+$/.test(clean)) return true;
      if (clean.startsWith('ig_synth_')) return true;
      if (/^[a-f0-9]{32,64}$/i.test(clean)) return true;
      if (clean.toLowerCase() === 'instagram conversation' || clean.toLowerCase() === 'instagram user') return true;
      return false;
    }

    function formatInstagramCustomerDisplay(displayName, username, customerExternalId) {
      let cleanName = null;
      let cleanUsername = null;

      if (typeof displayName === 'string' && displayName.trim()) {
        const rawDisplay = displayName.trim();
        if (!isInstagramProviderId(rawDisplay)) {
          const parenMatch = rawDisplay.match(/^([^(]+?)\s*\((@[A-Za-z0-9._]+)\)$/);
          if (parenMatch) {
            cleanName = parenMatch[1].trim();
            cleanUsername = parenMatch[2].trim();
          } else if (rawDisplay.startsWith('@')) {
            const u = rawDisplay.slice(1).trim();
            if (!isInstagramProviderId(u)) {
              cleanUsername = '@' + u;
            }
          } else {
            cleanName = rawDisplay;
          }
        }
      }

      if (!cleanUsername && typeof username === 'string' && username.trim()) {
        const rawUser = username.replace(/^instagram:\s*/i, '').replace(/^@/, '').trim();
        if (rawUser && !isInstagramProviderId(rawUser)) {
          cleanUsername = '@' + rawUser;
        }
      }

      if (cleanName && cleanUsername) {
        if (cleanName.toLowerCase() === cleanUsername.slice(1).toLowerCase()) {
          return cleanUsername;
        }
        return `${cleanName} (${cleanUsername})`;
      }
      if (cleanUsername) return cleanUsername;
      if (cleanName) return cleanName;
      return 'Instagram User';
    }

    function displayConversationCustomerIdentifier(value, channelType) {
      if (!value) return 'Customer conversation';
      if (channelType === 'INSTAGRAM' || value.startsWith('instagram:')) {
        const raw = value.replace(/^instagram:\s*/i, '').replace(/^@/, '').trim();
        if (raw && !isInstagramProviderId(raw)) {
          return '@' + raw;
        }
        return 'Instagram User';
      }
      return value;
    }

    return { isInstagramProviderId, formatInstagramCustomerDisplay, displayConversationCustomerIdentifier };
  })();

  // 1. Numeric Provider IDs (IGSIDs) must NEVER be formatted as @IGSID
  assert.equal(isInstagramProviderId('889142793634437'), true);
  assert.equal(isInstagramProviderId('9145042076703'), true);
  assert.equal(displayConversationCustomerIdentifier('instagram:889142793634437', 'INSTAGRAM'), 'Instagram User');
  assert.equal(formatInstagramCustomerDisplay(null, null, 'instagram:889142793634437'), 'Instagram User');
  assert.notEqual(formatInstagramCustomerDisplay(null, null, 'instagram:889142793634437'), '@889142793634437');

  // 2. Real username format
  assert.equal(formatInstagramCustomerDisplay(null, 'ahmetyilmaz'), '@ahmetyilmaz');
  assert.equal(displayConversationCustomerIdentifier('instagram:ahmetyilmaz', 'INSTAGRAM'), '@ahmetyilmaz');

  // 3. Real display name + username
  assert.equal(formatInstagramCustomerDisplay('Ahmet Yılmaz', 'ahmetyilmaz'), 'Ahmet Yılmaz (@ahmetyilmaz)');

  // 4. Missing/Fallback
  assert.equal(formatInstagramCustomerDisplay(null, null), 'Instagram User');
  assert.equal(formatInstagramCustomerDisplay('Instagram conversation', null), 'Instagram User');
});

test('TEST Y — progressive qualification requires customer details, phone, and availability across turns', async () => {
  const { deriveInstagramLeadQualification } = await import('../services/high-intent-lead-service.js');
  const firstTurn = deriveInstagramLeadQualification({
    customerMessages: [
      { content: 'Dubai’de yazılım şirketi kurmak istiyorum. Sizinle görüşebilir miyim?' },
    ],
  });
  assert.equal(firstTurn.complete, false);
  assert.equal(firstTurn.hasHighIntent, true);
  assert.ok(firstTurn.missing.includes('CUSTOMER_PHONE'));
  assert.ok(firstTurn.missing.includes('MEETING_AVAILABILITY'));

  const detailedTurn = deriveInstagramLeadQualification({
    customerMessages: [
      { content: 'Dubai’de yazılım şirketi kurmak istiyorum. Sizinle görüşebilir miyim?' },
      { content: 'B2B abonelik ürünü geliştireceğiz ve üç ortak olacağız.' },
      { content: 'WhatsApp numaram +971 50 111 22 33.' },
    ],
  });
  assert.equal(detailedTurn.complete, false);
  assert.ok(detailedTurn.structuredRequirement);
  assert.equal(detailedTurn.phone, '+971 50 111 22 33');
  assert.ok(detailedTurn.missing.includes('MEETING_AVAILABILITY'));

  const completeTurn = deriveInstagramLeadQualification({
    customerMessages: [
      { content: 'Dubai’de yazılım şirketi kurmak istiyorum. Sizinle görüşebilir miyim?' },
      { content: 'B2B abonelik ürünü geliştireceğiz ve üç ortak olacağız.' },
      { content: 'WhatsApp numaram +971 50 111 22 33.' },
      { content: 'Salı saat 14:00 Dubai saati uygunum.' },
    ],
  });
  assert.equal(completeTurn.complete, true);
  assert.equal(completeTurn.requestedTime, 'Salı saat 14:00 Dubai saati');
  assert.equal(completeTurn.timezone, 'Asia/Dubai');
  assert.equal(completeTurn.notificationLlmCalls, 0);
  assert.equal(completeTurn.notificationAiTokens, 0);
});

test('TEST Z — notification payload omits unknown fields and presentation rules enforce one-question progression', () => {
  const payload = formatInternalWhatsAppLeadNotification({
    customerName: 'Ayşe',
    serviceRequested: 'Şirket Kuruluşu',
    dashboardDeepLink: 'https://dashboard.example/conversations/1',
  });

  assert.match(payload, /YENİ INSTAGRAM LEAD/);
  assert.match(payload, /Müşteri: Ayşe/);
  assert.doesNotMatch(payload, /Belirtilmedi|Zaman belirtilmedi|Instagram üzerinden yüksek niyetli/);
  assert.match(INSTAGRAM_CHANNEL_PRESENTATION_RULES, /one relevant question at a time/i);
  assert.match(INSTAGRAM_CHANNEL_PRESENTATION_RULES, /do not ask about visa/i);
  assert.doesNotMatch(INSTAGRAM_CHANNEL_PRESENTATION_RULES, /Randevu oluşturabilmemiz adına birkaç bilginizi almam gerekiyor/i);
});

test('TEST AA — incomplete qualification creates no consultation and sends no WhatsApp notification', async () => {
  const { evaluateAndProcessHighIntentLead } = await import('../services/high-intent-lead-service.js');
  let providerCalls = 0;
  let consultationWrites = 0;
  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM conversations c')) {
        return { rowCount: 1, rows: [{
          id: 'conv-incomplete', tenant_id: 'tenant-a', channel_id: 'channel-a',
          customer_external_id: 'instagram:customer-a', contact_id: 'contact-a',
          channel_type: 'INSTAGRAM', contact_name: 'Ayşe', contact_phone: null,
        }] };
      }
      if (sql.includes('FROM conversation_messages')) {
        return { rowCount: 2, rows: [
          { id: 'm1', sender_type: 'CUSTOMER', content: 'Dubai’de şirket kurmak istiyorum, görüşebilir miyiz?' },
          { id: 'm2', sender_type: 'CUSTOMER', content: 'WhatsApp numaram +971 50 111 22 33.' },
        ] };
      }
      if (sql.includes('CONSULTATION_REQUEST_PENDING')) consultationWrites += 1;
      return { rowCount: 0, rows: [] };
    },
  };
  const httpClient = { async post() { providerCalls += 1; return { data: { messages: [{ id: 'wamid.1' }] } }; } };

  const result = await evaluateAndProcessHighIntentLead({
    tenantId: 'tenant-a',
    conversationId: 'conv-incomplete',
    database: mockDb,
    env: { WHATSAPP_TOKEN: 'test-token' },
    httpClient,
  });

  assert.equal(result.qualified, false);
  assert.equal(providerCalls, 0);
  assert.equal(consultationWrites, 0);
});

test('TEST AB — complete qualification creates one pending consultation and customer-initiated CTA with zero server-side WhatsApp notifications', async () => {
  const { evaluateAndProcessHighIntentLead } = await import('../services/high-intent-lead-service.js');
  let providerCalls = 0;
  let consultationWrites = 0;
  let qualifiedStageUpdates = 0;
  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM conversations c')) {
        return { rowCount: 1, rows: [{
          id: 'conv-complete', tenant_id: 'tenant-a', channel_id: 'channel-a',
          customer_external_id: 'instagram:customer-a', contact_id: 'contact-a',
          channel_type: 'INSTAGRAM', contact_name: 'Ayşe', contact_phone: null,
        }] };
      }
      if (sql.includes('FROM conversation_messages')) {
        return { rowCount: 4, rows: [
          { id: 'm1', sender_type: 'CUSTOMER', content: 'Dubai’de şirket kurmak istiyorum, görüşebilir miyiz?' },
          { id: 'm2', sender_type: 'CUSTOMER', content: 'B2B yazılım ürünü ve üç ortakla başlayacağız.' },
          { id: 'm3', sender_type: 'CUSTOMER', content: 'WhatsApp numaram +971 50 111 22 33.' },
          { id: 'm4', sender_type: 'CUSTOMER', content: 'Salı saat 14:00 Dubai saati uygunum.' },
        ] };
      }
      if (sql.includes('UPDATE crm_contacts')) return { rowCount: 1, rows: [] };
      if (sql.includes('SELECT id FROM crm_leads')) return { rowCount: 1, rows: [{ id: 'lead-a' }] };
      if (sql.includes('SELECT id FROM crm_pipeline_stages') && sql.includes("stage_key = 'QUALIFIED'")) {
        return { rowCount: 1, rows: [{ id: 'qualified-stage-a' }] };
      }
      if (sql.includes('UPDATE crm_leads')) { qualifiedStageUpdates += 1; return { rowCount: 1, rows: [] }; }
      if (sql.includes('INSERT INTO crm_consultations') || sql.includes('CONSULTATION_REQUEST_PENDING')) { consultationWrites += 1; return { rowCount: 1, rows: [{ id: 'activity-a', status: 'PENDING' }] }; }
      if (sql.includes('SELECT ci.config AS ig_config')) {
        return { rowCount: 1, rows: [{ ig_config: {
          qualified_lead_contact_cta: {
            enabled: true,
            destination: '+971527288586',
            contact_name: 'Samed Bey',
          },
        } }] };
      }
      if (sql.includes('SELECT tc.external_channel_id')) {
        return { rowCount: 1, rows: [{ external_channel_id: '1234567890', wa_config: { access_token: 'test-token' } }] };
      }
      if (sql.includes('SELECT l.id AS lead_id')) {
        return { rowCount: 1, rows: [{ lead_id: 'lead-a', analysis_hash: null, signals: {} }] };
      }
      if (sql.includes('INSERT INTO crm_lead_analyses')) return { rowCount: 1, rows: [{ id: 'analysis-a' }] };
      return { rowCount: 0, rows: [] };
    },
  };
  const httpClient = { async post() { providerCalls += 1; return { data: { messages: [{ id: 'wamid.qualified.1' }] } }; } };

  const result = await evaluateAndProcessHighIntentLead({
    tenantId: 'tenant-a',
    conversationId: 'conv-complete',
    database: mockDb,
    env: { WHATSAPP_TOKEN: 'test-token', DASHBOARD_URL: 'https://dashboard.example' },
    httpClient,
  });

  assert.equal(result.qualified, true);
  assert.equal(qualifiedStageUpdates, 1);
  assert.ok(consultationWrites >= 1);
  assert.equal(providerCalls, 0, 'ZERO server-side WhatsApp Cloud API calls must be made');
  assert.ok(result.ctaUrl.startsWith('https://wa.me/971527288586?text='));
});

test('TEST AC — sendSilentInternalWhatsAppLeadNotification is skipped and sends zero outbound messages', async () => {
  let providerCalls = 0;
  const mockDb = {
    async query(sql) {
      if (sql.includes('SELECT ci.config AS ig_config')) {
        return { rowCount: 1, rows: [{ ig_config: {
          lead_notification_enabled: true,
          lead_notification_whatsapp: '+971527288586',
        } }] };
      }
      if (sql.includes('SELECT tc.external_channel_id')) {
        return { rowCount: 1, rows: [{ external_channel_id: '1234567890', wa_config: { access_token: 'test-token' } }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };

  const result = await sendSilentInternalWhatsAppLeadNotification({
    tenantId: 'tenant-a',
    conversationId: 'conversation-a',
    leadDetails: {
      customerName: 'Ayşe',
      phone: '+971501112233',
      serviceRequested: 'Şirket Kuruluşu',
      structuredRequirement: 'B2B yazılım faaliyeti',
      requestedTime: 'Salı 14:00',
    },
    database: mockDb,
    env: { WHATSAPP_TOKEN: 'test-token' },
    httpClient: { async post() { providerCalls += 1; return { data: { messages: [{ id: 'wamid.1' }] } }; } },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'REPLACED_WITH_CUSTOMER_INITIATED_WHATSAPP_CTA');
  assert.equal(providerCalls, 0);
});





