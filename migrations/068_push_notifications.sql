CREATE TABLE IF NOT EXISTS push_notification_preferences (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  categories JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_users(tenant_id, user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS push_notification_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(512) NOT NULL,
  auth VARCHAR(512) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  failure_code VARCHAR(48),
  last_delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, user_id, endpoint),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_users(tenant_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_push_notification_subscriptions_delivery ON push_notification_subscriptions (tenant_id, user_id) WHERE enabled=TRUE;

CREATE TABLE IF NOT EXISTS push_notification_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  deep_link VARCHAR(512) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERED','NO_RECIPIENT','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, event_id)
);

CREATE TABLE IF NOT EXISTS push_notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  intent_id UUID NOT NULL REFERENCES push_notification_intents(id) ON DELETE RESTRICT,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  subscription_id UUID NOT NULL REFERENCES push_notification_subscriptions(id) ON DELETE RESTRICT,
  event_type VARCHAR(64) NOT NULL,
  deep_link VARCHAR(512) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','RETRY','DELIVERED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  failure_code VARCHAR(48),
  processing_started_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, intent_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_push_notification_outbox_pending ON push_notification_outbox (status, created_at);
