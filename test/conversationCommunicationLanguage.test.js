import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
