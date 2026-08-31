import test from 'node:test';
import assert from 'node:assert/strict';
import { inferConservativeWhatsAppLanguage, resolveWhatsAppCommunicationLanguage } from '../services/conversation-communication-language.js';
import { buildWhatsAppTenantModelContext } from '../services/whatsapp-tenant-context-service.js';

test('current English greeting replaces a previous Turkish WhatsApp language lock', () => {
  const language = resolveWhatsAppCommunicationLanguage({ currentLanguage: 'tr', content: 'Hello' });
  assert.equal(language, 'en');
  const context = buildWhatsAppTenantModelContext({
    tenant: { companyName: 'Northstar Labs Ltd', assistantName: 'Northstar Assistant', systemPrompt: 'Tenant policy.' },
    customerText: 'Hello',
    communicationLanguage: language,
  });
  assert.match(context.userPrompt, /CURRENT_TURN_RESPONSE_LANGUAGE_LOCK: English/i);
});

test('current Turkish and Arabic greetings replace the prior conversation language', () => {
  const turkish = resolveWhatsAppCommunicationLanguage({ currentLanguage: 'en', content: 'Merhaba' });
  const arabic = resolveWhatsAppCommunicationLanguage({ currentLanguage: turkish, content: 'مرحبا' });
  assert.equal(turkish, 'tr');
  assert.equal(arabic, 'ar');
});

test('same conversation follows the language of each current inbound message', () => {
  let language = 'en';
  for (const [message, expected] of [['Merhaba', 'tr'], ['Hello', 'en'], ['مرحبا', 'ar']]) {
    language = resolveWhatsAppCommunicationLanguage({ currentLanguage: language, content: message });
    assert.equal(language, expected);
  }
});

test('substantive Turkish wins over a previous English or Arabic conversation language', () => {
  const message = 'Hangi hizmetleri veriyorsunuz?';
  assert.equal(inferConservativeWhatsAppLanguage(message), 'tr');
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'en', content: message }), 'tr');
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'ar', content: message }), 'tr');
});

test('substantive English wins over Turkish and the language lock is English', () => {
  const message = 'Please explain company setup options.';
  assert.equal(inferConservativeWhatsAppLanguage(message), 'en');
  const language = resolveWhatsAppCommunicationLanguage({ currentLanguage: 'tr', content: message });
  assert.equal(language, 'en');
  const context = buildWhatsAppTenantModelContext({
    tenant: { companyName: 'Northstar Labs Ltd', assistantName: 'Northstar Assistant', systemPrompt: 'Tenant policy.' },
    customerText: message,
    communicationLanguage: language,
  });
  assert.match(context.userPrompt, /CURRENT_TURN_RESPONSE_LANGUAGE_LOCK: English/i);
});

test('ambiguous current text preserves the persisted conversation language', () => {
  assert.equal(inferConservativeWhatsAppLanguage('ok'), null);
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'tr', content: 'ok' }), 'tr');
});

test('recognizes different-intent English and Turkish substantive turns', () => {
  const english = ['Who are you?', 'What services do you provide?', 'Where is your office?', 'How does your support process work?', 'What are your business hours?'];
  const turkish = ['Siz kimsiniz?', 'Hangi hizmetleri veriyorsunuz?', 'Ofisiniz nerede?', 'Destek süreciniz nasıl çalışıyor?', 'Çalışma saatleriniz nedir?'];
  for (const message of english) assert.equal(inferConservativeWhatsAppLanguage(message), 'en', message);
  for (const message of turkish) assert.equal(inferConservativeWhatsAppLanguage(message), 'tr', message);
});

test('current language wins across different intents in one conversation', () => {
  let language = 'en';
  for (const [message, expected] of [
    ['What services do you provide?', 'en'],
    ['Ofisiniz nerede?', 'tr'],
    ['ما هي ساعات العمل؟', 'ar'],
    ['How does your support process work?', 'en'],
  ]) {
    language = resolveWhatsAppCommunicationLanguage({ currentLanguage: language, content: message });
    assert.equal(language, expected, message);
  }
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'tr', content: 'Who are you?' }), 'en');
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'ar', content: 'Where is your office?' }), 'en');
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'en', content: 'Ofisiniz nerede?' }), 'tr');
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'en', content: 'كيف تعمل عملية الدعم لديكم؟' }), 'ar');
});
