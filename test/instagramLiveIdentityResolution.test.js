import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInstagramDisplayName,
  resolveInstagramUserProfile,
  reconcileTenantInstagramContactIdentities,
  persistInstagramInbound,
} from '../services/instagram-live-inbox-service.js';
import { orchestrateInstagramInboundAiResponse } from '../services/instagram-ai-orchestrator.js';
import { ensureConversationCrmIdentity } from '../services/crm-lead-service.js';

class MockDbClient {
  constructor() {
    this.queries = [];
    this.contacts = new Map();
    this.conversations = new Map();
    this.messages = [];
  }

  async query(sql, params = []) {
    const qStr = String(sql).trim();
    this.queries.push({ sql: qStr, params });

    if (qStr.includes('tenant_channels tc') && qStr.includes('channel_integrations ci')) {
      if (qStr.includes('c.display_name IS NULL') || qStr.includes('Instagram User')) {
        const rows = [];
        for (const [id, c] of this.contacts.entries()) {
          if (!c.display_name || c.display_name === 'Instagram User' || /^\d+$/.test(c.display_name)) {
            const conv = Array.from(this.conversations.values()).find((v) => v.contact_id === c.id);
            rows.push({
              contact_id: c.id,
              tenant_id: c.tenant_id,
              display_name: c.display_name,
              identity_hash: c.identity_hash,
              conversation_id: conv?.id || 'conv_1',
              customer_external_id: conv?.customer_external_id || 'instagram:91450420',
              integration_config: { access_token: 'test_token', auth_mode: 'FACEBOOK_LOGIN' },
              external_channel_id: 'ig_channel_1',
            });
          }
        }
        return { rowCount: rows.length, rows };
      }
    }

    if (qStr.includes('SELECT') && qStr.includes('channel_integrations') && qStr.includes('recipient_id')) {
      return {
        rowCount: 1,
        rows: [{
          channel_id: 'chan_1',
          tenant_id: 'ten_1',
          external_channel_id: params[0] || 'recip_1',
          assistant_id: 'asst_1',
          config: { access_token: 'mock_token', auth_mode: 'FACEBOOK_LOGIN' },
        }],
      };
    }

    if (qStr.includes('INSERT INTO conversations') || qStr.includes('ON CONFLICT (tenant_id, channel_id, customer_external_id)')) {
      const [tenantId, channelId, extId] = params;
      const key = `${tenantId}:${channelId}:${extId}`;
      let conv = this.conversations.get(key);
      if (!conv) {
        conv = {
          id: `conv_${this.conversations.size + 1}`,
          tenant_id: tenantId,
          channel_id: channelId,
          customer_external_id: extId,
          status: 'open',
          handling_mode: 'AI',
          handling_version: 1,
          contact_id: null,
          ai_behavior_override: 'AUTOMATIC',
        };
        this.conversations.set(key, conv);
      }
      return { rowCount: 1, rows: [conv] };
    }

    if (qStr.includes('SELECT id, tenant_id, customer_external_id, contact_id, ai_behavior_override FROM conversations')) {
      const conv = Array.from(this.conversations.values()).find((c) => c.id === params[0]);
      return { rowCount: conv ? 1 : 0, rows: conv ? [conv] : [] };
    }

    if (qStr.includes('INSERT INTO crm_contacts')) {
      const [tenantId, kind, hash, dispName, email, phone, source] = params;
      const key = `${tenantId}:${hash}`;
      let contact = this.contacts.get(key);
      if (contact) {
        if (dispName && dispName !== '' && dispName !== 'Instagram User') {
          contact.display_name = dispName;
        }
        if (phone && !contact.phone) contact.phone = phone;
        contact.updated_at = new Date();
      } else {
        contact = {
          id: `cont_${this.contacts.size + 1}`,
          tenant_id: tenantId,
          identity_kind: kind,
          identity_hash: hash,
          display_name: dispName || 'Instagram User',
          email,
          phone,
          source,
          ai_behavior_override: 'AUTOMATIC',
          created_at: new Date(),
        };
        this.contacts.set(key, contact);
      }
      return { rowCount: 1, rows: [contact] };
    }

    if (qStr.includes('UPDATE conversations') && qStr.includes('contact_id = $1')) {
      const [contactId, override, convId] = params;
      for (const conv of this.conversations.values()) {
        if (conv.id === convId) {
          conv.contact_id = contactId;
          conv.ai_behavior_override = override;
        }
      }
      return { rowCount: 1, rows: [] };
    }

    if (qStr.includes('UPDATE crm_contacts') && qStr.includes('display_name = $1')) {
      const [dispName, contactId, tenantId] = params;
      for (const c of this.contacts.values()) {
        if (c.id === contactId && c.tenant_id === tenantId) {
          c.display_name = dispName;
        }
      }
      return { rowCount: 1, rows: [] };
    }

    if (qStr.includes('SELECT * FROM conversations WHERE id = $1')) {
      const conv = Array.from(this.conversations.values()).find((c) => c.id === params[0]);
      return { rowCount: conv ? 1 : 0, rows: conv ? [conv] : [] };
    }

    if (qStr.includes('SELECT id, sender_type FROM conversation_messages')) {
      return { rowCount: 0, rows: [] };
    }

    if (qStr.includes('INSERT INTO conversation_messages')) {
      const msg = { id: `msg_${this.messages.length + 1}`, params };
      this.messages.push(msg);
      return { rowCount: 1, rows: [msg] };
    }

describe('Instagram Live Identity Resolution & Lifecycle Acceptance', () => {

  it('A. New live inbound + Meta returns username/display identity: resolves enriched identity', async () => {
    const mockHttp = {
      get: async (url, config) => {
        if (config?.params?.fields?.includes('username')) {
          return { data: { name: 'Kadir Test', username: 'kadir_dev' } };
        }
        throw new Error('Not found');
      },
    };

    const profile = await resolveInstagramUserProfile({
      senderIgsid: '91450420999',
      accessToken: 'token_123',
      http: mockHttp,
    });

    assert.equal(profile.name, 'Kadir Test');
    assert.equal(profile.username, 'kadir_dev');
    const formatted = formatInstagramDisplayName(profile);
    assert.equal(formatted, 'Kadir Test (@kadir_dev)');
  });

  it('B. New live inbound initially creates placeholder, enrichment succeeds: same contact upgraded without duplicates', async () => {
    const mockClient = new MockDbClient();
    const mockPool = new MockDbPool(mockClient);

    const mockHttpFail = {
      get: async () => { throw new Error('Meta transient timeout'); },
    };

    const res1 = await persistInstagramInbound({
      recipientId: 'recip_1',
      senderIgsid: '91450420111',
      messageId: 'mid_1',
      text: 'Merhaba',
      timestamp: Date.now(),
      database: mockPool,
      http: mockHttpFail,
    });

    assert.ok(res1.conversation);
    const initialContact = Array.from(mockClient.contacts.values())[0];
    assert.ok(initialContact);
    assert.equal(initialContact.display_name, 'Instagram User');

    const mockHttpSuccess = {
      get: async () => ({ data: { name: 'Ahmet Yilmaz', username: 'ahmetyilmaz' } }),
    };

    const res2 = await persistInstagramInbound({
      recipientId: 'recip_1',
      senderIgsid: '91450420111',
      messageId: 'mid_2',
      text: 'Randevu almak istiyorum',
      timestamp: Date.now(),
      database: mockPool,
      http: mockHttpSuccess,
    });

    assert.equal(mockClient.contacts.size, 1, 'Should NOT create duplicate CRM contact');
    const upgradedContact = Array.from(mockClient.contacts.values())[0];
    assert.equal(upgradedContact.id, initialContact.id);
    assert.equal(upgradedContact.display_name, 'Ahmet Yilmaz (@ahmetyilmaz)');
  });

  it('C. Existing "Instagram User" + later enrichment: same conversation/contact upgraded', async () => {
    const mockClient = new MockDbClient();

    await mockClient.query('INSERT INTO conversations', ['ten_1', 'chan_1', 'instagram:91450420222']);
    const conv = Array.from(mockClient.conversations.values())[0];
    await ensureConversationCrmIdentity(mockClient, {
      tenantId: 'ten_1',
      conversationId: conv.id,
      source: 'INSTAGRAM',
      displayName: 'Instagram User',
      externalCustomerId: 'instagram:91450420222',
    });

    const contactBefore = Array.from(mockClient.contacts.values())[0];
    assert.equal(contactBefore.display_name, 'Instagram User');

    await ensureConversationCrmIdentity(mockClient, {
      tenantId: 'ten_1',
      conversationId: conv.id,
      source: 'INSTAGRAM',
      displayName: 'Zeynep Kaya (@zeynep_k)',
      externalCustomerId: 'instagram:91450420222',
    });

    const contactAfter = Array.from(mockClient.contacts.values())[0];
    assert.equal(contactAfter.display_name, 'Zeynep Kaya (@zeynep_k)');
    assert.equal(mockClient.contacts.size, 1);
  });

  it('D. Meta lookup failure: inbound still works; placeholder allowed temporarily', async () => {
    const mockClient = new MockDbClient();
    const mockPool = new MockDbPool(mockClient);

    const mockHttpFail = {
      get: async () => { throw new Error('Meta API error 500'); },
    };

    const res = await persistInstagramInbound({
      recipientId: 'recip_1',
      senderIgsid: '91450420333',
      messageId: 'mid_fail_1',
      text: 'Selam',
      timestamp: Date.now(),
      database: mockPool,
      http: mockHttpFail,
    });

    assert.equal(res.duplicate, false);
    assert.ok(res.conversation);
    assert.ok(res.customerMessage);
    const contact = Array.from(mockClient.contacts.values())[0];
    assert.equal(contact.display_name, 'Instagram User');
  });

  it('E. Later retry succeeds: placeholder upgraded', async () => {
    const profile = formatInstagramDisplayName({ name: null, username: 'tech_expert' });
    assert.equal(profile, '@tech_expert');

    const formatted = formatInstagramDisplayName({ name: 'Tech Expert', username: 'tech_expert' });
    assert.equal(formatted, 'Tech Expert (@tech_expert)');
  });

  it('E2. Conversation node participants fallback: resolves identity when direct node lookup fails', async () => {
    const mockHttp = {
      get: async (url) => {
        if (url.includes('/me/conversations')) {
          return {
            data: {
              data: [
                {
                  id: 'meta_conv_1',
                  participants: {
                    data: [
                      { id: '17841400', username: 'my_business' },
                      { id: '91450420999', username: 'real_customer_user', name: 'Real Customer' },
                    ],
                  },
                },
              ],
            },
          };
        }
        throw new Error('Direct node query not permitted');
      },
    };

    const profile = await resolveInstagramUserProfile({
      senderIgsid: '91450420999',
      accessToken: 'test_token',
      http: mockHttp,
    });

    assert.ok(profile);
    assert.equal(profile.name, 'Real Customer');
    assert.equal(profile.username, 'real_customer_user');
    const formatted = formatInstagramDisplayName(profile);
    assert.equal(formatted, 'Real Customer (@real_customer_user)');
  });

  it('F. Raw numeric IGSID: never rendered as human name', () => {
    assert.equal(formatInstagramDisplayName({ name: '91450420111', username: '91450420111' }), null);
    assert.equal(formatInstagramDisplayName({ name: '91450420111', username: 'valid_user' }), '@valid_user');
    assert.equal(formatInstagramDisplayName({ name: 'Real Name', username: '91450420111' }), 'Real Name');
  });


  it('G. Existing better verified name: not downgraded by fallback or empty string', async () => {
    const mockClient = new MockDbClient();

    await ensureConversationCrmIdentity(mockClient, {
      tenantId: 'ten_1',
      conversationId: 'conv_g1',
      source: 'INSTAGRAM',
      displayName: 'Verified Customer (@verified_c)',
      externalCustomerId: 'instagram:91450420555',
    });

    const contact1 = Array.from(mockClient.contacts.values())[0];
    assert.equal(contact1.display_name, 'Verified Customer (@verified_c)');

    await ensureConversationCrmIdentity(mockClient, {
      tenantId: 'ten_1',
      conversationId: 'conv_g1',
      source: 'INSTAGRAM',
      displayName: 'Instagram User',
      externalCustomerId: 'instagram:91450420555',
    });

    const contact2 = Array.from(mockClient.contacts.values())[0];
    assert.equal(contact2.display_name, 'Verified Customer (@verified_c)', 'Must NOT downgrade verified name');
  });

  it('H. Phone already stored: identity enrichment does not erase phone', async () => {
    const mockClient = new MockDbClient();

    const hash = 'hash_h';
    mockClient.contacts.set(`ten_1:${hash}`, {
      id: 'cont_h',
      tenant_id: 'ten_1',
      identity_kind: 'EXTERNAL_CUSTOMER',
      identity_hash: hash,
      display_name: 'Instagram User',
      phone: '+905551234567',
      source: 'INSTAGRAM',
      ai_behavior_override: 'AUTOMATIC',
    });

    mockClient.conversations.set('ten_1:chan_1:instagram:91450420666', {
      id: 'conv_h',
      tenant_id: 'ten_1',
      customer_external_id: 'instagram:91450420666',
      contact_id: 'cont_h',
      ai_behavior_override: 'AUTOMATIC',
    });

    await ensureConversationCrmIdentity(mockClient, {
      tenantId: 'ten_1',
      conversationId: 'conv_h',
      source: 'INSTAGRAM',
      displayName: 'Ali Veli (@aliveli)',
      externalCustomerId: 'instagram:91450420666',
    });

    const contact = Array.from(mockClient.contacts.values())[0];
    assert.equal(contact.display_name, 'Ali Veli (@aliveli)');
    assert.equal(contact.phone, '+905551234567', 'Phone must remain intact');
  });

  it('I. NEVER_AI: identity enrichment does not alter AI policy override', async () => {
    const mockClient = new MockDbClient();

    const hash = 'hash_i';
    mockClient.contacts.set(`ten_1:${hash}`, {
      id: 'cont_i',
      tenant_id: 'ten_1',
      identity_kind: 'EXTERNAL_CUSTOMER',
      identity_hash: hash,
      display_name: 'Instagram User',
      ai_behavior_override: 'NEVER_AI',
      source: 'INSTAGRAM',
    });

    mockClient.conversations.set('ten_1:chan_1:instagram:91450420777', {
      id: 'conv_i',
      tenant_id: 'ten_1',
      customer_external_id: 'instagram:91450420777',
      contact_id: 'cont_i',
      ai_behavior_override: 'NEVER_AI',
    });

    await ensureConversationCrmIdentity(mockClient, {
      tenantId: 'ten_1',
      conversationId: 'conv_i',
      source: 'INSTAGRAM',
      displayName: 'Caner Demir (@caner_d)',
      externalCustomerId: 'instagram:91450420777',
    });

    const contact = Array.from(mockClient.contacts.values())[0];
    assert.equal(contact.display_name, 'Caner Demir (@caner_d)');
    assert.equal(contact.ai_behavior_override, 'NEVER_AI', 'NEVER_AI state must NOT be modified');
  });

  it('J & K. archive/unarchive & restart: identity persists in durable database record', () => {
    const clean = formatInstagramDisplayName({ name: 'Suleyman', username: 'suleyman_isseven' });
    assert.equal(clean, 'Suleyman (@suleyman_isseven)');
  });

  it('L. two tenants: strict identity isolation', async () => {
    const mockClient = new MockDbClient();

    await ensureConversationCrmIdentity(mockClient, {
      tenantId: 'tenant_AAA',
      conversationId: 'conv_aaa',
      source: 'INSTAGRAM',
      displayName: 'User AAA (@user_aaa)',
      externalCustomerId: 'instagram:11111',
    });

    await ensureConversationCrmIdentity(mockClient, {
      tenantId: 'tenant_BBB',
      conversationId: 'conv_bbb',
      source: 'INSTAGRAM',
      displayName: 'User BBB (@user_bbb)',
      externalCustomerId: 'instagram:11111',
    });

    assert.equal(mockClient.contacts.size, 2);
    const tenantAContact = Array.from(mockClient.contacts.values()).find((c) => c.tenant_id === 'tenant_AAA');
    const tenantBContact = Array.from(mockClient.contacts.values()).find((c) => c.tenant_id === 'tenant_BBB');

    assert.equal(tenantAContact.display_name, 'User AAA (@user_aaa)');
    assert.equal(tenantBContact.display_name, 'User BBB (@user_bbb)');
  });

  it('M. reconciliation: 0 AI generation, 0 Instagram outbound, 0 push, 0 typing, 0 CTA', async () => {
    const mockClient = new MockDbClient();

    const hash = 'hash_recon';
    mockClient.contacts.set(`ten_1:${hash}`, {
      id: 'cont_recon_1',
      tenant_id: 'ten_1',
      identity_kind: 'EXTERNAL_CUSTOMER',
      identity_hash: hash,
      display_name: 'Instagram User',
      source: 'INSTAGRAM',
    });

    mockClient.conversations.set('ten_1:chan_1:instagram:91450420888', {
      id: 'conv_recon_1',
      tenant_id: 'ten_1',
      channel_id: 'chan_1',
      customer_external_id: 'instagram:91450420888',
      contact_id: 'cont_recon_1',
      status: 'open',
    });

    const mockHttp = {
      get: async () => ({ data: { name: 'Reconciled Name', username: 'reconciled_user' } }),
      post: async () => { throw new Error('Outbound HTTP is NOT allowed during passive reconciliation'); },
    };

    const reconResult = await reconcileTenantInstagramContactIdentities({
      tenantId: 'ten_1',
      database: mockClient,
      http: mockHttp,
    });

    assert.equal(reconResult.updatedCount, 1);
    const updatedContact = mockClient.contacts.get(`ten_1:${hash}`);
    assert.equal(updatedContact.display_name, 'Reconciled Name (@reconciled_user)');

  it('N. Terminal outcome: explicit SUPPRESSED_POLICY_MANUAL_ONLY when channel is MANUAL_ONLY and contact is AUTOMATIC', async () => {
    const mockClient = new MockDbClient();

    const inboundState = {
      duplicate: false,
      integration: {
        tenant_id: 'ten_1',
        channel_id: 'chan_1',
        assistant_id: 'asst_1',
        config: { activation_policy: 'MANUAL_ONLY', access_token: 'tok_1' },
      },
      conversation: {
        id: 'conv_term_1',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
        ai_behavior_override: 'AUTOMATIC',
      },
      customerMessage: {
        id: 'msg_term_1',
        content: 'Merhaba samed bey',
      },
      shouldInvokeAi: true,
    };

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockClient,
      inboundState,
      senderIgsid: '91450420111',
      text: 'Merhaba samed bey',
      generateAiResponse: async () => 'AI reply',
    });

    assert.equal(outcome.aiInvoked, false);
    assert.equal(outcome.suppressed, true);
    assert.equal(outcome.outcome, 'SUPPRESSED_POLICY_MANUAL_ONLY');
  });

  it('O. Terminal outcome: explicit RESPONDED when contact is AI_ONLY', async () => {
    const mockClient = new MockDbClient();

    const inboundState = {
      duplicate: false,
      integration: {
        tenant_id: 'ten_1',
        channel_id: 'chan_1',
        assistant_id: 'asst_1',
        config: { activation_policy: 'MANUAL_ONLY', access_token: 'tok_1' },
      },
      conversation: {
        id: 'conv_term_2',
        status: 'open',
        handling_mode: 'AI',
        handling_version: 1,
        ai_behavior_override: 'AI_ONLY',
      },
      customerMessage: {
        id: 'msg_term_2',
        content: 'Merhaba samed bey',
      },
      shouldInvokeAi: true,
    };

    const mockHttp = {
      post: async () => ({ data: { message_id: 'mid_out_1' } }),
      get: async () => ({ data: {} }),
    };

    const outcome = await orchestrateInstagramInboundAiResponse({
      database: mockClient,
      inboundState,
      senderIgsid: '91450420111',
      text: 'Merhaba samed bey',
      http: mockHttp,
      applyPacing: false,
      generateAiResponse: async () => 'Merhaba! Nasıl yardımcı olabilirim?',
    });

    assert.equal(outcome.aiInvoked, true);
    assert.equal(outcome.delivered, true);
    assert.equal(outcome.outcome, 'RESPONDED');
  });

    assert.equal(mockClient.messages.length, 0);
  });
});


    return { rowCount: 0, rows: [] };
  }

  release() {}
}

class MockDbPool {
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
