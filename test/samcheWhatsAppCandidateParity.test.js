import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  buildWhatsAppTenantModelContext,
  canonicalizeSamcheWhatsAppPolicyNewlines,
} from '../services/whatsapp-tenant-context-service.js';
import {
  planWhatsAppDeterministicSocialResponse,
} from '../services/whatsapp-deterministic-social-response-service.js';
import {
  SAMCHE_CANONICAL_MASTER_POLICY_HASH,
  SAMCHE_KNOWLEDGE_SOURCES,
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';
import {
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';

const masterPolicyRaw = readFileSync(
  new URL('../policies/samche-whatsapp-master-business-policy.tr.txt', import.meta.url),
  'utf8'
);
const masterPolicy = canonicalizeSamcheWhatsAppPolicyNewlines(masterPolicyRaw);
const deterministicResponseTemplates = JSON.parse(
  readFileSync(new URL('../policies/samche-whatsapp-deterministic-responses.json', import.meta.url), 'utf8')
);

// Baseline Context Builder (Current WhatsApp Runtime)
function buildBaselineContext({ history = [], customerText, language = 'tr' }) {
  const tenant = {
    companyName: 'SamChe Company LLC',
    assistantName: 'SamChe AI',
    systemPrompt: masterPolicy,
    deterministicTemplates: deterministicResponseTemplates,
    knowledge: [],
  };
  const deterministicPlan = planWhatsAppDeterministicSocialResponse({
    tenant,
    communicationLanguage: language,
    currentInboundMessage: customerText,
    currentIntent: customerText.match(/^(?:merhaba|hello|مرحبا)$/i) ? 'GREETING_ONLY' : 'OTHER',
    firstAssistantResponse: history.length === 0,
  });

  const modelContext = buildWhatsAppTenantModelContext({
    tenant,
    history,
    customerText,
    communicationLanguage: language,
  });

  return { deterministicPlan, modelContext, tenant };
}

// Candidate Context Builder (New Persistent Instructions + Approved Knowledge Candidate Runtime)
function buildCandidateContext({ history = [], customerText, language = 'tr' }) {
  const persona = {
    available: true,
    companyIdentity: SAMCHE_STAGING_BUSINESS_PROFILE.company_identity,
    assistantIdentity: SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_identity,
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: {
      ...SAMCHE_STAGING_ASSISTANT_CONFIG,
      channel_adaptations: {
        whatsapp: { deterministic_templates: deterministicResponseTemplates },
      },
    },
    profileVersionId: 'bp-v2-staging',
    configurationVersionId: 'cfg-v2-staging',
  };

  const knowledgeContext = SAMCHE_KNOWLEDGE_SOURCES
    .map((s) => `[Source: ${s.title}]\n${s.content}`)
    .join('\n\n');

  const deterministicPlan = planWhatsAppDeterministicSocialResponse({
    tenant: {
      companyName: persona.companyIdentity,
      assistantName: persona.assistantIdentity,
      deterministicTemplates: deterministicResponseTemplates,
    },
    communicationLanguage: language,
    currentInboundMessage: customerText,
    currentIntent: customerText.match(/^(?:merhaba|hello|مرحبا)$/i) ? 'GREETING_ONLY' : 'OTHER',
    firstAssistantResponse: history.length === 0,
  });

  const systemInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext,
    channelRules: 'Use concise conversational plain text suitable for WhatsApp. Do not expose internal metadata.',
  });

  return { deterministicPlan, systemInstruction, persona, knowledgeContext };
}

test('Parity Scenario 1-3: Multilingual Greetings (TR, EN, AR)', () => {
  // Scenario 1: Turkish Greeting
  const baseTr = buildBaselineContext({ customerText: 'merhaba', language: 'tr' });
  const candTr = buildCandidateContext({ customerText: 'merhaba', language: 'tr' });
  assert.equal(baseTr.deterministicPlan.content, candTr.deterministicPlan.content);
  assert.ok(candTr.deterministicPlan.content.includes('SamChe AI'));
  assert.ok(candTr.deterministicPlan.content.includes('SamChe Company LLC'));

  // Scenario 2: English Greeting
  const baseEn = buildBaselineContext({ customerText: 'hello', language: 'en' });
  const candEn = buildCandidateContext({ customerText: 'hello', language: 'en' });
  assert.equal(baseEn.deterministicPlan.content, candEn.deterministicPlan.content);
  assert.ok(candEn.deterministicPlan.content.includes('SamChe AI'));

  // Scenario 3: Arabic Greeting
  const baseAr = buildBaselineContext({ customerText: 'مرحبا', language: 'ar' });
  const candAr = buildCandidateContext({ customerText: 'مرحبا', language: 'ar' });
  assert.equal(baseAr.deterministicPlan.content, candAr.deterministicPlan.content);
  assert.ok(candAr.deterministicPlan.content.includes('SamChe AI'));
});

test('Parity Scenario 4-6: Company Formation, Free Zone and Mainland', () => {
  // Scenario 4: Dubai Company Setup
  const cand4 = buildCandidateContext({ customerText: 'Dubai şirket kurulumu nasıl yapılıyor?', language: 'tr' });
  assert.ok(cand4.systemInstruction.includes('SamChe Company LLC'));
  assert.ok(cand4.systemInstruction.includes('Free Zone'));
  assert.ok(cand4.systemInstruction.includes('Mainland'));
  assert.match(cand4.systemInstruction, /işleme başlamak istiyorum.*canlı danışman/i);

  // Scenario 5: Free Zone
  const cand5 = buildCandidateContext({ customerText: 'Freezone avantajları nelerdir?', language: 'tr' });
  assert.ok(cand5.systemInstruction.includes('%100 yabancı mülkiyeti'));
  assert.ok(cand5.systemInstruction.includes('Meydan'));
  assert.ok(cand5.systemInstruction.includes('Dubai South'));
  assert.ok(cand5.systemInstruction.includes('Sharjah'));
  assert.match(cand5.systemInstruction, /kampanya|promosyon/i);

  // Scenario 6: Mainland
  const cand6 = buildCandidateContext({ customerText: 'Mainland şirketlerde yerel sponsor gerekir mi?', language: 'tr' });
  assert.ok(cand6.systemInstruction.includes('yerel ortak (sponsor) zorunluluğu bulunmamaktadır'));
  assert.ok(cand6.systemInstruction.includes('Fiziksel Perakende Mağazaları'));
  assert.ok(cand6.systemInstruction.includes('İnşaat, Genel Müteahhitlik ve Mühendislik Firmaları'));
  assert.ok(cand6.systemInstruction.includes('Gayrimenkul Danışmanlığı ve Emlak Acenteleri'));
});

test('Parity Scenario 7-9: Sponsored Residency, Sponsor Confidentiality and Investor Visa', () => {
  // Scenario 7: Sponsored Residency
  const cand7 = buildCandidateContext({ customerText: 'Şirket kurmadan sponsorlu oturum nasıl alınır?', language: 'tr' });
  assert.ok(cand7.systemInstruction.includes('13.000 AED'));
  assert.ok(cand7.systemInstruction.includes('4.000 AED'));
  assert.ok(cand7.systemInstruction.includes('8.000 AED'));
  assert.ok(cand7.systemInstruction.includes('1.000 AED'));
  assert.ok(cand7.systemInstruction.includes('NOC Belgesi'));

  // Scenario 8: Sponsor Anonymity
  const cand8 = buildCandidateContext({ customerText: 'Sponsor firmanızın adı nedir?', language: 'tr' });
  assert.ok(cand8.systemInstruction.includes('SamChe Company LLC sponsor firma değildir'));
  assert.ok(cand8.systemInstruction.includes('DANIŞMANLIK, BAŞVURU KOORDİNASYONU VE SÜREÇ YÖNETİMİ'));
  assert.ok(cand8.systemInstruction.includes('kota rezervasyonu ve ön başvuru öncesinde gizlidir'));

  // Scenario 9: Investor / Partner Visa
  const cand9 = buildCandidateContext({ customerText: 'Şirket kurarak yatırımcı vizesi alabilir miyim?', language: 'tr' });
  assert.ok(cand9.systemInstruction.includes('2 yıllık yatırımcı oturum vizesi'));
});

test('Parity Scenario 10-12: Corporate Bank Account, Corporate Tax/VAT and Accounting', () => {
  // Scenario 10: Corporate Bank Account & KYC
  const cand10 = buildCandidateContext({ customerText: 'Banka hesabı açılışında destek veriyor musunuz?', language: 'tr' });
  assert.ok(cand10.systemInstruction.includes('Wio Bank'));
  assert.ok(cand10.systemInstruction.includes('Emirates NBD'));
  assert.ok(cand10.systemInstruction.includes('KYC'));
  assert.ok(cand10.systemInstruction.includes('8.000 AED'));

  // Scenario 11: Corporate Tax & VAT
  const cand11 = buildCandidateContext({ customerText: 'Kurumlar vergisi ve KDV oranları nedir?', language: 'tr' });
  assert.ok(cand11.systemInstruction.includes('375.000 AED'));
  assert.ok(cand11.systemInstruction.includes('%9'));
  assert.ok(cand11.systemInstruction.includes('1.300 AED'));
  assert.ok(cand11.systemInstruction.includes('10.000 AED'));
  assert.ok(cand11.systemInstruction.includes('%5'));

  // Scenario 12: Accounting & Bookkeeping
  const cand12 = buildCandidateContext({ customerText: 'Muhasebe defterlerini saklama süresi nedir?', language: 'tr' });
  assert.ok(cand12.systemInstruction.includes('5 yıl'));
});
test('Parity Scenario 13-15: Consulting Fee, Human Escalation and Ambiguous Input', () => {
  // Scenario 13: Consulting Fee
  const cand13 = buildCandidateContext({ customerText: 'Danışmanlık ücreti nedir?', language: 'tr' });
  assert.ok(cand13.systemInstruction.includes('8.000 AED'));
  assert.ok(cand13.systemInstruction.includes('Belirtilen maliyetlere danışmanlık ücreti dahil değildir'));
  assert.match(cand13.systemInstruction, /Free Zone.*8\.000 AED/i);
  assert.match(cand13.systemInstruction, /Mainland.*resmi teklif/i);

  // Scenario 14: Human Escalation
  const cand14 = buildCandidateContext({ customerText: 'Canlı müşteri temsilcisine bağlanmak istiyorum', language: 'tr' });
  assert.match(cand14.systemInstruction, /canlı müşteri temsilcimize aktarıyorum/i);
  assert.match(cand14.systemInstruction, /sessiz kalır/i);

  // Scenario 15: Ambiguous Input
  const cand15 = buildCandidateContext({ customerText: 'nasıl oluyor yardım edin', language: 'tr' });
  assert.ok(cand15.systemInstruction.includes('Size en doğru bilgiyi sunabilmem için konuyu biraz daha netleştirebilir misiniz?'));
  assert.match(cand15.systemInstruction, /anladım ama.*KULLANILMAZ|asla "anladım ama/i);
});

test('Parity Scenario 16-18: Meta Ads Lead, Follow-up Categories and Visa Guarantee Prohibition', () => {
  // Scenario 16: Meta / Instagram Ad Lead
  const cand16 = buildCandidateContext({ customerText: 'Instagram reklamınızı gördüm, bilgi alabilir miyim?', language: 'tr' });
  assert.match(cand16.systemInstruction, /reklamınızı gördüm.*niyetini anlamaya çalış.*sohbeti devam ettir/i);

  // Scenario 17: Follow-up ping
  const cand17 = buildCandidateContext({ customerText: 'Takip mesajı', language: 'tr' });
  assert.ok(cand17.systemInstruction.includes('RESIDENCE'));
  assert.ok(cand17.systemInstruction.includes('COMPANY'));
  assert.ok(cand17.systemInstruction.includes('AI'));
  assert.ok(cand17.systemInstruction.includes('GENERAL'));

  // Scenario 18: Visa Guarantee Prohibition
  const cand18 = buildCandidateContext({ customerText: 'Ödeme yaparsam vize kesin çıkar mı?', language: 'tr' });
  assert.match(cand18.systemInstruction, /kesin onay veya %100 garanti verilmez|Asla vize çıkma garantisi veya %100 onay vaat etme/i);
});


test('Baseline Integrity Check: Master policy canonical SHA-256 matches non-negotiable hash', () => {
  const actualHash = createHash('sha256').update(masterPolicy, 'utf8').digest('hex');
  assert.equal(actualHash, SAMCHE_CANONICAL_MASTER_POLICY_HASH);
  assert.equal(actualHash, 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58');
});
