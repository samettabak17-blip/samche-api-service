import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('push notification migration keeps subscriptions tenant/user/device scoped and outbox idempotent', () => {
  const source = fs.readFileSync(new URL('../migrations/068_push_notifications.sql', import.meta.url), 'utf8');
  assert.match(source, /push_notification_subscriptions/);
  assert.match(source, /UNIQUE \(tenant_id, user_id, endpoint\)/);
  assert.match(source, /FOREIGN KEY \(tenant_id, user_id\) REFERENCES tenant_users/);
  assert.match(source, /UNIQUE \(tenant_id, intent_id, subscription_id\)/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS push_notification_preferences/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS push_notification_outbox/);
  assert.match(source, /CREATE INDEX IF NOT EXISTS idx_push_notification_outbox_pending/);
});
