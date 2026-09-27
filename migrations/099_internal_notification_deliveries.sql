-- Migration 099: Generic multi-tenant internal notification delivery tracking and webhook correlation

CREATE TABLE IF NOT EXISTS internal_notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  notification_type VARCHAR(64) NOT NULL,
  lead_id UUID,
  conversation_id UUID,
  destination VARCHAR(64) NOT NULL,
  sender_phone_number_id VARCHAR(64) NOT NULL,
  template_name VARCHAR(128) NOT NULL,
  template_language VARCHAR(16) NOT NULL,
  provider_message_id VARCHAR(255) UNIQUE,
  dedupe_hash VARCHAR(128),
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'DISPATCH_ACCEPTED',
  failure_code VARCHAR(64),
  failure_reason TEXT,
  failure_details JSONB,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_internal_notif_wamid ON internal_notification_deliveries(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_internal_notif_tenant_lead ON internal_notification_deliveries(tenant_id, lead_id, dedupe_hash);
CREATE INDEX IF NOT EXISTS idx_internal_notif_tenant_conv ON internal_notification_deliveries(tenant_id, conversation_id);
