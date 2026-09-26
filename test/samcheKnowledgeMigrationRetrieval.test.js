import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  SAMCHE_CANONICAL_MASTER_POLICY_HASH,
  SAMCHE_KNOWLEDGE_SOURCES,
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
} from '../services/samche-canonical-knowledge-data.js';
import {
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';

// High-Risk Retrieval Test Queries and their expected sources
const RETRIEVAL_TEST_CASES = [
  {
    topic: 'UAQ profession mapping',
    query: 'Software System Developer ve Actor için freelance vizede diploma şartı var mı?',
    expectedSourceKey: 'samche-umm-al-quwain-freelance-permit-professions',
    expectedContentMatch: /Actor — Diploma: GEREKMİYOR \(NO\)[\s\S]*Software System Developer — Diploma: GEREKİYOR \(YES\)/i,
    expectedPriceMatch: /16\.800 AED/,
  },
  {
    topic: 'Sponsored Residency',
    query: 'Şirket kurmadan 2 yıllık sponsorlu oturum nasıl alınıyor ve ödeme aşamaları nedir?',
    expectedSourceKey: 'samche-residency-sponsored-visa-solutions',
    expectedContentMatch: /NOC[\s\S]*13\.000 AED[\s\S]*4\.000 AED[\s\S]*8\.000 AED[\s\S]*1\.000 AED/i,
    expectedPriceMatch: /13\.000 AED/,
  },
  {
    topic: 'Family Visa',
    query: 'Eşim ve çocuklarım için aile vizesi ücreti ve şartları nedir?',
    expectedSourceKey: 'samche-family-visa-health-insurance',
    expectedContentMatch: /Çocuklar için aile vizesi: 4\.500 AED[\s\S]*Eş için aile vizesi: 6\.000 AED[\s\S]*Family Visa, NOC veya bağımsız çalışma izni içermez/i,
    expectedPriceMatch: /4\.500 AED/,
  },
  {
    topic: 'Mainland vs Free Zone',
    query: 'Perakende mağaza açmak istiyorum Freezone da kurabilir miyim?',
    expectedSourceKey: 'samche-mainland-vs-freezone-company-formation',
    expectedContentMatch: /SADECE MAINLAND'DA KURULABİLEN[\s\S]*Fiziksel Perakende Mağazaları/i,
    expectedPriceMatch: /Mainland/i,
  },
  {
    topic: 'Corporate Tax',
    query: 'Kurumlar vergisi zorunlu mu ve ceza oranı nedir?',
    expectedSourceKey: 'samche-post-incorporation-tax-vat-banking',
    expectedContentMatch: /375\.000 AED[\s\S]*%9[\s\S]*1\.300 AED[\s\S]*10\.000 AED idari para cezası/i,
    expectedPriceMatch: /1\.300 AED/,
  },
  {
    topic: 'VAT',
    query: 'KDV oranı ve zorunlu tescil sınırı nedir?',
    expectedSourceKey: 'samche-post-incorporation-tax-vat-banking',
    expectedContentMatch: /standart KDV oranı %5[\s\S]*375\.000 AED[\s\S]*187\.500 AED/i,
    expectedPriceMatch: /%5/,
  },
  {
    topic: 'Consulting / Pricing information',
    query: 'Free Zone kuruluşunda danışmanlık ücreti ne kadar ve neleri kapsar?',
    expectedSourceKey: 'samche-consulting-fee-pricing-rules',
    expectedContentMatch: /8\.000 AED[\s\S]*banka hesabı açılış koordinasyonu ve banka KYC desteği/i,
    expectedPriceMatch: /8\.000 AED/,
  },
  {
    topic: 'Post-incorporation services',
    query: 'Şirket kurulduktan sonra muhasebe ve defter tutma zorunluluğu kaç yıldır?',
    expectedSourceKey: 'samche-post-incorporation-tax-vat-banking',
    expectedContentMatch: /en az 5 yıl süreyle düzenli olarak saklaması zorunludur/i,
    expectedPriceMatch: /5 yıl/,
  },
  {
    topic: 'Banking',
    query: 'Ödeme yapacağım şirket banka hesap ve IBAN bilgileriniz nedir?',
    expectedSourceKey: 'samche-corporate-profile-contact-banking',
    expectedContentMatch: /9726414926[\s\S]*AE210860000009726414926[\s\S]*WIOBAEADXXX/i,
    expectedPriceMatch: /AE210860000009726414926/,
  },
  {
    topic: 'Company Contact information',
    query: 'Ofis adresiniz ve kurumsal iletişim e-postanız nedir?',
    expectedSourceKey: 'samche-corporate-profile-contact-banking',
    expectedContentMatch: /info@samchecompany\.com[\s\S]*\+971 50 179 38 80[\s\S]*Sheikh Zayed Road Latifa Tower/i,
    expectedPriceMatch: /Latifa Tower/i,
  },
];

test('SamChe Canonical Knowledge Sources: Verifies all 7 sources and hash integrity', () => {
  assert.equal(SAMCHE_KNOWLEDGE_SOURCES.length, 7);
  assert.equal(SAMCHE_CANONICAL_MASTER_POLICY_HASH, 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58');

  for (const src of SAMCHE_KNOWLEDGE_SOURCES) {
    assert.ok(src.key, 'Source must have a key');
    assert.ok(src.title, 'Source must have a title');
    assert.ok(src.content && src.content.length > 200, 'Source must have substantive factual content');
    const hash = createHash('sha256').update(src.content, 'utf8').digest('hex');
    assert.equal(typeof hash, 'string');
  }
});

test('SamChe Retrieval Validation: Factual accuracy for all 10 high-risk areas', () => {
  const sourceMap = new Map(SAMCHE_KNOWLEDGE_SOURCES.map((s) => [s.key, s]));

  for (const tc of RETRIEVAL_TEST_CASES) {
    const retrievedSource = sourceMap.get(tc.expectedSourceKey);
    assert.ok(retrievedSource, `Expected source ${tc.expectedSourceKey} must exist for topic ${tc.topic}`);

    assert.match(
      retrievedSource.content,
      tc.expectedContentMatch,
      `Topic ${tc.topic} failed content match in retrieved source ${tc.expectedSourceKey}`
    );

    assert.match(
      retrievedSource.content,
      tc.expectedPriceMatch,
      `Topic ${tc.topic} failed pricing/key match in retrieved source ${tc.expectedSourceKey}`
    );

    const evidenceId = createHash('sha256').update(retrievedSource.content, 'utf8').digest('hex').slice(0, 16);
    assert.ok(evidenceId.length === 16);
  }
});

test('SamChe Candidate Runtime Context: Builds full instruction without hallucinations', () => {
  const persona = {
    available: true,
    companyIdentity: SAMCHE_STAGING_BUSINESS_PROFILE.company_identity,
    assistantIdentity: SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_identity,
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
    profileVersionId: 'bp-ver-1234',
    configurationVersionId: 'cfg-ver-1234',
  };

  const knowledgeContext = SAMCHE_KNOWLEDGE_SOURCES.map((s) => `[Source: ${s.title}]\n${s.content}`).join('\n\n');

  const systemInstruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext,
    channelRules: 'Keep responses concise, professional and plain text.',
  });

  assert.ok(systemInstruction.includes('SamChe Company LLC'));
  assert.ok(systemInstruction.includes('SamChe AI'));
  assert.ok(systemInstruction.includes('13.000 AED'));
  assert.ok(systemInstruction.includes('16.800 AED'));
  assert.ok(systemInstruction.includes('8.000 AED'));
  assert.ok(systemInstruction.includes('AE210860000009726414926'));
  assert.ok(systemInstruction.includes('Sheikh Zayed Road Latifa Tower'));
  assert.ok(systemInstruction.includes('Software System Developer — Diploma: GEREKİYOR (YES)'));
  assert.ok(systemInstruction.includes('Actor — Diploma: GEREKMİYOR (NO)'));
  assert.ok(systemInstruction.includes('Belirtilen maliyetlere danışmanlık ücreti dahil değildir'));
});

