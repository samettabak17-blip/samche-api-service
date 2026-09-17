-- Migration 083: Canonical Generic Demo Mode Configuration
-- Idempotently configures generic demo_mode for demonstration tenants (Blue Dune).
-- Preserves strict tenant isolation and pure white-label defaults for all non-demo tenants.

BEGIN;

-- 1. Update assistant_configuration_versions for Blue Dune demo tenant
UPDATE assistant_configuration_versions
   SET configuration_data = jsonb_set(
         COALESCE(configuration_data, '{}'::jsonb),
         '{demo_mode}',
         jsonb_build_object(
           'enabled', true,
           'platform_name', 'SamChe AI',
           'business_name', 'Blue Dune',
           'business_type', 'event management company',
           'business_context', 'For this demonstration, Blue Dune represents an event management company.',
           'disclosure', 'This is a demonstration experience powered by SamChe AI.',
           'transition_behavior', 'continue_as_tenant_assistant',
           'scenarios', jsonb_build_array(
             jsonb_build_object('id', 'plan_event', 'label', 'Plan an Event', 'prompt', 'I''m planning a corporate event for 150 guests in Dubai. Can you help?'),
             jsonb_build_object('id', 'ask_services', 'label', 'Ask About Services', 'prompt', 'I need help choosing the right event service.'),
             jsonb_build_object('id', 'customer_support', 'label', 'Try Customer Support', 'prompt', 'I have a problem with an existing booking.'),
             jsonb_build_object('id', 'request_human', 'label', 'Request a Human', 'prompt', 'I want to speak to a human.')
           )
         ),
         true
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id IN (SELECT id FROM tenants WHERE name ILIKE '%Blue Dune%');

-- 2. Update channel_integrations for Blue Dune demo tenant
UPDATE channel_integrations
   SET config = jsonb_set(
         COALESCE(config, '{}'::jsonb),
         '{demo_mode}',
         jsonb_build_object(
           'enabled', true,
           'platform_name', 'SamChe AI',
           'business_name', 'Blue Dune',
           'business_type', 'event management company',
           'business_context', 'For this demonstration, Blue Dune represents an event management company.',
           'disclosure', 'This is a demonstration experience powered by SamChe AI.',
           'transition_behavior', 'continue_as_tenant_assistant',
           'scenarios', jsonb_build_array(
             jsonb_build_object('id', 'plan_event', 'label', 'Plan an Event', 'prompt', 'I''m planning a corporate event for 150 guests in Dubai. Can you help?'),
             jsonb_build_object('id', 'ask_services', 'label', 'Ask About Services', 'prompt', 'I need help choosing the right event service.'),
             jsonb_build_object('id', 'customer_support', 'label', 'Try Customer Support', 'prompt', 'I have a problem with an existing booking.'),
             jsonb_build_object('id', 'request_human', 'label', 'Request a Human', 'prompt', 'I want to speak to a human.')
           )
         ),
         true
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id IN (SELECT id FROM tenants WHERE name ILIKE '%Blue Dune%');

-- 3. Update guide_experience_versions for Blue Dune demo tenant
UPDATE guide_experience_versions
   SET experience = jsonb_set(
         COALESCE(experience, '{}'::jsonb),
         '{demo_mode}',
         jsonb_build_object(
           'enabled', true,
           'platform_name', 'SamChe AI',
           'business_name', 'Blue Dune',
           'business_type', 'event management company',
           'business_context', 'For this demonstration, Blue Dune represents an event management company.',
           'disclosure', 'This is a demonstration experience powered by SamChe AI.',
           'transition_behavior', 'continue_as_tenant_assistant'
         ),
         true
       )
 WHERE tenant_id IN (SELECT id FROM tenants WHERE name ILIKE '%Blue Dune%');

COMMIT;
