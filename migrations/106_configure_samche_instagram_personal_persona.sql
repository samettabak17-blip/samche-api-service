-- Migration 106: Configure SamChe Personal Instagram Persona (Samed Tabak)
-- Sets channel_adaptations.instagram.persona_type = 'PERSONAL' and speaker_name = 'Samed Tabak'
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
         COALESCE(configuration_data->'channel_adaptations'->'instagram', '{}'::jsonb) || '{"persona_type": "PERSONAL", "speaker_name": "Samed Tabak"}'::jsonb,
         true
       ),
       updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = t_id
       AND configuration_data ? 'channel_adaptations';
  END LOOP;
END $$;

COMMIT;
