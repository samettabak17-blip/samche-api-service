import assert from 'node:assert/strict';
import test from 'node:test';
import { planStandaloneWhatsAppMediaResponse } from '../services/whatsapp-standalone-media-ack.js';
import { qualifyConversation } from '../services/lead-qualification-service.js';

test('plans a deterministic Turkish document acknowledgement without a model call', () => {
  const plan = planStandaloneWhatsAppMediaResponse({
    customerText: '',
    descriptor: { declaredMimeType: 'application/pdf' },
    shouldInvokeAi: true,
    duplicate: false,
    language: 'tr',
  });

  assert.deepEqual(plan, {
    action: 'ACKNOWLEDGE',
    invokesModel: false,
    message: 'Belgeniz alındı. Bu belgeyle ilgili hangi konuda yardımcı olmamı istersiniz? Örneğin içeriğini özetleyebilir, belirli bilgileri çıkarabilir veya sorularınızı belgeye göre yanıtlayabilirim.',
  });
});

test('plans a deterministic Turkish image acknowledgement without a vision call', () => {
  const plan = planStandaloneWhatsAppMediaResponse({
    customerText: '',
    descriptor: { declaredMimeType: 'image/png' },
    shouldInvokeAi: true,
    duplicate: false,
    language: 'tr',
  });

  assert.deepEqual(plan, {
    action: 'ACKNOWLEDGE',
    invokesModel: false,
    message: 'Görseliniz alındı. Bu görselle ilgili neyi incelememi istersiniz? Görseldeki yazıları okuyabilir, belirli detayları inceleyebilir veya sorularınızı görsele göre yanıtlayabilirim.',
  });
});

test('keeps captioned media on the existing AI path', () => {
  const plan = planStandaloneWhatsAppMediaResponse({
    customerText: 'Bu görselde yazan kod nedir?',
    descriptor: { declaredMimeType: 'image/png' },
    shouldInvokeAi: true,
    duplicate: false,
    language: 'tr',
  });

  assert.deepEqual(plan, { action: 'CONTINUE' });
});

test('does not automate an acknowledgement while human or paused handling suppresses AI', () => {
  for (const shouldInvokeAi of [false, undefined]) {
    const plan = planStandaloneWhatsAppMediaResponse({
      customerText: '',
      descriptor: { declaredMimeType: 'application/pdf' },
      shouldInvokeAi,
      duplicate: false,
      language: 'tr',
    });
    assert.deepEqual(plan, { action: 'CONTINUE' });
  }
});

test('does not create a second acknowledgement for a duplicate webhook', () => {
  const plan = planStandaloneWhatsAppMediaResponse({
    customerText: '',
    descriptor: { declaredMimeType: 'application/pdf' },
    shouldInvokeAi: true,
    duplicate: true,
    language: 'tr',
  });

  assert.deepEqual(plan, { action: 'CONTINUE' });
});

test('a standalone media message cannot invoke qualification when it has no customer text', async () => {
  let providerCalls = 0;
  const qualification = await qualifyConversation({
    messages: [{ id: 'media-only', sender_type: 'CUSTOMER', content: '' }],
    contact: { email: null, phone: null },
    invokeModel: async () => {
      providerCalls += 1;
      return {};
    },
  });

  assert.equal(qualification, null);
  assert.equal(providerCalls, 0);
});



test('standalone media acknowledgement uses the resolved media language rather than a session language', () => {
  const plan = planStandaloneWhatsAppMediaResponse({ customerText: '', descriptor: { declaredMimeType: 'application/pdf' }, shouldInvokeAi: true, duplicate: false, language: 'tr' });
  assert.match(plan.message, /Belgeniz alındı/);
});
