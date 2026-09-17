-- Migration 084: Canonical Tenant Follow-Up Configuration
-- Idempotently configures canonical follow_up_behavior for eligible demonstration tenants (Blue Dune).
-- Preserves strict tenant isolation and pure generic multi-tenant defaults for all other tenants.

BEGIN;

-- 1. Idempotently configure canonical follow_up_behavior on active assistant configurations for Blue Dune
UPDATE assistant_configuration_versions
   SET configuration_data = jsonb_set(
         COALESCE(configuration_data, '{}'::jsonb),
         '{follow_up_behavior}',
         jsonb_build_object(
           'enabled', true,
           'timing_strategy', jsonb_build_array('3h', '24h'),
           'guidance', 'Politely check in with the customer to offer assistance with event management, answer any pending questions, and outline the next steps.',
           'cta_behavior', 'Offer the next documented step and answer any questions.',
           'stage_delays_ms', jsonb_build_object(
             '3h', 120000
           )
         ),
         true
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id IN (SELECT id FROM tenants WHERE name ILIKE '%Blue Dune%');

COMMIT;
