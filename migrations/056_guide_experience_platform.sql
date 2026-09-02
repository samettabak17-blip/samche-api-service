-- Tenant-owned white-label Guide experience versions.  Runtime intelligence
-- remains in the active Business Profile/Assistant Configuration lifecycle.
CREATE TABLE IF NOT EXISTS guide_experience_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  experience JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_guide_experience_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_guide_experience_scope_version UNIQUE (tenant_id, assistant_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guide_experience_one_published
  ON guide_experience_versions (tenant_id, assistant_id)
  WHERE status = 'PUBLISHED';

CREATE INDEX IF NOT EXISTS idx_guide_experience_runtime_lookup
  ON guide_experience_versions (tenant_id, assistant_id, version DESC)
  WHERE status = 'PUBLISHED';

CREATE TABLE IF NOT EXISTS guide_experience_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  experience_version_id UUID REFERENCES guide_experience_versions(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL CHECK (event_type IN ('CREATED', 'UPDATED', 'PUBLISHED', 'ROLLED_BACK', 'ASSET_CHANGED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_guide_experience_audit_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_guide_experience_audit_scope
  ON guide_experience_audit_events (tenant_id, assistant_id, created_at DESC);

-- Preserve an already-provisioned Guide without requiring a tenant-specific
-- code branch.  The current tenant and assistant names become ordinary data
-- that administrators may later replace through a Draft and Publish cycle.
INSERT INTO guide_experience_versions (tenant_id, assistant_id, version, status, experience, published_at)
SELECT ci.tenant_id, ci.assistant_id, 1, 'PUBLISHED',
       jsonb_build_object(
         'brand_name', t.name,
         'assistant_display_name', a.name,
         'assistant_status_label', 'Online',
         'welcome_title', 'How can we help?',
         'welcome_message', 'Ask a question to get started.',
         'input_placeholder', 'Type your message',
         'launcher_label', 'Send',
         'empty_state_copy', 'Start a conversation when you are ready.',
         'logo_url', NULL, 'avatar_url', NULL, 'favicon_url', NULL,
         'theme', jsonb_build_object('primary_color','#1F4B99','accent_color','#4F7FD8','background_color','#F7F8FA','foreground_color','#18212F','surface_color','#FFFFFF','border_color','#D9E0EA','font_family','SYSTEM','corner_radius','MEDIUM','density','COMFORTABLE'),
         'layout', jsonb_build_object('preset','PROFESSIONAL','launcher_style','PILL','header_style','STANDARD','panel_style','CARD'),
         'modules', jsonb_build_object('chat',TRUE,'guide',TRUE,'calculator',FALSE,'ctas',TRUE)
       ), CURRENT_TIMESTAMP
  FROM channel_integrations ci
  JOIN tenant_channels tc ON tc.id=ci.channel_id AND tc.tenant_id=ci.tenant_id
  JOIN tenants t ON t.id=ci.tenant_id
  JOIN ai_assistants a ON a.id=ci.assistant_id AND a.tenant_id=ci.tenant_id
 WHERE ci.integration_type='SAMCHEGUIDE' AND ci.enabled=TRUE AND tc.status='active'
   AND NOT EXISTS (SELECT 1 FROM guide_experience_versions existing WHERE existing.tenant_id=ci.tenant_id AND existing.assistant_id=ci.assistant_id);
