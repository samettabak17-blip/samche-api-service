-- Migration 111: Configure SamChe Instagram Personal Assistant Persona (Samed Bey'in Kişisel Asistanı)
-- Sets channel_adaptations.instagram.persona_type = 'PERSONAL_ASSISTANT',
-- speaker_name = 'Samed Tabak', represented_person = 'Samed Bey',
-- personal_assistant_title = "Samed Bey'in kişisel asistanı",
-- initial_greeting_introduction = "Merhaba, ben Samed Bey'in kişisel asistanıyım.",
-- meeting_handoff_wording = "Talebinizi ve iletişim bilgilerinizi aldıktan sonra Samed Bey'e ileteceğim. Kendisi sizinle görüşecek."
-- for the SamChe tenant configuration versions. Strictly scoped, idempotent, and non-destructive.

BEGIN;

DO $$
DECLARE
  t_id UUID;
BEGIN
  FOR t_id IN
    SELECT id FROM tenants
     WHERE id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'::uuid
        OR name ILIKE '%SamChe%'
  LOOP
    -- Update active and existing configuration versions' channel_adaptations for Instagram
    UPDATE assistant_configuration_versions
       SET configuration_data = jsonb_set(
         configuration_data,
         '{channel_adaptations,instagram}',
         COALESCE(configuration_data->'channel_adaptations'->'instagram', '{}'::jsonb) || '{
           "persona_type": "PERSONAL_ASSISTANT",
           "speaker_name": "Samed Tabak",
           "represented_person": "Samed Bey",
           "personal_assistant_title": "Samed Bey''in kişisel asistanı",
           "initial_greeting_introduction": "Merhaba, ben Samed Bey''in kişisel asistanıyım.",
           "meeting_handoff_wording": "Talebinizi ve iletişim bilgilerinizi aldıktan sonra Samed Bey''e ileteceğim. Kendisi sizinle görüşecek."
         }'::jsonb,
         true
       ),
       updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = t_id
       AND configuration_data ? 'channel_adaptations';
  END LOOP;
END $$;

COMMIT;
