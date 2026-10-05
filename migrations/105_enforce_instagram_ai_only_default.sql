-- Migration 105: Enforce AI_ONLY initial default for all Instagram conversations & contacts
-- Generic, idempotent, safe across all tenants.
-- Normalizes Instagram conversations and CRM contacts that have legacy hold states, NULL, or unconfigured AUTOMATIC to AI_ONLY.
-- Preserves explicit operator decisions (NEVER_AI).

DO $$
BEGIN
  -- 1. Normalize Instagram conversations to AI_ONLY
  UPDATE conversations
     SET ai_behavior_override = 'AI_ONLY',
         updated_at = CURRENT_TIMESTAMP
   WHERE (ai_behavior_override IN ('FIRST_CONTACT_HOLD', 'UNDECIDED', 'AUTOMATIC') OR ai_behavior_override IS NULL)
     AND channel_id IN (
       SELECT id FROM tenant_channels WHERE channel_type = 'INSTAGRAM'
     )
     AND ai_behavior_override != 'NEVER_AI';

  -- 2. Normalize Instagram CRM contacts to AI_ONLY
  UPDATE crm_contacts
     SET ai_behavior_override = 'AI_ONLY',
         updated_at = CURRENT_TIMESTAMP
   WHERE (ai_behavior_override IN ('FIRST_CONTACT_HOLD', 'UNDECIDED', 'AUTOMATIC') OR ai_behavior_override IS NULL)
     AND source IN ('INSTAGRAM', 'INSTAGRAM_AD')
     AND ai_behavior_override != 'NEVER_AI';
END $$;
