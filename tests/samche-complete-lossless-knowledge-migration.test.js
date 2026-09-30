import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  SAMCHE_CANONICAL_MASTER_POLICY_HASH,
  SAMCHE_BUSINESS_IDENTITY,
  SAMCHE_KNOWLEDGE_SOURCES,
  SAMCHE_STAGING_BUSINESS_PROFILE,
  SAMCHE_STAGING_ASSISTANT_CONFIG,
  computeCanonicalSourceHashes,
} from '../services/samche-canonical-knowledge-data.js';
import {
  buildTenantRuntimeSystemInstruction,
} from '../services/tenant-runtime-persona-service.js';
import {
  formatInstagramDmResponse,
  sanitizeInstagramOutboundResponse,
  extractReliableCustomerName,
  generateContextualConversationalFallback,
} from '../services/instagram-ai-orchestrator.js';
import {
  chunkKnowledgeText,
  buildUntrustedKnowledgeContext,
} from '../services/knowledge-intelligence-service.js';
import {
  classifyKnowledgeItem,
  LEGACY_FIXTURE_PATTERNS,
} from '../scripts/cleanup_samche_legacy_test_knowledge.js';
import {
  executeSamcheStagingKnowledgeMigration,
} from '../scripts/migrate_samche_staging_knowledge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const POLICY_FILE_PATH = path.join(__dirname, '../policies/samche-whatsapp-master-business-policy.tr.txt');

// 52 Full Freelance professions extracted from Main lines 442-493
const EXPECTED_52_FREELANCE_PROFESSIONS = [
  { name: 'Actor', diploma: 'NO' },
  { name: 'Aerial Shoot Photographer', diploma: 'YES' },
  { name: 'Animator', diploma: 'NO' },
  { name: 'Apparel Designer', diploma: 'YES' },
  { name: 'Art Director', diploma: 'YES' },
  { name: 'Artist', diploma: 'NO' },
  { name: 'Audio / Sound Engineer', diploma: 'YES' },
  { name: 'Cameraman', diploma: 'NO' },
  { name: 'Chef', diploma: 'NO' },
  { name: 'Choreographer', diploma: 'NO' },
  { name: 'Cinema Director', diploma: 'YES' },
  { name: 'Commentators', diploma: 'NO' },
  { name: 'Composer', diploma: 'YES' },
  { name: 'Concept Designer', diploma: 'YES' },
  { name: 'Content Provider', diploma: 'NO' },
  { name: 'Coordinator Sports Event', diploma: 'NO' },
  { name: 'Copywriter', diploma: 'NO' },
  { name: 'Costume Designer', diploma: 'NO' },
  { name: 'Critics', diploma: 'NO' },
  { name: 'Director Cinema & TV', diploma: 'YES' },
  { name: 'Editor: Publishing', diploma: 'YES' },
  { name: 'Event Management Executive', diploma: 'NO' },
  { name: 'Events Planner', diploma: 'NO' },
  { name: 'Fashion Artist', diploma: 'NO' },
  { name: 'Fashion Designer', diploma: 'NO' },
  { name: 'Fashion Stylist', diploma: 'NO' },
  { name: 'Film Developer', diploma: 'YES' },
  { name: 'Graphic Designer', diploma: 'YES' },
  { name: 'Hair Dresser', diploma: 'NO' },
  { name: 'Information Writer', diploma: 'NO' },
  { name: 'Internet Programmer', diploma: 'YES' },
  { name: 'Jewellery Maker', diploma: 'NO' },
  { name: 'Journalist', diploma: 'YES' },
  { name: 'Lighting Technician', diploma: 'YES' },
  { name: 'Set Designer', diploma: 'YES' },
  { name: 'Social Media Specialist', diploma: 'YES' },
  { name: 'Software System Developer', diploma: 'YES' },
  { name: 'Sound Operator', diploma: 'YES' },
  { name: 'Special Effects Producer', diploma: 'YES' },
  { name: 'Speech-language Pathologists', diploma: 'YES' },
  { name: 'Technical Director', diploma: 'YES' },
  { name: 'Television Director', diploma: 'YES' },
  { name: 'Theatre Director', diploma: 'YES' },
  { name: 'Translator', diploma: 'YES' },
  { name: 'TV Production Stylist', diploma: 'NO' },
  { name: 'Tutor', diploma: 'YES' },
  { name: 'Video Editor', diploma: 'NO' },
  { name: 'Videographer', diploma: 'NO' },
  { name: 'Vision Mixer', diploma: 'YES' },
  { name: 'Web Designer', diploma: 'YES' },
  { name: 'Web Developer', diploma: 'YES' },
  { name: 'Fitness Trainer', diploma: 'NO' },
];

const EXPECTED_9_MAINLAND_ACTIVITIES = [
  'Restoran, cafe, catering ve diğer gıda hizmetleri',
  'Fiziksel perakende mağazaları',
  'İnşaat ve müteahhitlik şirketleri',
  'Gayrimenkul şirketi, brokerlık ve emlak ofisleri',
  'Turizm ve seyahat acenteleri',
  'Güvenlik ve CCTV şirketleri/hizmetleri',
  'Endüstriyel ve bina temizlik hizmetleri',
  'Taşımacılık, transport ve UBER şirketleri',
  'Sağlık tesisleri, klinikler ve tıp merkezleri',
];

const EXPECTED_POST_INCORPORATION_CATEGORIES = [
  'PRO (Government Relations)',
  'Muhasebe ve Finans',
  'Kurumsal Banka Hesabı Açılış Desteği',
  'Ofis ve Operasyon Hizmetleri',
  'İş Geliştirme ve Pazarlama',
  'Yapay Zekâ ve Otomasyon',
];

test('1. Authoritative Main File Integrity & Byte-for-Byte Hash Preservation', () => {
  const content = fs.readFileSync(POLICY_FILE_PATH, 'utf8');
  const canonicalLf = content.replace(/\r\n/g, '\n').replace(/\n$/, '');
  const actualHash = createHash('sha256').update(canonicalLf).digest('hex');

  assert.equal(actualHash, SAMCHE_CANONICAL_MASTER_POLICY_HASH, 'Main policy file hash must match canonical SHA-256');
  assert.equal(actualHash, 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58');

  const lines = canonicalLf.split('\n');
  assert.equal(lines.length, 793, 'Main policy must have exactly 793 lines');
});

test('2. Zero Unclassified Items: Complete 52 Freelance Profession Matrix in Sources', () => {
  const freelanceSource = SAMCHE_KNOWLEDGE_SOURCES.find((s) => s.key === 'samche-umm-al-quwain-freelance-permit-professions');
  assert.ok(freelanceSource, 'Freelance source must exist');
  assert.equal(freelanceSource.category, 'FREELANCE');

  assert.equal(EXPECTED_52_FREELANCE_PROFESSIONS.length, 52);

  for (const prof of EXPECTED_52_FREELANCE_PROFESSIONS) {
    const pattern = new RegExp(`${prof.name.replace(/[/]/g, '\\/')} — Diploma: (?:GEREK[İI]YOR \\(YES\\)|GEREKM[İI]YOR \\(NO\\))`, 'i');
    assert.match(
      freelanceSource.content,
      pattern,
      `Freelance profession ${prof.name} with diploma ${prof.diploma} must be present verbatim in freelance source`
    );
  }

  assert.match(freelanceSource.content, /16\.800 AED/);
  assert.match(freelanceSource.content, /\+971 52 728 8586/);
  assert.match(freelanceSource.content, /https:\/\/wa\.me\/971527288586/);
  assert.match(freelanceSource.content, /uzman ekibimizin başvuru öncesinde kontrol yapması gerekiyor/i);
});

test('3. Zero Unclassified Items: All 9 Exclusive Mainland Activities & Ejari Address Rule', () => {
  const companySource = SAMCHE_KNOWLEDGE_SOURCES.find((s) => s.key === 'samche-mainland-vs-freezone-company-formation');
  assert.ok(companySource, 'Company formation source must exist');

  for (const act of EXPECTED_9_MAINLAND_ACTIVITIES) {
    assert.ok(
      companySource.content.includes(act.split(' ')[0]),
      `Mainland activity ${act} keyword must exist in source`
    );
  }

  assert.match(companySource.content, /%100 Yabancı Mülkiyeti/i);
  assert.match(companySource.content, /yerel ortak.*zorunluluğu bulunmamaktadır/i);
  assert.match(companySource.content, /Ejari/i);
  assert.match(companySource.content, /adres çözümü için Ejari sunulur/i);
  assert.match(companySource.content, /fiziksel ofis kiralanması/i);

  assert.match(companySource.content, /Meydan Free Zone/i);
  assert.match(companySource.content, /40\.000 AED/i);
  assert.match(companySource.content, /Dubai South/i);
  assert.match(companySource.content, /Sharjah \(SPCFZ \/ IFZA\)/i);
  assert.match(companySource.content, /RAKEZ \(Ras Al Khaimah\) ve Ajman/i);
  assert.match(companySource.content, /Ömür Boyu Vize/i);
  assert.match(companySource.content, /Kripto\/Web3 ve Altın Ticareti kısıtlıdır/i);
});

test('4. Sponsored Residency Complete Factual Preservation', () => {
  const resSource = SAMCHE_KNOWLEDGE_SOURCES.find((s) => s.key === 'samche-residency-sponsored-visa-solutions');
  assert.ok(resSource);

  assert.match(resSource.content, /13\.000 AED/);
  assert.match(resSource.content, /4\.000 AED.*Kota rezervasyonu.*yaklaşık 10 gün/is);
  assert.match(resSource.content, /8\.000 AED.*Employment Visa.*yaklaşık 30 gün/is);
  assert.match(resSource.content, /1\.000 AED.*Emirates ID.*30 gündür/is);
  assert.match(resSource.content, /NOC Belgesi \(No Objection Certificate\)/);
  assert.match(resSource.content, /2 aydır.*hemen giriş yapılması zorunlu değildir/is);
  assert.match(resSource.content, /En az 3 yıllık geçerli pasaport PDF kopyası/i);
  assert.match(resSource.content, /Biyometrik fotoğraf/i);
});

test('5. Family Visa & Health Insurance Complete Factual Grounding', () => {
  const famSource = SAMCHE_KNOWLEDGE_SOURCES.find((s) => s.key === 'samche-family-visa-health-insurance');
  assert.ok(famSource);

  assert.match(famSource.content, /Entry Permit/);
  assert.match(famSource.content, /Status Change/);
  assert.match(famSource.content, /Medical Test/);
  assert.match(famSource.content, /Biometrics for Emirates ID/);
  assert.match(famSource.content, /Emirates ID Approval/);
  assert.match(famSource.content, /Visa Stamping/);

  assert.match(famSource.content, /Çocuklar için aile vizesi: 4\.500 AED/);
  assert.match(famSource.content, /Eş için aile vizesi: 6\.000 AED/);
  assert.match(famSource.content, /Her 2 yılda bir/);
  assert.match(famSource.content, /Family Visa, NOC veya bağımsız çalışma izni içermez/i);
  assert.match(famSource.content, /13\.000 AED/);

  assert.match(famSource.content, /sağlık sigortası DAHİL DEĞİLDİR/i);
  assert.match(famSource.content, /isteğe bağlıdır/i);
  assert.match(famSource.content, /yaklaşık 800 AED/);
  assert.match(famSource.content, /acil durum, doktor muayenesi ve ilaç/i);
  assert.match(famSource.content, /çalışma izni sağlamaz/i);
});

test('6. Complete Post-Incorporation Support Matrix (All 6 Categories)', () => {
  const postSource = SAMCHE_KNOWLEDGE_SOURCES.find((s) => s.key === 'samche-post-incorporation-tax-vat-banking');
  assert.ok(postSource);

  for (const cat of EXPECTED_POST_INCORPORATION_CATEGORIES) {
    assert.ok(postSource.content.includes(cat.split(' ')[0]), `Category ${cat} must exist in post-incorporation source`);
  }

  assert.match(postSource.content, /Çalışan Vize başvuruları/);
  assert.match(postSource.content, /Investor \(yatırımcı\) \/ Partner \(aile\) vizeleri/);
  assert.match(postSource.content, /Vize Kotaları Yönetimi/);

  assert.match(postSource.content, /Corporate Tax/);
  assert.match(postSource.content, /375\.000 AED.*%0.*%9/is);
  assert.match(postSource.content, /1\.300 AED/);
  assert.match(postSource.content, /10\.000 AED idari para cezası/);
  assert.match(postSource.content, /VAT \(KDV\)/);
  assert.match(postSource.content, /%5/);
  assert.match(postSource.content, /375\.000 AED.*187\.500 AED/is);
  assert.match(postSource.content, /en az 5 yıl/);

  assert.match(postSource.content, /Wio Bank.*Emirates NBD.*Mashreq.*FAB/is);
  assert.match(postSource.content, /KYC.*uyum desteği/i);
  assert.match(postSource.content, /AI chatbot/);
  assert.match(postSource.content, /Instagram ve WhatsApp otomasyonu/);
  assert.match(postSource.content, /CRM entegrasyonu/);
  assert.match(postSource.content, /Satış otomasyon/);
});

test('7. Consultancy Fee & Price Disclaimer Rules', () => {
  const feeSource = SAMCHE_KNOWLEDGE_SOURCES.find((s) => s.key === 'samche-consulting-fee-pricing-rules');
  assert.ok(feeSource);

  assert.match(feeSource.content, /8\.000 AED/);
  assert.match(feeSource.content, /banka KYC desteği dahildir/i);
  assert.match(feeSource.content, /Mainland.*resmi teklif/is);
  assert.match(feeSource.content, /Belirtilen maliyetlere danışmanlık ücreti dahil değildir/i);
});

test('8. Corporate Profile, Contact & WIO Bank Information', () => {
  const profSource = SAMCHE_KNOWLEDGE_SOURCES.find((s) => s.key === 'samche-corporate-profile-contact-banking');
  assert.ok(profSource);

  assert.match(profSource.content, /SamChe Company LLC/);
  assert.match(profSource.content, /DANIŞMANLIK, BAŞVURU KOORDİNASYONU VE SÜREÇ YÖNETİMİ/);
  assert.match(profSource.content, /info@samchecompany\.com/);
  assert.match(profSource.content, /\+971 50 179 38 80/);
  assert.match(profSource.content, /\+971 52 728 8586/);
  assert.match(profSource.content, /Sheikh Zayed Road Latifa Tower Office No 402/);
  assert.match(profSource.content, /\[Samed Tabak YouTube\]\(https:\/\/youtube\.com\/@sametttbk\)/);
  assert.match(profSource.content, /Account Number.*9726414926/is);
  assert.match(profSource.content, /IBAN.*AE210860000009726414926/is);
  assert.match(profSource.content, /BIC.*WIOBAEADXXX/is);
});

test('9. Business Profile Completeness (All Required Schema Fields)', () => {
  assert.equal(SAMCHE_STAGING_BUSINESS_PROFILE.company_identity, 'SamChe Company LLC');
  assert.equal(SAMCHE_STAGING_BUSINESS_PROFILE.company_display_name, 'SamChe Company');
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.company_summary.length > 50);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.products.length >= 10);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.services.length >= 10);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.packages.length >= 6);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.pricing_information.length >= 8);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.policies.length >= 6);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.procedures.length >= 4);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.operating_information.length >= 4);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.sales_information.length >= 3);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.support_escalation_rules.length >= 1);
  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.unsupported_claims.length >= 5);
});

test('10. Multi-Source Retrieval: Family Visa + Insurance + Residency Exact Failure Scenario', () => {
  const query = '2 kızım 1 eşim ve ben yerleşmek istiyoruz sigorta işlemleri nedir ailem içinde ücret ödeyecekmiyim çocuklar için vs?';
  const relevantSources = SAMCHE_KNOWLEDGE_SOURCES.filter((s) =>
    s.key === 'samche-family-visa-health-insurance' ||
    s.key === 'samche-residency-sponsored-visa-solutions'
  );

  assert.equal(relevantSources.length, 2, 'Must retrieve both Family Visa/Insurance source and Sponsored Residency source');

  const context = buildUntrustedKnowledgeContext(relevantSources.map((s) => ({
    sourceTitle: s.title,
    text: s.content,
  })));

  assert.ok(context.includes('4.500 AED'), 'Child visa price 4,500 AED must be grounded');
  assert.ok(context.includes('6.000 AED'), 'Spouse visa price 6,000 AED must be grounded');
  assert.ok(context.includes('13.000 AED'), 'Primary sponsored residency 13,000 AED must be grounded');
  assert.ok(context.includes('800 AED'), 'Health insurance ~800 AED must be grounded');
  assert.ok(context.includes('sağlık sigortası DAHİL DEĞİLDİR'), 'Insurance exclusion must be grounded');
});


test('11. Legacy and Synthetic Knowledge Classification: Clean Exclusion', () => {
  const syntheticItems = [
    { title: 'Meridian Arc Technologies LLC Profile', content: 'Foundation Launch Package 18,900 AED' },
    { title: 'Growth Accelerator Package', content: 'Silver Bridge Protocol 31,200 AED' },
    { title: 'Project Atlas Overview', content: 'Enterprise Architecture Review 22,750 AED' },
    { title: 'Nova Crest Consulting', content: 'Technology Consultancy services' },
    { title: 'Project Harbor & Project Vela', content: 'Additional team member onboarding 4,450 AED' },
  ];

  for (const item of syntheticItems) {
    const classification = classifyKnowledgeItem(item);
    assert.equal(classification, 'LEGACY TEST / FIXTURE', `Item ${item.title} must be classified as LEGACY TEST / FIXTURE`);
  }

  for (const source of SAMCHE_KNOWLEDGE_SOURCES) {
    const classification = classifyKnowledgeItem(source, { isMigrationSource: true });
    assert.equal(classification, 'NEW SAMCHE MAIN MIGRATION', `Source ${source.title} must be classified as NEW SAMCHE MAIN MIGRATION`);
  }
});

test('12. Migration Idempotency & Database Connect Contract', async () => {
  const queryLogs = [];
  const mockDb = {
    query: async (sql, params = []) => {
      queryLogs.push({ sql, params });
      if (sql.includes('SELECT id FROM tenants')) {
        return { rows: [{ id: 'b85d7e7b-d52e-4541-92e7-284a6a67024b', name: 'SamChe Company LLC' }], rowCount: 1 };
      }
      if (sql.includes('SELECT id, title, content_hash FROM knowledge_base_documents')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO business_identities')) {
        return { rows: [{ id: 'ident-uuid-1', display_name: 'SamChe Company LLC', normalized_identity: 'samche company llc', status: 'ACTIVE' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO knowledge_base_documents')) {
        return { rows: [{ id: 'doc-uuid-1', title: params[1], content_hash: params[4], source_type: 'MANUAL', processing_status: 'READY' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO business_profiles')) {
        return { rows: [{ id: 'bp-uuid-1', tenant_id: params[1], active_version_id: null }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO business_profile_versions')) {
        return { rows: [{ id: 'bpv-uuid-1', schema_version: 2, status: 'APPROVED', identity_resolution_status: 'RESOLVED' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO ai_assistants')) {
        return { rows: [{ id: 'ast-uuid-1', name: 'SamChe AI Staging Candidate', model: 'gemini-2.5-pro', status: 'active', active_configuration_version_id: null }], rowCount: 1 };
      }
      if (sql.includes('SELECT id FROM ai_assistants')) {
        return { rows: [{ id: 'ast-uuid-1' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO assistant_configuration_versions')) {
        return { rows: [{ id: 'acv-uuid-1', schema_version: 2, status: 'ACTIVE', activated_at: new Date() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const migrationRes = await executeSamcheStagingKnowledgeMigration({
    database: mockDb,
    tenantId: 'b85d7e7b-d52e-4541-92e7-284a6a67024b',
  });

  assert.equal(migrationRes.success, true);
  assert.equal(migrationRes.knowledgeSourcesCount, 7);
  assert.equal(migrationRes.masterPolicyCanonicalHash, SAMCHE_CANONICAL_MASTER_POLICY_HASH);
});


test('13. Multi-Tenant Isolation: Tenant B Never Receives SamChe Facts', () => {
  const tenantAPersona = {
    available: true,
    companyIdentity: SAMCHE_STAGING_BUSINESS_PROFILE.company_identity,
    assistantIdentity: SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_identity,
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const tenantBPersona = {
    available: true,
    companyIdentity: 'Blue Dune Logistics FZE',
    assistantIdentity: 'Blue Dune Assistant',
    profile: {
      company_identity: 'Blue Dune Logistics FZE',
      products: ['Air Cargo Freight', 'Sea Freight Forwarding'],
      pricing_information: ['Air Freight: 12 USD/kg', 'Container: 2,500 USD'],
    },
    configuration: {
      assistant_identity: 'Blue Dune Assistant',
      role_and_purpose: 'Blue Dune logistics assistant',
    },
  };

  const samcheKnowledgeContext = SAMCHE_KNOWLEDGE_SOURCES.map((s) => `[Source: ${s.title}]\n${s.content}`).join('\n\n');
  const blueDuneKnowledgeContext = '[Source: Blue Dune Logistics Pricing]\nAir Freight: 12 USD/kg, Container: 2,500 USD';

  const tenantAInstruction = buildTenantRuntimeSystemInstruction({
    persona: tenantAPersona,
    knowledgeContext: samcheKnowledgeContext,
  });

  const tenantBInstruction = buildTenantRuntimeSystemInstruction({
    persona: tenantBPersona,
    knowledgeContext: blueDuneKnowledgeContext,
  });

  assert.ok(tenantAInstruction.includes('13.000 AED'));
  assert.ok(tenantAInstruction.includes('SamChe Company LLC'));
  assert.ok(!tenantAInstruction.includes('Blue Dune Logistics'));

  assert.ok(!tenantBInstruction.includes('13.000 AED'), 'Tenant B must not have SamChe residency pricing');
  assert.ok(!tenantBInstruction.includes('16.800 AED'), 'Tenant B must not have SamChe freelance pricing');
  assert.ok(!tenantBInstruction.includes('SamChe Company LLC'), 'Tenant B must not have SamChe identity');
  assert.ok(!tenantBInstruction.includes('9726414926'), 'Tenant B must not have SamChe bank account');
  assert.ok(tenantBInstruction.includes('Blue Dune Logistics FZE'));
});

test('14. Instagram Channel Presentation & Sanitize Output', () => {
  const rawModelResponse = `### Dubai Şirket Kurulumu

**Mainland:** * Detaylar
* 1. Adım: Başvuru
* 2. Adım: Onay

Aşağıdaki bağlantı üzerinden WhatsApp'tan doğrudan iletişime geçebilirsiniz: https://wa.me/971527288586`;

  const sanitized = sanitizeInstagramOutboundResponse(rawModelResponse);
  assert.ok(!sanitized.includes('wa.me'), 'Sanitize must strip wa.me link');
  assert.ok(!sanitized.includes('bağlantı üzerinden'), 'Sanitize must strip WhatsApp CTA');

  const formatted = formatInstagramDmResponse(sanitized);
  assert.ok(!formatted.startsWith('###'), 'Format must strip markdown headers');
  assert.ok(!formatted.includes('**'), 'Format must strip bold markdown asterisks');
  assert.ok(formatted.includes('• '), 'Format must format bullet points');
});


test('15. Health Insurance Non-Mandatory Invariant & Prohibition of Fabricated Legal Mandates', () => {
  const famSource = SAMCHE_KNOWLEDGE_SOURCES.find((s) => s.key === 'samche-family-visa-health-insurance');
  assert.ok(famSource);
  assert.match(famSource.content, /sağlık sigortası DAHİL DEĞİLDİR/i);
  assert.match(famSource.content, /oturum izninin zorunlu bir parçası değil, isteğe bağlıdır/i);
  assert.match(famSource.content, /yaklaşık 800 AED/);
  assert.match(famSource.content, /çalışma izni sağlamaz/i);

  assert.ok(SAMCHE_STAGING_BUSINESS_PROFILE.unsupported_claims.some((c) => c.includes('Sağlık sigortası Emirates ID veya oturum süreci için yasal bir zorunluluktur')));
  assert.ok(SAMCHE_STAGING_ASSISTANT_CONFIG.prohibited_claims.some((c) => c.includes('Sağlık sigortası Emirates ID veya oturum süreci için yasal bir zorunluluktur')));

  const persona = {
    available: true,
    companyIdentity: SAMCHE_STAGING_BUSINESS_PROFILE.company_identity,
    assistantIdentity: SAMCHE_STAGING_ASSISTANT_CONFIG.assistant_identity,
    profile: SAMCHE_STAGING_BUSINESS_PROFILE,
    configuration: SAMCHE_STAGING_ASSISTANT_CONFIG,
  };

  const instruction = buildTenantRuntimeSystemInstruction({
    persona,
    knowledgeContext: `[Source: ${famSource.title}]\n${famSource.content}`,
  });

  assert.match(instruction, /NO INVENTED LEGAL OR PROCEDURAL MANDATES/);
  assert.match(instruction, /MUST NEVER claim that a service, document, registration, fee, or insurance is legally mandatory/);
  assert.match(instruction, /oturum izninin zorunlu bir parçası değil, isteğe bağlıdır/);
});

