-- Migration 107: Normalize Instagram closed or archived conversations to open
-- Generic, idempotent, safe across all tenants.
-- Normalizes Instagram conversations that are closed/archived with non-NEVER_AI override back to open.
-- Preserves explicit operator decisions: NEVER_AI is strictly preserved.

DO $$
BEGIN
  UPDATE conversations
     SET status = 'open',
         handling_mode = CASE
           WHEN handling_mode != 'AI' AND assigned_agent_user_id IS NULL THEN 'AI'
           ELSE handling_mode
         END,
         updated_at = CURRENT_TIMESTAMP
   WHERE channel_id IN (
     SELECT id FROM tenant_channels WHERE channel_type = 'INSTAGRAM'
   )
   AND status != 'open'
   AND ai_behavior_override != 'NEVER_AI';
END $$;
