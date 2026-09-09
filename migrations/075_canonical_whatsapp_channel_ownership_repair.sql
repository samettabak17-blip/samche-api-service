-- Canonical WhatsApp physical-channel single-active-owner invariant repair.
-- Drops obsolete global uniqueness constraints and standalone indexes across historical databases.
-- Guarantees at most ONE ACTIVE canonical tenant channel per normalized phone number.
-- Preserves historical inactive channel rows, conversations, and immutable audit events.

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- 1. Safely drop any table-level UNIQUE or CHECK constraints matching the obsolete global uniqueness rule
  FOR rec IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'tenant_channels'::regclass
       AND conname IN (
         'uq_tenant_channels_whatsapp_phone_number',
         'tenant_channels_external_channel_id_key',
         'tenant_channels_external_channel_id_channel_type_key'
       )
  LOOP
    EXECUTE format('ALTER TABLE tenant_channels DROP CONSTRAINT IF EXISTS %I CASCADE', rec.conname);
  END LOOP;

  -- 2. Safely drop legacy standalone unique indexes if they exist without constraint dependency
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'uq_tenant_channels_whatsapp_phone_number'
       AND c.relkind = 'i'
  ) THEN
    DROP INDEX IF EXISTS uq_tenant_channels_whatsapp_phone_number;
  END IF;
END $$;

-- 3. Ensure canonical normalized ACTIVE-only unique index exists.
-- Preserves historical inactive rows while strictly preventing concurrent active owners for the same physical phone.
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
