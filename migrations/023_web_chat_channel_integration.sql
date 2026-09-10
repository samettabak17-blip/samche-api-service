-- Signed Web Chat uses the same tenant/channel/assistant integration mapping as other channels.
DO $$
DECLARE
  constraint_name text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_channel_integrations_type'
       AND conrelid = 'channel_integrations'::regclass
       AND pg_get_constraintdef(oid) LIKE '%WEB_CHAT%'
  ) THEN
    RETURN;
  END IF;

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
    CHECK (integration_type IN ('SAMCHEGUIDE', 'WHATSAPP', 'WEB_CHAT'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_integrations_web_chat_key
  ON channel_integrations(integration_key)
  WHERE integration_type = 'WEB_CHAT';
