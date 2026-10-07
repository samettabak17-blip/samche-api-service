-- Migration 110: Scope SamChe Instagram Supplementary Resources
-- Updates channel_adaptations.instagram.supplementary_resources with semantic_scope
-- for the SamChe tenant. Strictly scoped, idempotent, and non-destructive.

BEGIN;

DO $$
DECLARE
  t_id UUID;
  resources_json JSONB := '[{
    "id": "samed_youtube_living_guide",
    "type": "YOUTUBE",
    "url": "https://ytbe.app/u9j8qB2S",
    "default_guidance_text": "Dubai''de yaşam giderleri ve kiralar hakkında daha fazla bilgi edinmek isterseniz YouTube sayfamı ziyaret edebilirsiniz, orada detaylı anlattım.",
    "semantic_scope": {
      "topics": [
        {
          "id": "RENT_AND_HOUSING",
          "pattern": "(?:kira|ev\\\\s*kira|konut\\\\s*kira|konut\\\\s*maliyet|\\\\brent|\\\\brents|\\\\brental|housing\\\\s*costs?)",
          "guidance_text": "Dubai''de yaşam giderleri ve kiralar hakkında daha fazla bilgi edinmek isterseniz YouTube sayfamı ziyaret edebilirsiniz, orada detaylı anlattım."
        },
        {
          "id": "SALARIES_AND_INCOME",
          "pattern": "(?:maaş|maas|gelir\\\\s*seviye|gelir\\\\s*düzey|\\\\bsalary|\\\\bsalaries|\\\\bincome)",
          "guidance_text": "Dubai''de yaşam koşulları ve maaşlar hakkında daha fazla bilgi edinmek isterseniz YouTube sayfamı ziyaret edebilirsiniz, orada detaylı anlattım."
        },
        {
          "id": "LIVING_CONDITIONS_AND_BUDGET",
          "pattern": "(?:yaşam\\\\s*koşul|yasam\\\\s*kosul|yaşam\\\\s*şart|yasam\\\\s*sart|yaşam\\\\s*standart|yasam\\\\s*standart|yaşam\\\\s*gider|yasam\\\\s*gider|yaşam\\\\s*maliyet|yasam\\\\s*maliyet|yaşam\\\\s*masraf|yasam\\\\s*masraf|geçim|gecim|geçin|gecin|aylık\\\\s*bütçe|aylik\\\\s*butce|aile\\\\s*bütçe|aile\\\\s*butce|cost\\\\s+of\\\\s+living|living\\\\s+costs?|living\\\\s+expenses?)",
          "guidance_text": "Dubai''de yaşam giderleri ve kiralar hakkında daha fazla bilgi edinmek isterseniz YouTube sayfamı ziyaret edebilirsiniz, orada detaylı anlattım."
        },
        {
          "id": "DIRECT_YOUTUBE_INQUIRY",
          "pattern": "(?:youtube|video|kanal[ıi]n[ıi]z|videonuz|videolar[ıi]n[ıi]z)",
          "guidance_text": "Dubai ve süreçler hakkında detaylı videolarıma YouTube sayfamdan ulaşabilirsiniz."
        }
      ]
    }
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

