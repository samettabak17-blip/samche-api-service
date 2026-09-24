-- Migration 092: Canonical Instagram Channel Type & Integration Foundation
-- Extends tenant_channels and channel_integrations check constraints to allow INSTAGRAM.
-- Safe, idempotent, non-destructive to all existing rows.

BEGIN;

-- 1. Extend tenant_channels channel_type constraint
DO $$
DECLARE
  constraint_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_tenant_channels_channel_type'
       AND conrelid = 'tenant_channels'::regclass
       AND pg_get_constraintdef(oid) LIKE '%INSTAGRAM%'
  ) THEN
    FOR constraint_name IN
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = 'tenant_channels'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%channel_type%'
    LOOP
      EXECUTE format('ALTER TABLE tenant_channels DROP CONSTRAINT %I', constraint_name);
    END LOOP;

    ALTER TABLE tenant_channels
      ADD CONSTRAINT ck_tenant_channels_channel_type
      CHECK (channel_type IN ('WEB_CHAT', 'WHATSAPP', 'SAMCHEGUIDE', 'INSTAGRAM'));
  END IF;
END $$;

-- 2. Extend channel_integrations integration_type constraint
DO $$
DECLARE
  constraint_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_channel_integrations_type'
       AND conrelid = 'channel_integrations'::regclass
       AND pg_get_constraintdef(oid) LIKE '%INSTAGRAM%'
  ) THEN
    FOR constraint_name IN
      SELECT conname
        FROM pg_constraint
       WHERE conrelid = 'channel_integrations'::regclass
         AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%integration_type%'
    LOOP
      EXECUTE format('ALTER TABLE channel_integrations DROP CONSTRAINT %I', constraint_name);
    END LOOP;

    ALTER TABLE channel_integrations
      ADD CONSTRAINT ck_channel_integrations_type
      CHECK (integration_type IN ('SAMCHEGUIDE', 'WHATSAPP', 'WEB_CHAT', 'INSTAGRAM'));
  END IF;
END $$;

-- 3. Unique index for Instagram channel integration keys
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_integrations_instagram_key
  ON channel_integrations(integration_key)
  WHERE integration_type = 'INSTAGRAM';

COMMIT;
