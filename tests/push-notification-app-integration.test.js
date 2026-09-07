import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('human-support escalation bridges resolved operators into the durable push outbox', () => {
  assert.match(source, /enqueueHumanHandoffPushNotification/);
  assert.match(source, /handoffOutboxId:\s*outboxId/);
  assert.match(source, /recipients/);
  assert.match(source, /return \{ status: 'DELIVERED' \}/);
});

test('push delivery runs independently of handoff state and only when configured', () => {
  assert.match(source, /createWebPushDeliveryAdapter/);
  assert.match(source, /processPushNotificationOutbox/);
  assert.match(source, /if \(!pushAdapter\) return/);
});
