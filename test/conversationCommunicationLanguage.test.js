import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferConservativeWhatsAppLanguage,
  inferReliableWhatsAppCustomerLanguage,
  resolveWhatsAppCommunicationLanguage,
  resolveWhatsAppMediaResponseLanguage,
} from '../services/conversation-communication-language.js';

test('current substantive multilingual language overrides stale persisted language without per-tenant rules', () => {
  const cases = [
    ['tr', 'Quiero obtener una visa de trabajador independiente', 'es'],
    ['ar', 'Can you explain the company setup costs and visa options in English?', 'en'],
    ['es', 'Dubai’de şirket kurmak istiyorum ve maliyetleri öğrenmek istiyorum.', 'tr'],
    ['es', 'Je souhaite créer une entreprise à Dubaï et connaître les options de visa.', 'fr'],
    ['fr', 'Ich möchte die Kosten für eine Firmengründung und ein Visum verstehen.', 'de'],
    ['de', 'Vorrei aprire una società a Dubai e conoscere le opzioni per il visto.', 'it'],
    ['it', 'Quero abrir uma empresa no Dubai e saber as opções de visto.', 'pt'],
    ['pt', 'Я хочу открыть компанию в Дубае и узнать о вариантах визы.', 'ru'],
  ];
  for (const [previous, content, expected] of cases) {
    assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: previous, content }), expected, content);
  }
});

test('explicit current language instruction overrides stale history and ambiguous fragments retain continuity', () => {
  assert.equal(resolveWhatsAppCommunicationLanguage({
    currentLanguage: 'tr',
    content: 'Soy español, responde en español, no entiendo lo que dices',
  }), 'es');
  assert.equal(resolveWhatsAppCommunicationLanguage({
    currentLanguage: 'ar',
    content: 'Répondez en français, s’il vous plaît',
  }), 'fr');
  assert.equal(resolveWhatsAppCommunicationLanguage({
    currentLanguage: 'es',
    content: '2 visa',
  }), 'es');
});

test('general language inference recognizes substantive Spanish rather than leaving it stale Turkish', () => {
  assert.equal(inferConservativeWhatsAppLanguage('Quiero obtener una visa de trabajador independiente'), 'es');
});


test('media-only turns use the last reliable customer signal rather than stale substantive history', () => {
  assert.equal(inferReliableWhatsAppCustomerLanguage('Merhaba'), 'tr');
  assert.equal(inferReliableWhatsAppCustomerLanguage('Hola'), 'es');
  assert.equal(inferReliableWhatsAppCustomerLanguage('ok'), null);
  assert.deepEqual(resolveWhatsAppMediaResponseLanguage({ currentLanguage: 'ar', lastReliableCustomerLanguage: 'tr', caption: '' }), { language: 'tr', source: 'last_reliable_customer_language', detected: null });
  assert.deepEqual(resolveWhatsAppMediaResponseLanguage({ currentLanguage: 'tr', lastReliableCustomerLanguage: 'tr', caption: 'What does this document say?' }), { language: 'en', source: 'media_caption', detected: 'en' });
});
