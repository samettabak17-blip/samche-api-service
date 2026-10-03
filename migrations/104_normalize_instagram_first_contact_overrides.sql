-- Migration 104: Generic normalization of legacy FIRST_CONTACT_HOLD overrides to AUTOMATIC / UNDECIDED
UPDATE conversations
   SET ai_behavior_override = 'AUTOMATIC',
       updated_at = CURRENT_TIMESTAMP
 WHERE ai_behavior_override = 'FIRST_CONTACT_HOLD';

UPDATE crm_contacts
   SET ai_behavior_override = 'UNDECIDED',
       updated_at = CURRENT_TIMESTAMP
 WHERE ai_behavior_override = 'FIRST_CONTACT_HOLD';
