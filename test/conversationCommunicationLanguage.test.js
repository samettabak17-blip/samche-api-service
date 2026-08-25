import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferConservativeWhatsAppLanguage,
  normalizeCommunicationLanguage,
  shouldUpdateCommunicationLanguage,
  resolveWhatsAppCommunicationLanguage,
} from '../services/conversation-communication-language.js';

test('keeps an established language for an ambiguous short mixed-language message', () => {
  assert.equal(shouldUpdateCommunicationLanguage({
    currentLanguage: 'tr',
    candidateLanguage: 'en',
    confidence: 'low',
    substantive: false,
  }), false);
});

test('adopts a detected language for a new conversation only when it is reliable', () => {
  assert.equal(shouldUpdateCommunicationLanguage({
    currentLanguage: 'und',
    candidateLanguage: 'ar',
    confidence: 'high',
    substantive: true,
  }), true);
});

test('normalizes only safe BCP-47-style language tags', () => {
  assert.equal(normalizeCommunicationLanguage('TR'), 'tr');
  assert.equal(normalizeCommunicationLanguage('pt-BR'), 'pt-BR');
  assert.equal(normalizeCommunicationLanguage('not a language'), null);
});

test('detects Turkish only from Turkish-specific language evidence', () => {
  assert.equal(inferConservativeWhatsAppLanguage('Merhaba, şirket kurulumu için bilgi istiyorum.'), 'tr');
});

test('detects Arabic script without treating business terms as language switches', () => {
  assert.equal(inferConservativeWhatsAppLanguage('مرحبا، أريد معلومات عن company setup في دبي'), 'ar');
});

test('leaves ambiguous Latin fragments unresolved', () => {
  assert.equal(inferConservativeWhatsAppLanguage('2 visa'), null);
});


test('recognizes a Turkish greeting and mixed company request as Turkish', () => {
  assert.equal(inferConservativeWhatsAppLanguage('merhaba'), 'tr');
  assert.equal(inferConservativeWhatsAppLanguage("Dubai'de company kurmak istiyorum"), 'tr');
});

test('recognizes English greeting while leaving ambiguous fragments unresolved', () => {
  assert.equal(inferConservativeWhatsAppLanguage('hello'), 'en');
  assert.equal(inferConservativeWhatsAppLanguage('2 visa'), null);
});


test('recognizes anchored informal Turkish WhatsApp greetings and greeting-leading messages', () => {
  for (const greeting of ['merhaba', 'mrb!', 'slm,', 'selam :)', 'Selamün Aleyküm', 'selamun aleykum', 'selamunaleykum', 's.a.', 'sa', 'mrb şirket kurmak istiyorum', 'slm dubai company setup hakkında bilgi alabilir miyim', 'selam 2 visa lazım', "s.a Dubai'de şirket açmak istiyorum"]) {
    assert.equal(inferConservativeWhatsAppLanguage(greeting), 'tr', greeting);
  }
});

test('does not treat an English greeting with business terminology as Turkish', () => {
  assert.equal(inferConservativeWhatsAppLanguage('Hello, Dubai company setup?'), 'en');
});


test('resolves all clear substantive TR EN AR switches while retaining ambiguous short fragments', () => {
  const cases = [
    ['tr', 'Hello, I need company setup information.', 'en'],
    ['en', "Dubai’de şirket kurmak istiyorum.", 'tr'],
    ['ar', 'Hello, I need residency information.', 'en'],
    ['en', 'مرحبا، أريد معلومات عن الإقامة', 'ar'],
    ['ar', 'Dubai’de şirket kurmak istiyorum.', 'tr'],
    ['tr', 'مرحبا، أريد معلومات عن الشركة', 'ar'],
    ['tr', '2 visa', 'tr'],
  ];
  for (const [currentLanguage, content, expected] of cases) {
    assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage, content }), expected, content);
  }
});

test('a language switch never makes a conversation first-contact state again', () => {
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'ar', content: 'Hello, I need company setup information.' }), 'en');
  assert.equal(resolveWhatsAppCommunicationLanguage({ currentLanguage: 'en', content: 'selam, şirket kurmak istiyorum' }), 'tr');
});


test('a realistic substantive English turn overrides Arabic conversation language before prompt construction', () => {
  assert.equal(
    resolveWhatsAppCommunicationLanguage({
      currentLanguage: 'ar',
      content: 'Can you explain the company setup costs and visa options in English?',
    }),
    'en'
  );
});
