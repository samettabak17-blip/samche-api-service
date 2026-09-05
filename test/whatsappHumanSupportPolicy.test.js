import assert from 'node:assert/strict';
import test from 'node:test';
import * as policyModule from '../services/whatsapp-human-support-policy-service.js';

test('WhatsApp policy module cannot become a competing lifecycle-message authority', () => {
  assert.deepEqual(Object.keys(policyModule), ['summarizeWhatsAppHumanSupportTopic']);
});

test('uses the most recent known customer topic when the human request itself has no topic', () => {
  const topic = policyModule.summarizeWhatsAppHumanSupportTopic({
    text: 'canlı destek istiyorum',
    conversationHistory: [
      { sender_type: 'CUSTOMER', content: 'Şirket kuruluşu hakkında bilgi almak istiyorum.' },
      { sender_type: 'ASSISTANT', content: 'Size yardımcı olabilirim.' },
      { sender_type: 'CUSTOMER', content: 'canlı destek istiyorum' },
    ],
    fallback: 'Genel destek',
  });
  assert.equal(topic, 'Şirket kuruluşu hakkında bilgi almak istiyorum.');
});

test('uses the safe canonical fallback without inventing a topic when no customer topic exists', () => {
  assert.equal(policyModule.summarizeWhatsAppHumanSupportTopic({
    text: 'canlı destek istiyorum', conversationHistory: [], fallback: 'Genel destek',
  }), 'Genel destek');
});
