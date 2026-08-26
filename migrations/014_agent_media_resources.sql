-- Canonical inbound and operator-sent WhatsApp media resources (staging).
-- This keeps durable conversation resources shared by AI, Live Inbox, and audits.

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'conversation_resources'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) LIKE '%source_type%'
         OR pg_get_constraintdef(oid) LIKE '%media_category%'
       )
  LOOP
    EXECUTE format('ALTER TABLE conversation_resources DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE conversation_resources
    ADD CONSTRAINT ck_conversation_resources_source_type
      CHECK (source_type IN ('UPLOAD', 'WHATSAPP_MEDIA', 'AGENT_UPLOAD', 'URL'));

  ALTER TABLE conversation_resources
    ADD CONSTRAINT ck_conversation_resources_media_category
      CHECK (media_category IN ('DOCUMENT', 'IMAGE', 'AUDIO', 'LINK'));
END $$;
