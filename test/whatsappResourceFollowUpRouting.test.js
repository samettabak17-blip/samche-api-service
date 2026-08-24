import assert from 'node:assert/strict';
import test from 'node:test';
import { planLatestExplicitResource, planWhatsAppResourceFollowUp, resourceFailureAcknowledgement, resourceProcessingAcknowledgement } from '../services/whatsapp-resource-follow-up-routing.js';

test('a Turkish CV question takes precedence over the legacy contact shortcut when a document is ready', () => {
  const plan = planWhatsAppResourceFollowUp({
    customerText: 'Bu belgedeki kişinin adı soyadı iletişim bilgileri ve ünvanı nedir?',
    readyResourceCount: 1,
    processingResourceCount: 0,
  });
  assert.equal(plan.action, 'DOCUMENT_GROUNDED');
});

test('an immediate explicit document question waits instead of reaching generic routing while the document processes', () => {
  const plan = planWhatsAppResourceFollowUp({
    customerText: 'Bu CVdeki kişinin ünvanı nedir?',
    readyResourceCount: 0,
    processingResourceCount: 1,
  });
  assert.equal(plan.action, 'RESOURCE_PROCESSING');
  assert.equal(plan.invokesModel, false);
  assert.equal(resourceProcessingAcknowledgement('tr'), 'Belgenizi işlemeye devam ediyorum. Birkaç saniye sonra sorunuzu belgeye göre yanıtlayabilirim.');
});

test('an ordinary contact request keeps the existing legacy routing behavior', () => {
  const plan = planWhatsAppResourceFollowUp({
    customerText: 'İletişim bilgilerinizi paylaşır mısınız?',
    readyResourceCount: 0,
    processingResourceCount: 0,
  });
  assert.equal(plan.action, 'CONTINUE');
});

test('binds an explicit document request to the newest failed resource instead of an older ready one', () => {
  const plan = planLatestExplicitResource({ explicit: true, latestResource: { processing_status: 'FAILED', media_category: 'DOCUMENT' } });
  assert.deepEqual(plan, { action: 'RESOURCE_FAILED', invokesModel: false });
  assert.match(resourceFailureAcknowledgement('tr', 'DOCUMENT'), /son belge/);
});

test('binds an explicit image request to the newest ready image', () => {
  const plan = planLatestExplicitResource({ explicit: true, latestResource: { processing_status: 'READY', media_category: 'IMAGE' } });
  assert.deepEqual(plan, { action: 'RESOURCE_GROUNDED', invokesModel: true });
});

