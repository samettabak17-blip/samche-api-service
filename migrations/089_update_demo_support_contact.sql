-- Migration 089: Update SamChe demo support contact details to canonical values
-- Replaces legacy support@samche.ae and +971 50 212 71 61 with support@samche.com and +971 50 694 1372 in active business profiles and assistant configurations.

DO $$
BEGIN
  UPDATE business_profile_versions
     SET profile_data = jsonb_set(
           jsonb_set(
             profile_data,
             '{support_email}',
             '"support@samche.com"'
           ),
           '{support_phone}',
           '"+971 50 694 1372"'
         )
   WHERE profile_data->>'support_email' = 'support@samche.ae'
      OR profile_data->>'support_phone' = '+971 50 212 71 61';

  UPDATE assistant_configuration_versions
     SET configuration_data = jsonb_set(
           jsonb_set(
             configuration_data,
             '{policy_context,support_email}',
             '"support@samche.com"'
           ),
           '{policy_context,support_phone}',
           '"+971 50 694 1372"'
         )
   WHERE configuration_data->'policy_context'->>'support_email' = 'support@samche.ae'
      OR configuration_data->'policy_context'->>'support_phone' = '+971 50 212 71 61';
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN undefined_column THEN NULL;
END $$;
