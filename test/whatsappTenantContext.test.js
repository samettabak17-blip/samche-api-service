import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppTenantPrompt, detectWhatsAppModelResponseLanguage, isWhatsAppResponseLanguageMismatch } from '../services/whatsapp-tenant-context-service.js';

const tenant = { companyName: 'Example Company LLC', assistantName: 'Example AI', systemPrompt: 'Offer accounting services.', knowledge: ['Accounting and payroll support.'] };

test('first greeting is tenant-aware and contains no selector options', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant, history: [], customerText: 'Merhaba', communicationLanguage: 'tr' });
  assert.match(prompt, /Example Company LLC/);
  assert.match(prompt, /Example AI/);
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.match(prompt, /FIRST_RESPONSE: Briefly identify yourself as the named AI assistant/);
  assert.match(prompt, /Never answer with only a generic greeting/);
  assert.match(prompt, /Current customer message:\nMerhaba/);
  assert.doesNotMatch(prompt, /1️⃣|2️⃣|3️⃣/);
});

test('later turn does not request another introduction', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant, history: [{ sender_type: 'ASSISTANT', content: 'Merhaba' }], customerText: '2 visa', communicationLanguage: 'tr' });
  assert.match(prompt, /SUBSEQUENT_RESPONSE:/);
  assert.doesNotMatch(prompt, /FIRST_RESPONSE:/);
});

test('context carries only the mapped tenant identity', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant, history: [], customerText: 'Hello', communicationLanguage: 'en' });
  assert.match(prompt, /Example Company LLC/);
  assert.doesNotMatch(prompt, /SamChe Company LLC/);
});


test('empty optional knowledge still produces a mapped tenant context prompt', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant: { ...tenant, knowledge: [] }, history: [], customerText: 'Merhaba', communicationLanguage: 'tr' });
  assert.match(prompt, /Example Company LLC/);
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.match(prompt, /FIRST_RESPONSE: Briefly identify yourself as the named AI assistant/);
  assert.match(prompt, /Never answer with only a generic greeting/);
  assert.match(prompt, /Current customer message:\nMerhaba/);
});


test('resolved Turkish language is mandatory even when tenant knowledge is English', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant, history: [], customerText: 'merhaba', communicationLanguage: 'tr' });
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.match(prompt, /Never answer with only a generic greeting/);
});


test('a clear English turn after Arabic history uses a current-turn English lock without another introduction', () => {
  const prompt = buildWhatsAppTenantPrompt({
    tenant,
    history: [{ sender_type: 'CUSTOMER', content: 'أريد معلومات' }, { sender_type: 'ASSISTANT', content: 'مرحبًا' }],
    customerText: 'Can you explain the company setup costs and visa options in English?',
    communicationLanguage: 'en',
  });
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: English/);
  assert.match(prompt, /CURRENT_TURN_RESPONSE_LANGUAGE_LOCK: English/);
  assert.match(prompt, /SUBSEQUENT_RESPONSE:/);
  assert.doesNotMatch(prompt, /FIRST_RESPONSE:/);
});


test('detects a clear Arabic model output mismatch for a resolved English turn', () => {
  assert.equal(detectWhatsAppModelResponseLanguage('يمكنني مساعدتك في تأسيس الشركة'), 'ar');
  assert.equal(isWhatsAppResponseLanguageMismatch({ expectedLanguage: 'en', responseContent: 'يمكنني مساعدتك في تأسيس الشركة' }), true);
  assert.equal(isWhatsAppResponseLanguageMismatch({ expectedLanguage: 'en', responseContent: 'I can explain the company setup costs and visa options.' }), false);
});
