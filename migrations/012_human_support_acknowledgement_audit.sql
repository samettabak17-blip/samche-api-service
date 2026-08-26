-- Staging: permit the durable acknowledgement audit event written after the
-- first successful human WhatsApp delivery. This alters only the event-type
-- CHECK constraint; no conversation, CRM, or message data is changed.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'conversation_audit_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE conversation_audit_events DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE conversation_audit_events
    ADD CONSTRAINT ck_conversation_audit_events_event_type
    CHECK (event_type IN (
      'TAKEOVER', 'RETURN_TO_AI', 'PAUSE', 'RESUME', 'CLOSE',
      'ASSIGNMENT', 'HANDOFF_REQUESTED', 'HUMAN_MESSAGE',
      'HUMAN_SUPPORT_ACKNOWLEDGED'
    ));
END $$;
