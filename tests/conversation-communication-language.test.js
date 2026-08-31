import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsAppCommunicationLanguage } from '../services/conversation-communication-language.js';
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
