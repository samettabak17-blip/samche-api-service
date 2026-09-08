-- SamChe Guide Channel Lifecycle & Historical Convergence
--
-- AI Guides are dedicated web channel experiences for tenant AI Assistants.
-- Every active assistant has a canonical SAMCHEGUIDE channel in tenant_channels
-- and a corresponding channel_integrations mapping.
--
-- This migration converges historical SAMCHEGUIDE channels where assistant_id
-- was left unpopulated, ensures channel integrations exist for active assistants,
-- and preserves all existing published domain ownership.
-- Idempotent and replay-safe.

BEGIN;

-- 1. Converge historical SAMCHEGUIDE channels where tc.assistant_id is NULL
-- but channel_integrations has the assistant_id.
UPDATE tenant_channels tc
   SET assistant_id = ci.assistant_id,
       updated_at = CURRENT_TIMESTAMP
  FROM channel_integrations ci
 WHERE ci.channel_id = tc.id
   AND ci.tenant_id = tc.tenant_id
   AND tc.channel_type = 'SAMCHEGUIDE'
   AND tc.assistant_id IS NULL
   AND ci.assistant_id IS NOT NULL;

-- 2. Converge historical SAMCHEGUIDE channels where tc.assistant_id is NULL
-- but guide_domains has the assistant_id.
UPDATE tenant_channels tc
   SET assistant_id = gd.assistant_id,
       updated_at = CURRENT_TIMESTAMP
  FROM guide_domains gd
 WHERE gd.channel_id = tc.id
   AND gd.tenant_id = tc.tenant_id
   AND tc.channel_type = 'SAMCHEGUIDE'
   AND tc.assistant_id IS NULL
   AND gd.assistant_id IS NOT NULL;

-- 3. For any remaining SAMCHEGUIDE channel with tc.assistant_id IS NULL
-- in a tenant with exactly one active assistant, converge to that assistant.
UPDATE tenant_channels tc
   SET assistant_id = a.id,
       updated_at = CURRENT_TIMESTAMP
  FROM (
    SELECT tenant_id, min(id::text)::uuid AS id
      FROM ai_assistants
     WHERE status = 'active'
     GROUP BY tenant_id
    HAVING count(*) = 1
  ) a
 WHERE tc.tenant_id = a.tenant_id
   AND tc.channel_type = 'SAMCHEGUIDE'
   AND tc.assistant_id IS NULL;

-- 4. Converge historical channel_integrations where assistant_id is NULL
-- but tenant_channels has assistant_id.
UPDATE channel_integrations ci
   SET assistant_id = tc.assistant_id,
       updated_at = CURRENT_TIMESTAMP
  FROM tenant_channels tc
 WHERE tc.id = ci.channel_id
   AND tc.tenant_id = ci.tenant_id
   AND ci.integration_type = 'SAMCHEGUIDE'
   AND ci.assistant_id IS NULL
   AND tc.assistant_id IS NOT NULL;

-- 5. Ensure every active AI assistant has a canonical SAMCHEGUIDE channel
INSERT INTO tenant_channels (
  tenant_id,
  assistant_id,
  channel_type,
  display_name,
  external_channel_id,
  status
)
SELECT
  a.tenant_id,
  a.id,
  'SAMCHEGUIDE',
  'AI Guide',
  'guide:' || a.id,
  'active'
  FROM ai_assistants a
 WHERE a.status = 'active'
   AND NOT EXISTS (
     SELECT 1
       FROM tenant_channels tc
      WHERE tc.tenant_id = a.tenant_id
        AND tc.assistant_id = a.id
        AND tc.channel_type = 'SAMCHEGUIDE'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM tenant_channels tc
      WHERE tc.tenant_id = a.tenant_id
        AND tc.channel_type = 'SAMCHEGUIDE'
        AND tc.external_channel_id = 'guide:' || a.id
   );

-- 6. Ensure every active assistant's SAMCHEGUIDE channel has a channel_integration
INSERT INTO channel_integrations (
  integration_key,
  integration_type,
  tenant_id,
  channel_id,
  assistant_id,
  enabled
)
SELECT
  'guide:' || tc.tenant_id || ':' || tc.assistant_id,
  'SAMCHEGUIDE',
  tc.tenant_id,
  tc.id,
  tc.assistant_id,
  TRUE
  FROM tenant_channels tc
  JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
 WHERE tc.channel_type = 'SAMCHEGUIDE'
   AND tc.status = 'active'
   AND a.status = 'active'
   AND NOT EXISTS (
     SELECT 1
       FROM channel_integrations ci
      WHERE ci.tenant_id = tc.tenant_id
        AND ci.channel_id = tc.id
        AND ci.integration_type = 'SAMCHEGUIDE'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM channel_integrations ci
      WHERE ci.integration_key = 'guide:' || tc.tenant_id || ':' || tc.assistant_id
   );

-- 7. Ensure any disabled integration for an active SAMCHEGUIDE channel is enabled
UPDATE channel_integrations ci
   SET enabled = TRUE,
       updated_at = CURRENT_TIMESTAMP
  FROM tenant_channels tc
 WHERE tc.id = ci.channel_id
   AND tc.tenant_id = ci.tenant_id
   AND tc.channel_type = 'SAMCHEGUIDE'
   AND tc.status = 'active'
   AND ci.integration_type = 'SAMCHEGUIDE'
   AND ci.enabled = FALSE;

COMMIT;
