process.env.DATABASE_URL ||= 'postgres://invalid:invalid@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret';

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  orchestrateInstagramInboundAiResponse,
  formatInstagramDmResponse,
  INSTAGRAM_CHANNEL_PRESENTATION_RULES,
} from '../services/instagram-ai-orchestrator.js';
import {
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
  SAMCHE_CANONICAL_MASTER_POLICY_HASH,
} from '../services/samche-canonical-knowledge-data.js';

const tenantId = 'b85d7e7b-d52e-4541-92e7-284a6a67024b';
const conversationId = '22222222-2222-4222-8222-222222222222';
const channelId = '33333333-3333-4333-8333-333333333333';
const assistantId = '44444444-4444-4444-8444-444444444444';
const testIgsid = '8891427900000001';
const testPageId = '17841400000000001';

function createMockDb({ messages = [] } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes('FROM conversations')) {
        return {
          rows: [{
            id: conversationId,
            tenant_id: tenantId,
            channel_id: channelId,
            status: 'open',
            handling_mode: 'AI',
            handling_version: 1,
            communication_language: 'tr',
            ai_behavior_override: 'AI_ONLY',
          }],
        };
      }
      if (sql.includes('FROM conversation_messages')) {
        return { rows: messages };
      }
      if (sql.includes('INSERT INTO conversation_messages') || sql.includes('UPDATE conversation_messages')) {
        return { rows: [{ id: 'msg-out-1', sender_type: 'ASSISTANT' }] };
      }
      return { rows: [] };
    },
    async connect() { return this; },
    release() {},
  };
}

const defaultInboundState = Object.freeze({
  integration: {
    tenant_id: tenantId,
    channel_id: channelId,
    assistant_id: assistantId,
    external_channel_id: testPageId,
    config: {
      access_token: 'test-token',
      page_id: testPageId,
      instagram_business_account_id: testPageId,
      activation_policy: 'MANUAL_ONLY',
    },
  },
  conversation: {
    id: conversationId,
    status: 'open',
    handling_mode: 'AI',
    handling_version: 1,
    communication_language: 'tr',
    ai_behavior_override: 'AI_ONLY',
  },
  shouldInvokeAi: true,
  handlingVersion: 1,
});

// ---------------------------------------------------------------------------
// TEST A — COMPANY FORMATION
// ---------------------------------------------------------------------------
test('TEST A: Company formation inquiry discusses setup and 8.000 AED consultancy with Bank & KYC without 13.000 AED residency', async () => {
  const outboundDMs = [];
  const fakeHttp = {
    async post(url, body) {
      outboundDMs.push(body);
      return { data: { recipient_id: testIgsid, message_id: 'mid.a.1' } };
    },
  };

  let capturedSystemInstruction = '';
  const outcome = await orchestrateInstagramInboundAiResponse({
    database: createMockDb(),
    inboundState: defaultInboundState,
    senderIgsid: testIgsid,
    text: "Dubai'de e-ticaret şirketi kuracağım, maliyeti ne olur?",
    http: fakeHttp,
    generateAiResponse: async ({ systemInstruction }) => {
      capturedSystemInstruction = systemInstruction;
      return [
        "Dubai'de e-ticaret şirketi kurarken maliyetler seçeceğiniz serbest bölgeye (Free Zone) ve vize ihtiyacınıza göre değişiklik gösterir.",
        "",
        "Ana maliyet kalemleri:",
        "",
        "• Resmi Şirket Lisansı: Faaliyet alanı ve vize sayısına göre belirlenir.",
        "• SamChe Danışmanlık Ücreti: 8.000 AED'dir. Şirket banka hesabı açılışı ve KYC desteği bu ücrete dahildir.",
        "",
        "Net maliyetinizi belirleyebilmemiz için kaç adet oturum vizesine ihtiyacınız olacağını öğrenebilir miyim?",
      ].join('\n');
    },
  });

  assert.equal(outcome.delivered, true);
  assert.ok(outcome.responseText.includes('8.000 AED') || outcome.responseText.includes('8000 AED'));
  assert.ok(outcome.responseText.includes('banka') && outcome.responseText.includes('KYC'));
  assert.ok(!outcome.responseText.includes('13.000 AED'));
  assert.ok(!outcome.responseText.includes('13000 AED'));
  assert.ok(!outcome.responseText.includes('Sponsorlu Oturum'));
  assert.ok(capturedSystemInstruction.includes('NEVER mention or introduce the 13.000 AED Sponsored Residency package when the customer asks about company formation'));
});

// ---------------------------------------------------------------------------
// TEST B — CONSULTANCY FEE
// ---------------------------------------------------------------------------
test('TEST B: Direct consultancy fee inquiry returns 8.000 AED with Bank/KYC included and no unsolicited visa packages', async () => {
  const fakeHttp = {
    async post() {
      return { data: { recipient_id: testIgsid, message_id: 'mid.b.1' } };
    },
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: createMockDb(),
    inboundState: defaultInboundState,
    senderIgsid: testIgsid,
    text: "Danışmanlık ücretiniz ne kadar?",
    http: fakeHttp,
    generateAiResponse: async () => {
      return "Danışmanlık ücretimiz 8.000 AED'dir. Şirket banka hesabı açılışı ve KYC desteği bu ücrete dahildir.";
    },
  });

  assert.equal(outcome.delivered, true);
  assert.ok(outcome.responseText.includes('8.000 AED') || outcome.responseText.includes('8000 AED'));
  assert.ok(outcome.responseText.includes('banka') && outcome.responseText.includes('KYC'));
  assert.ok(!outcome.responseText.includes('13.000 AED'));
  assert.ok(!outcome.responseText.includes('16.800 AED'));
  assert.ok(!outcome.responseText.includes('Freelance'));
});

// ---------------------------------------------------------------------------
// TEST C — SPONSORED RESIDENCY (EXPLICIT INQUIRY)
// ---------------------------------------------------------------------------
test('TEST C: Explicit sponsored residency inquiry correctly discloses 13.000 AED residency solution', async () => {
  const fakeHttp = {
    async post() {
      return { data: { recipient_id: testIgsid, message_id: 'mid.c.1' } };
    },
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: createMockDb(),
    inboundState: defaultInboundState,
    senderIgsid: testIgsid,
    text: "Şirket kurmadan Dubai'de yaşamak istiyorum. Sponsorlu oturum vizesi ücretiniz ne kadar?",
    http: fakeHttp,
    generateAiResponse: async () => {
      return [
        "Şirket kurmadan Dubai'de yaşamak ve çalışmak için 2 yıllık sponsorlu oturum çözümü sunuyoruz.",
        "",
        "İki yıllık sponsorlu oturum toplam ücreti 13.000 AED'dir.",
        "",
        "Ödeme aşamaları:",
        "• 1. Ödeme: 4.000 AED (Kota rezervasyonu ve dosya açılışı)",
        "• 2. Ödeme: 8.000 AED (Employment Visa / E-vize)",
        "• 3. Ödeme: 1.000 AED (Emirates ID ve damgalama)",
      ].join('\n');
    },
  });

  assert.equal(outcome.delivered, true);
  assert.ok(outcome.responseText.includes('13.000 AED'));
  assert.ok(outcome.responseText.includes('4.000 AED'));
});
// ---------------------------------------------------------------------------
// TEST D — FREE ZONE VS MAINLAND
// ---------------------------------------------------------------------------
test('TEST D: Free Zone vs Mainland comparison answers structure differences without residency pricing leak', async () => {
  const fakeHttp = {
    async post() {
      return { data: { recipient_id: testIgsid, message_id: 'mid.d.1' } };
    },
  };

  const outcome = await orchestrateInstagramInboundAiResponse({
    database: createMockDb(),
    inboundState: defaultInboundState,
    senderIgsid: testIgsid,
    text: "Free Zone mu Mainland mi benim için daha uygun?",
    http: fakeHttp,
    generateAiResponse: async () => {
      return [
        "İki yapı arasındaki temel farklar faaliyet alanınıza ve pazar hedefinize bağlıdır:",
        "",
        "Free Zone:",
        "• %100 yabancı mülkiyet sunar.",
        "• Uluslararası ticaret, yazılım ve e-ticaret için uygundur.",
        "",
        "Mainland:",
        "• BAE yerel pazarına doğrudan satış yapma esnekliği sağlar.",
        "• Fiziksel mağaza veya yerel operasyon gerektiren sektörler için uygundur.",
        "",
        "Hangi sektörde faaliyet göstermeyi planlıyorsunuz?",
      ].join('\n');
    },
  });

  assert.equal(outcome.delivered, true);
  assert.ok(outcome.responseText.includes('Free Zone:'));
  assert.ok(outcome.responseText.includes('Mainland:'));
  assert.ok(!outcome.responseText.includes('13.000 AED'));
  assert.ok(!outcome.responseText.includes('Sponsorlu Oturum'));
});

// ---------------------------------------------------------------------------
// TEST E — MULTI-TURN CONVERSATION
// ---------------------------------------------------------------------------
test('TEST E: Multi-turn: Turn 1 is company formation only; Turn 2 explicitly requests residency', async () => {
  const fakeHttp = {
    async post() {
      return { data: { recipient_id: testIgsid, message_id: 'mid.e.1' } };
    },
  };

  // Turn 1: Company formation
  const turn1Outcome = await orchestrateInstagramInboundAiResponse({
    database: createMockDb(),
    inboundState: defaultInboundState,
    senderIgsid: testIgsid,
    text: "Dubai'de şirket açmak istiyorum.",
    http: fakeHttp,
    generateAiResponse: async () => {
      return "Dubai'de şirket kurulumunda Free Zone ve Mainland seçenekleri mevcuttur. Hangi sektörde faaliyet göstereceksiniz?";
    },
  });

  assert.equal(turn1Outcome.delivered, true);
  assert.ok(!turn1Outcome.responseText.includes('13.000 AED'));

  // Turn 2: Customer now explicitly asks about residency
  const mockDbTurn2 = createMockDb({
    messages: [
      { id: 'msg-1', sender_type: 'CUSTOMER', content: "Dubai'de şirket açmak istiyorum." },
      { id: 'msg-2', sender_type: 'ASSISTANT', content: turn1Outcome.responseText },
      { id: 'msg-3', sender_type: 'CUSTOMER', content: "Peki oturum da istiyorum, şirket kurmadan oturum alabilir miyim?" },
    ],
  });

  const turn2Outcome = await orchestrateInstagramInboundAiResponse({
    database: mockDbTurn2,
    inboundState: defaultInboundState,
    senderIgsid: testIgsid,
    text: "Peki oturum da istiyorum, şirket kurmadan oturum alabilir miyim?",
    http: fakeHttp,
    generateAiResponse: async () => {
      return "Evet, şirket kurmadan 2 yıllık sponsorlu oturum vizesi alabilirsiniz. Toplam ücret 13.000 AED'dir.";
    },
  });

  assert.equal(turn2Outcome.delivered, true);
  // In Turn 2, since user explicitly asked, residency information is now provided
  assert.ok(turn2Outcome.responseText.includes('13.000 AED'));
});

// ---------------------------------------------------------------------------
// TEST F — WHATSAPP PARITY & POLICY INTEGRITY
// ---------------------------------------------------------------------------
test('TEST F: Authoritative WhatsApp master policy file exists and matches canonical hash', () => {
  const policyPath = 'policies/samche-whatsapp-master-business-policy.tr.txt';
  assert.ok(fs.existsSync(policyPath), 'Policy file must exist');

  const content = fs.readFileSync(policyPath, 'utf8');
  const actualHash = createHash('sha256').update(content).digest('hex');

  // Verify hash matches canonical hash without unauthorized mutation
  assert.equal(actualHash, SAMCHE_CANONICAL_MASTER_POLICY_HASH, 'Authoritative master policy hash must match exactly');

  // Verify the three business rules are present in the authoritative file
  assert.ok(content.includes('8.000 AED'), '8.000 AED consultancy fee rule must be in policy');
  assert.ok(content.includes('banka hesap açılışı ve KYC desteğinin dahil olduğunu'), 'Bank & KYC inclusion rule must be in policy');
  assert.ok(content.includes('Aşağıda verilen TÜM hazır cevapları sadece kullanıcı mesajı açıkça bu konuyu sorarsa kullan'), 'Intent gating rule must be in policy');
});

