-- Migration 109: Configure SamChe Instagram Supplementary Resources
-- Adds configured supplementary YouTube guidance resource to channel_adaptations.instagram
-- for the SamChe tenant. Strictly scoped, idempotent, and non-destructive.

BEGIN;

DO $$
DECLARE
  t_id UUID;
  resources_json JSONB := '[{
    "id": "samed_youtube_channel",
    "type": "YOUTUBE",
    "url": "https://ytbe.app/u9j8qB2S",
    "presentation_header": "▶️ **YouTube''da detaylı anlatım:**",
    "presentation": "▶️ **YouTube''da detaylı anlatım:**\nhttps://ytbe.app/u9j8qB2S",
    "triggers": [
      "yaşam", "yasam", "kira", "kiralar", "ev kiralama", "market",
      "maliyet", "gider", "masraf", "living", "rent", "cost of living", "youtube", "video"
    ],
    "disallowed_intents": ["GREETING", "APPOINTMENT_COLLECTION"]
  }]'::jsonb;
BEGIN
  FOR t_id IN
    SELECT id FROM tenants
     WHERE id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'::uuid
        OR name ILIKE '%SamChe%'
  LOOP
    UPDATE assistant_configuration_versions
       SET configuration_data = jsonb_set(
         configuration_data,
         '{channel_adaptations,instagram,supplementary_resources}',
         resources_json,
         true
       ),
       updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = t_id
       AND configuration_data ? 'channel_adaptations';
  END LOOP;
END $$;

COMMIT;
