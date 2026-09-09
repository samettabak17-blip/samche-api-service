-- Canonical WhatsApp physical-channel ownership and immutable transfer history.
-- Historical channel rows and conversations remain tenant-owned and are never moved.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_tenant_channels_whatsapp_phone_number'
      AND conrelid = 'tenant_channels'::regclass
  ) THEN
    ALTER TABLE tenant_channels DROP CONSTRAINT uq_tenant_channels_whatsapp_phone_number CASCADE;
  END IF;
  DROP INDEX IF EXISTS uq_tenant_channels_whatsapp_phone_number;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_channels_active_whatsapp_external_id
  ON tenant_channels (
    regexp_replace(
      regexp_replace(lower(trim(external_channel_id)), '^whatsapp:\s*', ''),
      '[^0-9]',
      '',
      'g'
    )
  )
  WHERE channel_type = 'WHATSAPP'
    AND status = 'active'
    AND external_channel_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_channel_ownership_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_channel_id VARCHAR(32) NOT NULL,
  source_tenant_id UUID NOT NULL,
  source_channel_id UUID NOT NULL,
  target_tenant_id UUID NOT NULL,
  target_channel_id UUID NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('TRANSFERRED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_whatsapp_ownership_source_channel
    FOREIGN KEY (source_channel_id, source_tenant_id)
    REFERENCES tenant_channels(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_whatsapp_ownership_target_channel
    FOREIGN KEY (target_channel_id, target_tenant_id)
    REFERENCES tenant_channels(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_whatsapp_ownership_cross_tenant
    CHECK (source_tenant_id <> target_tenant_id),
  CONSTRAINT ck_whatsapp_ownership_external_id
    CHECK (external_channel_id ~ '^[0-9]{6,32}$')
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_ownership_events_external_created
  ON whatsapp_channel_ownership_events(external_channel_id, created_at DESC);

CREATE OR REPLACE FUNCTION reject_whatsapp_ownership_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'WhatsApp ownership audit events are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_ownership_events_immutable
  ON whatsapp_channel_ownership_events;

CREATE TRIGGER trg_whatsapp_ownership_events_immutable
BEFORE UPDATE OR DELETE ON whatsapp_channel_ownership_events
FOR EACH ROW EXECUTE FUNCTION reject_whatsapp_ownership_event_mutation();
