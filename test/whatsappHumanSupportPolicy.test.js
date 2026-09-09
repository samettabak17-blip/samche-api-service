import assert from 'node:assert/strict';
import test from 'node:test';
import * as policyModule from '../services/whatsapp-human-support-policy-service.js';

test('WhatsApp policy module cannot become a competing lifecycle-message authority', () => {
  assert.deepEqual(Object.keys(policyModule), ['summarizeWhatsAppHumanSupportTopic']);
});

test('previous unrelated customer question is NOT injected into acknowledgement when human request has no topic', () => {
  const topic = policyModule.summarizeWhatsAppHumanSupportTopic({
    text: 'canlı destek istiyorum',
    conversationHistory: [
      { sender_type: 'CUSTOMER', content: 'Şirket kuruluşu hakkında bilgi almak istiyorum.' },
      { sender_type: 'ASSISTANT', content: 'Size yardımcı olabilirim.' },
      { sender_type: 'CUSTOMER', content: 'canlı destek istiyorum' },
    ],
    fallback: 'Genel destek',
  });
  assert.equal(topic, 'Genel destek');
  assert.notEqual(topic, 'Şirket kuruluşu hakkında bilgi almak istiyorum.');
});

test('uses meaningful context from the human support request itself when present', () => {
  const topic = policyModule.summarizeWhatsAppHumanSupportTopic({
    text: 'Şirket kuruluşu hakkında canlı destek istiyorum',
    conversationHistory: [],
    fallback: 'Genel destek',
  });
  assert.equal(topic, 'Şirket kuruluşu hakkında canlı destek istiyorum');
});

test('uses the safe canonical fallback without inventing a topic when no customer topic exists', () => {
  assert.equal(policyModule.summarizeWhatsAppHumanSupportTopic({
    text: 'canlı destek istiyorum', conversationHistory: [], fallback: 'Genel destek',
  }), 'Genel destek');
});
