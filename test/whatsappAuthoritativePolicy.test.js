import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildWhatsAppTenantModelContext, canonicalizeSamcheWhatsAppPolicyNewlines, WhatsAppTenantContextError } from '../services/whatsapp-tenant-context-service.js';

const masterPolicy = readFileSync(new URL('../policies/samche-whatsapp-master-business-policy.tr.txt', import.meta.url), 'utf8');
const expectedPolicySha256 = 'c72bc5787e31ee788431fcb7b73a6f1f72fb3471c3910a00e87005d389edaf58';

function tenant(systemPrompt = masterPolicy) {
  return {
    companyName: 'SamChe Company LLC',
    assistantName: 'SamChe AI',
    systemPrompt,
    knowledge: ['Supplementary tenant knowledge only.'],
  };
}

test('preserves the recovered SamChe master policy byte-for-byte and beyond 6000 characters', () => {
  assert.equal(createHash('sha256').update(masterPolicy, 'utf8').digest('hex'), expectedPolicySha256);
  assert.ok(masterPolicy.length > 6000);

  const context = buildWhatsAppTenantModelContext({
    tenant: tenant(),
    history: [],
    customerText: 'mrb company setup fiyatı nedir',
    communicationLanguage: 'tr',
  });

  assert.ok(context.systemInstruction.includes(masterPolicy));
  assert.ok(context.systemInstruction.includes(masterPolicy.slice(-200)));
  assert.match(context.systemInstruction, /DANIŞMANLIK ÜCRETİ/);
  assert.match(context.systemInstruction, /8\.000 AED/);
  assert.match(context.systemInstruction, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.ok(context.systemInstruction.indexOf(masterPolicy) < context.systemInstruction.indexOf('MANDATORY RESPONSE LANGUAGE:'));
});

test('canonicalizes only CRLF and one terminal newline for master-policy integrity', () => {
  const attachedCrLfRepresentation = masterPolicy.replace(/\n/g, '\r\n') + '\r\n';
  assert.notEqual(
    createHash('sha256').update(attachedCrLfRepresentation, 'utf8').digest('hex'),
    expectedPolicySha256
  );
  assert.equal(canonicalizeSamcheWhatsAppPolicyNewlines(attachedCrLfRepresentation), masterPolicy);
  assert.equal(canonicalizeSamcheWhatsAppPolicyNewlines('A  \nB'), 'A  \nB');
});

test('uses the same complete authoritative policy for Turkish English and Arabic response languages', () => {
  for (const [language, expected] of [['tr', 'Turkish'], ['en', 'English'], ['ar', 'Arabic']]) {
    const context = buildWhatsAppTenantModelContext({
      tenant: tenant(),
      history: [],
      customerText: language === 'ar' ? 'أريد تأسيس شركة' : 'Hello, Dubai company setup price?',
      communicationLanguage: language,
    });
    assert.ok(context.systemInstruction.includes(masterPolicy));
    assert.match(context.systemInstruction, new RegExp(`MANDATORY RESPONSE LANGUAGE: ${expected}`));
    assert.doesNotMatch(context.systemInstruction, /Please select your language|Lütfen dil seçiminizi yapınız/i);
    assert.doesNotMatch(context.userPrompt, /1️⃣|2️⃣|3️⃣/);
  }
});

test('keeps tenant identity and knowledge isolated from another tenant', () => {
  const context = buildWhatsAppTenantModelContext({
    tenant: {
      companyName: 'Tenant B LLC',
      assistantName: 'Tenant B AI',
      systemPrompt: 'Tenant B authoritative policy.',
      knowledge: ['Tenant B-only knowledge.'],
    },
    history: [],
    customerText: 'Hello',
    communicationLanguage: 'en',
  });

  assert.match(context.systemInstruction, /Tenant B LLC/);
  assert.match(context.systemInstruction, /Tenant B AI/);
  assert.match(context.systemInstruction, /Tenant B authoritative policy/);
  assert.match(context.systemInstruction, /Tenant B-only knowledge/);
  assert.doesNotMatch(context.systemInstruction, /SamChe Company LLC|SamChe AI|8\.000 AED/);
});

test('first-turn presentation coexists with the complete business policy and later turns do not repeat it', () => {
  const first = buildWhatsAppTenantModelContext({
    tenant: tenant(),
    history: [],
    customerText: 'mrb',
    communicationLanguage: 'tr',
  });
  const later = buildWhatsAppTenantModelContext({
    tenant: tenant(),
    history: [{ sender_type: 'ASSISTANT', content: 'Prior assistant response' }],
    customerText: '2 visa',
    communicationLanguage: 'tr',
  });

  assert.match(first.systemInstruction, /FIRST_RESPONSE:/);
  assert.ok(first.systemInstruction.includes(masterPolicy));
  assert.match(later.systemInstruction, /SUBSEQUENT_RESPONSE:/);
  assert.doesNotMatch(later.systemInstruction, /FIRST_RESPONSE:/);
  assert.ok(later.systemInstruction.includes(masterPolicy));
});

test('rejects a mapped assistant with no authoritative policy instead of silently using a generic prompt', () => {
  assert.throws(
    () => buildWhatsAppTenantModelContext({
      tenant: tenant(''),
      history: [],
      customerText: 'Hello',
      communicationLanguage: 'en',
    }),
    (error) => error instanceof WhatsAppTenantContextError && error.code === 'WHATSAPP_ASSISTANT_POLICY_MISSING'
  );
});

test('staging WhatsApp bootstrap configures the mapped assistant with the verified master policy', () => {
  const bootstrap = readFileSync(new URL('../scripts/bootstrap_whatsapp_mapping.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /name: 'SamChe AI'/);
  assert.match(bootstrap, /system_prompt = \$2/);
  assert.match(bootstrap, /expectedMasterPolicyCanonicalSha256/);
  assert.match(bootstrap, /MASTER_POLICY_INTEGRITY_FAILED/);
  assert.match(bootstrap, /masterPolicyCanonicalSha256/);
  assert.match(bootstrap, /verifiedPolicyCanonicalSha256/);
  assert.match(bootstrap, /verifiedPolicyCanonicalSha256 !== expectedMasterPolicyCanonicalSha256/);
  assert.match(bootstrap, /row\.assistant_name !== runtimeAssistant\.name/);
});
