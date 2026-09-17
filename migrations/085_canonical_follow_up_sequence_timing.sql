-- Migration 085: Canonical Follow-Up Sequence Timing
-- Idempotently removes temporary acceptance delay overrides and aligns timing strategy with canonical sequence (10m -> 3h -> 24h).

BEGIN;

-- 1. Remove temporary stage_delays_ms from follow_up_behavior across all assistant configuration versions
UPDATE assistant_configuration_versions
   SET configuration_data = configuration_data #- '{follow_up_behavior,stage_delays_ms}',
       updated_at = CURRENT_TIMESTAMP
 WHERE configuration_data #> '{follow_up_behavior,stage_delays_ms}' IS NOT NULL;

-- 2. Ensure demonstration and active tenants have the canonical timing strategy ['10m', '3h', '24h']
UPDATE assistant_configuration_versions
   SET configuration_data = jsonb_set(
         configuration_data,
         '{follow_up_behavior,timing_strategy}',
         jsonb_build_array('10m', '3h', '24h'),
         true
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE configuration_data #> '{follow_up_behavior}' IS NOT NULL
   AND tenant_id IN (SELECT id FROM tenants WHERE name ILIKE '%Blue Dune%');

-- 3. Cancel any lingering stale follow-up jobs from prior temporary test runs
UPDATE conversation_scheduled_jobs
   SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
 WHERE job_type = 'CONTEXTUAL_FOLLOW_UP'
   AND status = 'PENDING';

COMMIT;
