-- Migration 093: Canonical AI Activation Policy, First-Contact Hold & Contact/Conversation Overrides
-- Safe, idempotent, non-destructive to all existing conversations and contacts.

DO $$
BEGIN
  -- 1. Add ai_behavior_override column to conversations only if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
     WHERE table_name = 'conversations' AND column_name = 'ai_behavior_override'
  ) THEN
    ALTER TABLE conversations
      ADD COLUMN ai_behavior_override VARCHAR(32) DEFAULT 'FIRST_CONTACT_HOLD';
  END IF;

  -- 2. Add constraint only if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_conversations_ai_behavior_override'
       AND conrelid = 'conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT ck_conversations_ai_behavior_override
      CHECK (ai_behavior_override IN ('AUTOMATIC', 'AI_ONLY', 'ALWAYS_AI', 'NEVER_AI', 'FIRST_CONTACT_HOLD', 'UNDECIDED'));
  END IF;

  -- 3. Add ai_behavior_override column to crm_contacts only if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
     WHERE table_name = 'crm_contacts' AND column_name = 'ai_behavior_override'
  ) THEN
    ALTER TABLE crm_contacts
      ADD COLUMN ai_behavior_override VARCHAR(32) DEFAULT 'UNDECIDED';
  END IF;

  -- 4. Add constraint only if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_crm_contacts_ai_behavior_override'
       AND conrelid = 'crm_contacts'::regclass
  ) THEN
    ALTER TABLE crm_contacts
      ADD CONSTRAINT ck_crm_contacts_ai_behavior_override
      CHECK (ai_behavior_override IN ('AUTOMATIC', 'AI_ONLY', 'ALWAYS_AI', 'NEVER_AI', 'FIRST_CONTACT_HOLD', 'UNDECIDED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_ai_behavior_override
  ON conversations(tenant_id, ai_behavior_override);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_ai_behavior_override
  ON crm_contacts(tenant_id, ai_behavior_override);
