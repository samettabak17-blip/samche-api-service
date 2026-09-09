-- Enforce canonical active-only WhatsApp phone-number uniqueness while preserving tenant-scoped ownership.
-- Obsolete global uniqueness rule is dropped to permit transferred channel history (active + inactive coexistence).
-- Canonical active-only uniqueness is established here and in migrations 072/075.

DO $$
BEGIN
  -- Drop legacy table constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_tenant_channels_whatsapp_phone_number'
      AND conrelid = 'tenant_channels'::regclass
  ) THEN
    ALTER TABLE tenant_channels DROP CONSTRAINT uq_tenant_channels_whatsapp_phone_number CASCADE;
  END IF;

  -- Drop legacy standalone unique index if it exists
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
