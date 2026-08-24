import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inferConservativeWhatsAppLanguage,
  normalizeCommunicationLanguage,
  shouldUpdateCommunicationLanguage,
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
