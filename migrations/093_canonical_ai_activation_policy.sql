-- Migration 093: Canonical AI Activation Policy & Contact/Conversation Overrides
-- Safe, idempotent, non-destructive to all existing conversations.

BEGIN;

-- 1. Add ai_behavior_override column to conversations
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_behavior_override VARCHAR(32) DEFAULT 'AUTOMATIC';

-- 2. Add check constraint for valid overrides
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_conversations_ai_behavior_override'
       AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT ck_conversations_ai_behavior_override
      CHECK (ai_behavior_override IN ('AUTOMATIC', 'ALWAYS_AI', 'NEVER_AI'));
  END IF;
END $$;

-- 3. Create index for non-default overrides
CREATE INDEX IF NOT EXISTS idx_conversations_ai_behavior_override
  ON conversations(tenant_id, ai_behavior_override)
  WHERE ai_behavior_override != 'AUTOMATIC';
-- 2. Add ai_behavior_override column to crm_contacts (Durable Contact-Level Policy)
ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS ai_behavior_override VARCHAR(32) DEFAULT 'AUTOMATIC';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_crm_contacts_ai_behavior_override'
       AND conrelid = 'crm_contacts'::regclass
  ) THEN
    ALTER TABLE crm_contacts
      ADD CONSTRAINT ck_crm_contacts_ai_behavior_override
      CHECK (ai_behavior_override IN ('AUTOMATIC', 'ALWAYS_AI', 'NEVER_AI'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_contacts_ai_behavior_override
  ON crm_contacts(tenant_id, ai_behavior_override)
  WHERE ai_behavior_override != 'AUTOMATIC';


COMMIT;
