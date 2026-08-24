import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppTenantPrompt } from '../services/whatsapp-tenant-context-service.js';

const tenant = { companyName: 'Example Company LLC', assistantName: 'Example AI', systemPrompt: 'Offer accounting services.', knowledge: ['Accounting and payroll support.'] };

test('first greeting is tenant-aware and contains no selector options', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant, history: [], customerText: 'Merhaba', communicationLanguage: 'tr' });
  assert.match(prompt, /Example Company LLC/);
  assert.match(prompt, /Example AI/);
  assert.match(prompt, /Resolved communication language: tr\./);
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.match(prompt, /FIRST_RESPONSE: Begin by briefly identifying yourself as the named AI assistant for the named tenant/);
  assert.match(prompt, /Never answer with only a generic greeting/);
  assert.match(prompt, /Customer message: Merhaba/);
  assert.doesNotMatch(prompt, /1️⃣|2️⃣|3️⃣/);
});

test('later turn does not request another introduction', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant, history: [{ sender_type: 'ASSISTANT', content: 'Merhaba' }], customerText: '2 visa', communicationLanguage: 'tr' });
  assert.match(prompt, /SUBSEQUENT_RESPONSE/);
  assert.doesNotMatch(prompt, /FIRST_RESPONSE/);
});

test('context carries only the mapped tenant identity', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant, history: [], customerText: 'Hello', communicationLanguage: 'en' });
  assert.match(prompt, /Example Company LLC/);
  assert.doesNotMatch(prompt, /SamChe Company LLC/);
});


test('empty optional knowledge still produces a mapped tenant context prompt', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant: { ...tenant, knowledge: [] }, history: [], customerText: 'Merhaba', communicationLanguage: 'tr' });
  assert.match(prompt, /Example Company LLC/);
  assert.match(prompt, /Resolved communication language: tr\./);
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.match(prompt, /FIRST_RESPONSE: Begin by briefly identifying yourself as the named AI assistant for the named tenant/);
  assert.match(prompt, /Never answer with only a generic greeting/);
  assert.match(prompt, /Customer message: Merhaba/);
});


test('resolved Turkish language is mandatory even when tenant knowledge is English', () => {
  const prompt = buildWhatsAppTenantPrompt({ tenant, history: [], customerText: 'merhaba', communicationLanguage: 'tr' });
  assert.match(prompt, /MANDATORY RESPONSE LANGUAGE: Turkish/);
  assert.match(prompt, /Never answer with only a generic greeting/);
});
