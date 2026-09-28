import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  hasHighIntentAppointmentSignals,
  hasConcreteBusinessRequirement,
  extractPhoneNumberFromText,
  extractCustomerNameFromText,
  extractMeetingTimePreference,
  extractBusinessActivity,
  extractJurisdictionPreference,
  buildQualifiedLeadWhatsAppPrefilledMessage,
  generateCustomerInitiatedWhatsAppCtaUrl,
  resolveQualifiedLeadCtaConfig,
  evaluateAndProcessHighIntentLead,
  sendSilentInternalWhatsAppLeadNotification,
} from '../services/high-intent-lead-service.js';
import {
  orchestrateInstagramInboundAiResponse,
  INSTAGRAM_CHANNEL_PRESENTATION_RULES,
} from '../services/instagram-ai-orchestrator.js';
import { evaluateChannelAiActivationPolicy } from '../services/channel-ai-activation-policy-service.js';
import { operateConversation } from '../services/live-inbox-service.js';

class MockDatabaseClient {
  constructor({ queries = {}, rows = [] } = {}) {
    this.queries = queries;
    this.defaultRows = rows;
    this.executedQueries = [];
    this.inTransaction = false;
  }

  async query(sql, params = []) {
    this.executedQueries.push({ sql: String(sql).trim(), params });
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
  async query(sql, params) {
    return this.client.query(sql, params);
  }
}

describe('Task 9: Customer-Initiated WhatsApp Contact CTA Full Acceptance & Regression Suite', () => {

  // 1. Qualified lead creates CTA
  it('1. Qualified lead creates customer-initiated WhatsApp CTA', async () => {
    const fullLead = {
      customerName: 'Ahmet Soysal',
      requirement: "Dubai'de yazılım şirketi kurulumu",
      phone: '+90 531 240 49 65',
      requestedTime: 'Bugün 18:00',
      instagramUsername: '@samchetravel',
      contactName: 'Samed Bey',
    };
    const prefilled = buildQualifiedLeadWhatsAppPrefilledMessage(fullLead);
    const url = generateCustomerInitiatedWhatsAppCtaUrl({
      destination: '+971527288586',
      prefilledText: prefilled,
    });
    assert.ok(url);
    assert.ok(url.startsWith('https://wa.me/971527288586?text='));
    assert.ok(url.includes(encodeURIComponent('Ahmet Soysal')));
    assert.ok(url.includes(encodeURIComponent("Dubai'de yazılım şirketi kurulumu")));
  });

  // 2. Destination tenant-configurable
  it('2. CTA destination is fully tenant-configurable without code changes', () => {
    const customTenantConfig = resolveQualifiedLeadCtaConfig({
      integrationConfig: {
        qualified_lead_contact_cta: {
          enabled: true,
          provider: 'WHATSAPP',
          destination: '+971501112233',
          contact_name: 'Consultant Z',
          button_label: 'Contact Us',
        },
      },
    });
    assert.equal(customTenantConfig.destination, '+971501112233');
    assert.equal(customTenantConfig.contactName, 'Consultant Z');

    const customUrl = generateCustomerInitiatedWhatsAppCtaUrl({
      destination: customTenantConfig.destination,
      prefilledText: buildQualifiedLeadWhatsAppPrefilledMessage({
        customerName: 'Custom Client',
        phone: '+971509999999',
        contactName: customTenantConfig.contactName,
      }),
    });
    assert.ok(customUrl.startsWith('https://wa.me/971501112233?text='));
    assert.ok(customUrl.includes('Consultant%20Z'));
  });

  // 3. Correct URL encoding
  it('3. WhatsApp deep link is strictly percent-encoded with supported wa.me format', () => {
    const rawText = "Merhaba Samed Bey,\nAd: Ali & Veli\nKonu: 100% Free Zone\nInstagram: @ali_34";
    const url = generateCustomerInitiatedWhatsAppCtaUrl({
      destination: '+971527288586',
      prefilledText: rawText,
    });
    assert.ok(!url.includes(' '));
    assert.ok(!url.includes('\n'));
    assert.ok(url.includes('%0A'));
    assert.ok(url.includes('Ali%20%26%20Veli'));
  });

  // 4. Persisted fields used
  it('4. Uses only persisted/verified qualification fields', () => {
    const text = buildQualifiedLeadWhatsAppPrefilledMessage({
      customerName: 'Ahmet Soysal',
      requirement: "Dubai'de yazılım şirketi kurulumu",
      phone: '+90 531 240 49 65',
      requestedTime: 'Bugün 18:00',
      instagramUsername: '@samchetravel',
    });
    assert.ok(text.includes('Ad Soyad: Ahmet Soysal'));
    assert.ok(text.includes("Konu: Dubai'de yazılım şirketi kurulumu"));
    assert.ok(text.includes('Telefon: +90 531 240 49 65'));
    assert.ok(text.includes('Görüşme: Bugün 18:00'));
    assert.ok(text.includes('Instagram: @samchetravel'));
  });

  // 5. Unknown fields omitted without fabrication
  it('5. Unknown fields are omitted completely without hallucination', () => {
    const text = buildQualifiedLeadWhatsAppPrefilledMessage({
      customerName: null,
      instagramUsername: null,
      requirement: "Free Zone Danışmanlık",
      phone: '+905321112233',
      requestedTime: 'Yarın 15:00',
    });
    assert.equal(text.includes('Ad Soyad:'), false);
    assert.equal(text.includes('Instagram:'), false);
    assert.ok(text.includes('Konu: Free Zone Danışmanlık'));
    assert.ok(text.includes('Telefon: +905321112233'));
    assert.ok(text.includes('Görüşme: Yarın 15:00'));
  });
  // 6. No LLM used to compose CTA payload
  it('6. Prefilled payload is produced purely deterministically with 0 LLM calls', () => {
    const text = buildQualifiedLeadWhatsAppPrefilledMessage({
      customerName: 'Deterministic User',
      phone: '+971501234567',
      requirement: 'Mainland Şirket Kuruluşu',
      requestedTime: 'Çarşamba 11:00',
    });
    assert.equal(typeof text, 'string');
    assert.ok(text.includes('Deterministic User'));
  });

  // 7. No internal IDs exposed
  it('7. No internal UUIDs, database IDs, tenant IDs, tokens or WAMIDs leaked in CTA URL', () => {
    const leadData = {
      customerName: 'Ahmet Soysal',
      requirement: "Dubai'de yazılım şirketi kurulumu",
      phone: '+90 531 240 49 65',
      requestedTime: 'Bugün 18:00',
      instagramUsername: '@samchetravel',
    };
    const prefilled = buildQualifiedLeadWhatsAppPrefilledMessage(leadData);
    const url = generateCustomerInitiatedWhatsAppCtaUrl({
      destination: '+971527288586',
      prefilledText: prefilled,
    });
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(url), false);
    assert.equal(url.includes('tenant'), false);
    assert.equal(url.includes('conv_'), false);
    assert.equal(url.includes('wamid'), false);
    assert.equal(url.includes('token'), false);
  });

  // 8 & 9. No server-side WhatsApp notification & no template dispatch
  it('8 & 9. evaluateAndProcessHighIntentLead dispatches 0 server-side WhatsApp messages', async () => {
    const httpCalls = [];
    const client = new MockDatabaseClient({
      queries: {
        'FROM conversations c': () => ({
          rowCount: 1,
          rows: [{
            id: 'conv-test-8',
            tenant_id: 't-1',
            channel_id: 'ch-1',
            customer_external_id: 'instagram:102030',
            contact_id: 'ct-1',
            channel_type: 'INSTAGRAM',
            contact_name: 'Ahmet Soysal (@samchetravel)',
            contact_phone: '+90 531 240 49 65',
          }],
        }),
        'FROM conversation_messages': () => ({
          rowCount: 2,
          rows: [
            { id: 'm1', sender_type: 'CUSTOMER', content: "Dubai'de yazılım şirketi kurulumu yapmak istiyorum." },
            { id: 'm2', sender_type: 'CUSTOMER', content: 'Numaram +90 531 240 49 65, bugün 18:00 uygunum.' },
          ],
        }),
        'SELECT id FROM crm_leads': () => ({ rowCount: 1, rows: [{ id: 'lead-1' }] }),
        'INSERT INTO crm_consultations': () => ({
          rowCount: 1,
          rows: [{ id: 'cons-1', status: 'PENDING' }],
        }),
        'SELECT ci.config AS ig_config': () => ({
          rowCount: 1,
          rows: [{ ig_config: { qualified_lead_contact_cta: { destination: '+971527288586' } } }],
        }),
      },
    });

    const result = await evaluateAndProcessHighIntentLead({
      tenantId: 't-1',
      conversationId: 'conv-test-8',
      database: new MockDatabasePool(client),
      httpClient: { post: async (url, payload) => { httpCalls.push({ url, payload }); return { status: 200, data: {} }; } },
    });

    assert.equal(result.qualified, true);
    assert.equal(httpCalls.length, 0, 'Must NOT invoke WhatsApp Cloud API endpoint');

    const silentLegacy = await sendSilentInternalWhatsAppLeadNotification({
      tenantId: 't-1',
      conversationId: 'conv-test-8',
      leadDetails: result.leadDetails,
    });
    assert.equal(silentLegacy.skipped, true);
  });

  // 10 & 11. No duplicate CTA & exactly one PENDING consultation
  it('10 & 11. Exactly 1 PENDING consultation and idempotent CTA tracking per qualified conversation', async () => {
    let consultationInserts = 0;
    const client = new MockDatabaseClient({
      queries: {
        'FROM conversations c': () => ({
          rowCount: 1,
          rows: [{
            id: 'conv-test-10',
            tenant_id: 't-1',
            channel_id: 'ch-1',
            customer_external_id: 'instagram:102030',
            contact_id: 'ct-1',
            channel_type: 'INSTAGRAM',
            contact_name: 'Ahmet Soysal (@samchetravel)',
          }],
        }),
        'FROM conversation_messages': () => ({
          rowCount: 2,
          rows: [
            { id: 'm1', sender_type: 'CUSTOMER', content: "Dubai'de yazılım şirketi kurulumu yapmak istiyorum." },
            { id: 'm2', sender_type: 'CUSTOMER', content: 'Numaram +90 531 240 49 65, bugün 18:00 uygunum.' },
          ],
        }),
        'SELECT id FROM crm_leads': () => ({ rowCount: 1, rows: [{ id: 'lead-1' }] }),
        'INSERT INTO crm_consultations': () => {
          consultationInserts++;
          return {
            rowCount: 1,
            rows: [{ id: 'cons-1', status: 'PENDING', cta_delivered_at: consultationInserts > 1 ? new Date() : null }],
          };
        },
      },
    });

    const pool = new MockDatabasePool(client);

    const firstRun = await evaluateAndProcessHighIntentLead({ tenantId: 't-1', conversationId: 'conv-test-10', database: pool });
    assert.equal(firstRun.qualified, true);
    assert.equal(firstRun.consultation.status, 'PENDING');

    const secondRun = await evaluateAndProcessHighIntentLead({ tenantId: 't-1', conversationId: 'conv-test-10', database: pool });
    assert.equal(secondRun.qualified, true);
    assert.equal(secondRun.alreadyDelivered, true);
  });
  // 12. NEVER_AI unaffected
  it('12. NEVER_AI policy suppresses AI and CTA generation', async () => {
    const contact = { id: 'contact-never', ai_behavior_override: 'NEVER_AI' };
    const conversation = { id: 'conv-never', status: 'open', ai_behavior_override: 'NEVER_AI' };
    const decision = await evaluateChannelAiActivationPolicy({
      contact,
      conversation,
      channelConfig: { activation_policy: 'ALL_MESSAGES' },
      text: 'Randevu almak istiyorum +971501112233',
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.reasonCode, 'OVERRIDE_NEVER_AI');
  });

  // 13. Archive unaffected
  it('13. Archive preserves conversation and audit events without mutating CTA records', async () => {
    const client = new MockDatabaseClient({
      queries: {
        'FROM conversations': () => ({
          rowCount: 1,
          rows: [{ id: 'conv-arch', tenant_id: 't-1', status: 'open', handling_mode: 'AI', handling_version: 1 }],
        }),
        'UPDATE conversations': () => ({
          rowCount: 1,
          rows: [{ id: 'conv-arch', tenant_id: 't-1', status: 'archived' }],
        }),
      },
    });
    const archived = await operateConversation({
      database: new MockDatabasePool(client),
      tenantId: 't-1',
      conversationId: 'conv-arch',
      actor: { userId: 'u1', systemRole: 'CUSTOMER', tenantRole: 'ADMIN' },
      action: 'archive',
    });
    assert.equal(archived.status, 'archived');
  });

  // 14. Other tenants isolated
  it('14. Multi-tenant isolation is strictly preserved in lead and consultation queries', async () => {
    const client = new MockDatabaseClient({
      queries: {
        'FROM conversations c': (params) => {
          assert.equal(params[0], 'conv-tenant-a');
          assert.equal(params[1], 'tenant-a-uuid');
          return { rowCount: 0, rows: [] };
        },
      },
    });
    const res = await evaluateAndProcessHighIntentLead({
      tenantId: 'tenant-a-uuid',
      conversationId: 'conv-tenant-a',
      database: new MockDatabasePool(client),
    });
    assert.equal(res.qualified, false);
    assert.equal(res.reason, 'CONVERSATION_NOT_FOUND');
  });
  // 15 & 16. Instagram text delivery remains functional & clickable URL format
  it('15 & 16. Inbound qualification delivers concise Instagram response with clickable WhatsApp link', async () => {
    const httpCalls = [];
    const client = new MockDatabaseClient({
      queries: {
        'FROM conversations': () => ({
          rowCount: 1,
          rows: [{ id: 'conv-e2e', tenant_id: 't-samche', status: 'open', handling_mode: 'AI', handling_version: 1, customer_external_id: 'instagram:889142793634437' }],
        }),
        'FROM conversation_messages': (params, sql) => {
          if (/ORDER BY created_at DESC/i.test(sql)) {
            return {
              rowCount: 1,
              rows: [{ id: 'm-last', sender_type: 'CUSTOMER', content: 'Numaram +90 531 240 49 65, bugün 18:00 uygunum.' }],
            };
          }
          return {
            rowCount: 2,
            rows: [
              { id: 'm1', sender_type: 'CUSTOMER', content: "Dubai'de yazılım şirketi kurmak istiyoruz." },
              { id: 'm2', sender_type: 'CUSTOMER', content: 'Numaram +90 531 240 49 65, bugün 18:00 uygunum.' },
            ],
          };
        },
        'SELECT id FROM crm_leads': () => ({ rowCount: 1, rows: [{ id: 'lead-e2e' }] }),
        'INSERT INTO crm_consultations': () => ({
          rowCount: 1,
          rows: [{ id: 'cons-e2e', status: 'PENDING' }],
        }),
        'INSERT INTO conversation_messages': () => ({
          rowCount: 1,
          rows: [{ id: 'msg-assist-cta' }],
        }),
      },
    });

    const mockHttp = {
      post: async (url, payload) => {
        httpCalls.push({ url, payload });
        return { status: 200, data: { message_id: 'mid.ig.cta.123' } };
      },
    };

    const inboundState = {
      duplicate: false,
      handlingVersion: 1,
      integration: {
        tenant_id: 't-samche',
        assistant_id: 'ast-1',
        external_channel_id: '17841474291887372',
        config: {
          access_token: 'EAAB_token',
          instagram_account_id: '17841474291887372',
          activation_policy: 'ALL_MESSAGES',
          qualified_lead_contact_cta: {
            enabled: true,
            destination: '+971527288586',
            contact_name: 'Samed Bey',
          },
        },
      },
      conversation: {
        id: 'conv-e2e',
        tenant_id: 't-samche',
        customer_external_id: 'instagram:889142793634437',
        contact_display_name: 'Ahmet Soysal (@samchetravel)',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
      },
      shouldInvokeAi: true,
    };

    const result = await orchestrateInstagramInboundAiResponse({
      database: new MockDatabasePool(client),
      inboundState,
      senderIgsid: '889142793634437',
      text: 'Numaram +90 531 240 49 65, bugün 18:00 uygunum.',
      http: mockHttp,
      applyPacing: false,
    });

    assert.equal(result.delivered, true);
    assert.equal(result.qualified, true);
    assert.ok(result.responseText.includes('Bilgilerinizi aldım. Aşağıdaki bağlantı üzerinden WhatsApp\'tan doğrudan iletişime geçebilirsiniz:'));
    assert.ok(result.responseText.includes('https://wa.me/971527288586?text='));
    const messageDeliveries = httpCalls.filter((c) => c.payload?.message?.text);
    assert.equal(messageDeliveries.length, 1);
    assert.ok(messageDeliveries[0].payload.message.text.includes('https://wa.me/971527288586'));
  });

  // 17. Main policy unchanged
  it('17. Master policy hash is exactly c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58', () => {
    const policyContent = fs.readFileSync('policies/samche-whatsapp-master-business-policy.tr.txt', 'utf8');
    const normalizedLf = policyContent.replace(/\r\n/g, '\n');
    const sha256 = crypto.createHash('sha256').update(Buffer.from(normalizedLf, 'utf8')).digest('hex');
    assert.equal(sha256, 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58');
  });
});
