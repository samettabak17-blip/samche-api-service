import assert from 'node:assert/strict';
import test from 'node:test';
import webpush from 'web-push';
import { createWebPushDeliveryAdapter, readWebPushConfiguration } from '../services/web-push-delivery-adapter.js';

test('Web Push remains disabled until every required VAPID value is server configured', () => {
  assert.equal(readWebPushConfiguration({ VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private' }), null);
  assert.equal(readWebPushConfiguration({ VAPID_PUBLIC_KEY: 'public', VAPID_SUBJECT: 'mailto:operator@example.test' }), null);
  assert.deepEqual(readWebPushConfiguration({
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:operator@example.test',
  }), {
    publicKey: 'public',
    privateKey: 'private',
    subject: 'mailto:operator@example.test',
  });
});

test('the server-side adapter initializes with in-memory VAPID material without sending a notification', async () => {
  const keys = webpush.generateVAPIDKeys();
  const adapter = await createWebPushDeliveryAdapter({ configuration: {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: 'mailto:operator@example.test',
  } });
  assert.equal(typeof adapter?.deliver, 'function');
});
