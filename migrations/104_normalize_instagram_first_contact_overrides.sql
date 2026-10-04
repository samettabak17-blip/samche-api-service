-- Migration 104: Normalize Instagram First-Contact Overrides to AI_ONLY & Non-Instagram to Canonical Baseline
-- Generic, idempotent, safe, durable migration across all tenants.
-- Preserves explicit operator decisions: NEVER_AI and AUTOMATIC.

DO $$
BEGIN
  -- 1. Normalize Instagram conversations that have legacy hold states or NULL to AI_ONLY
  UPDATE conversations
     SET ai_behavior_override = 'AI_ONLY',
         updated_at = CURRENT_TIMESTAMP
   WHERE (ai_behavior_override IN ('FIRST_CONTACT_HOLD', 'UNDECIDED') OR ai_behavior_override IS NULL)
     AND channel_id IN (
       SELECT id FROM tenant_channels WHERE channel_type = 'INSTAGRAM'
     );

  -- 2. Normalize Instagram CRM contacts that have legacy hold states or NULL to AI_ONLY
  UPDATE crm_contacts
     SET ai_behavior_override = 'AI_ONLY',
         updated_at = CURRENT_TIMESTAMP
   WHERE (ai_behavior_override IN ('FIRST_CONTACT_HOLD', 'UNDECIDED') OR ai_behavior_override IS NULL)
     AND source IN ('INSTAGRAM', 'INSTAGRAM_AD');

  -- 3. Normalize any remaining legacy FIRST_CONTACT_HOLD on non-Instagram channels
  UPDATE conversations
     SET ai_behavior_override = 'AUTOMATIC',
         updated_at = CURRENT_TIMESTAMP
   WHERE ai_behavior_override = 'FIRST_CONTACT_HOLD';

  UPDATE crm_contacts
     SET ai_behavior_override = 'UNDECIDED',
         updated_at = CURRENT_TIMESTAMP
   WHERE ai_behavior_override = 'FIRST_CONTACT_HOLD';
END $$;

