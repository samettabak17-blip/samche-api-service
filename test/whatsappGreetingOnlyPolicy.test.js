import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppTenantModelContext } from '../services/whatsapp-tenant-context-service.js';

const tenant = {
  companyName: 'Example Company LLC',
  assistantName: 'Example AI',
  systemPrompt: 'Authoritative business policy.',
  knowledge: ['Company setup is available.'],
};

function build(customerText, history = [], language = 'tr') {
  return buildWhatsAppTenantModelContext({
    tenant,
    history,
    customerText,
    communicationLanguage: language,
  });
}

test('Turkish greeting-only first turn is classified without inferring company qualification', () => {
  const context = build('mrb');

  assert.equal(context.currentIntent, 'GREETING_ONLY');
  assert.match(context.systemInstruction, /CURRENT_MESSAGE_INTENT: GREETING_ONLY/);
  assert.match(context.systemInstruction, /TENANT IDENTITY: You are Example AI, the AI assistant for Example Company LLC/);
  assert.match(context.systemInstruction, /Do not infer company formation or any other business topic/);
  assert.match(context.systemInstruction, /FIRST_RESPONSE: Briefly identify yourself/);
  assert.match(context.systemInstruction, /Do not begin business qualification/);
});

test('common Turkish greeting-only forms stay greeting-only', () => {
  for (const greeting of ['slm', 'selamun aleykum', 's.a']) {
    assert.equal(build(greeting).currentIntent, 'GREETING_ONLY');
  }
});

test('English and Arabic greeting-only first turns stay topic-neutral', () => {
  assert.equal(build('hello', [], 'en').currentIntent, 'GREETING_ONLY');
  assert.equal(build('مرحبا', [], 'ar').currentIntent, 'GREETING_ONLY');
});

test('greeting plus a company question remains a topic-bearing message', () => {
  const context = build('mrb company setup fiyatı nedir');

  assert.equal(context.currentIntent, 'TOPIC_PRESENT');
  assert.match(context.systemInstruction, /CURRENT_MESSAGE_INTENT: TOPIC_PRESENT/);
});

test('a later greeting cannot revive an old company topic from history', () => {
  const context = build('mrb', [
    { sender_type: 'CUSTOMER', content: 'Dubai company setup hakkında bilgi istiyorum' },
    { sender_type: 'ASSISTANT', content: 'Prior answer' },
  ]);

  assert.equal(context.currentIntent, 'GREETING_ONLY');
  assert.match(context.systemInstruction, /SUBSEQUENT_RESPONSE:/);
  assert.match(context.systemInstruction, /Do not infer company formation or any other business topic/);
});

