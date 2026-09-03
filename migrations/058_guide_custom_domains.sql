-- Public Guide hostname bindings are durable infrastructure identity. They are
-- intentionally independent of Business Profile/Configuration/Experience state.
CREATE TABLE IF NOT EXISTS guide_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  channel_id UUID NOT NULL,
  hostname VARCHAR(253) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'ACTIVE', 'FAILED', 'ARCHIVED')),
  verification_record_type VARCHAR(16) NOT NULL DEFAULT 'CNAME'
    CHECK (verification_record_type IN ('CNAME')),
  verification_target VARCHAR(253) NOT NULL,
  verification_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_guide_domain_hostname UNIQUE (hostname),
  CONSTRAINT ck_guide_domain_hostname_normalized
    CHECK (hostname = lower(hostname) AND hostname !~ '\\.$'),
  CONSTRAINT fk_guide_domain_assistant
    FOREIGN KEY (assistant_id, tenant_id)
    REFERENCES ai_assistants(id, tenant_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_guide_domain_channel
    FOREIGN KEY (channel_id, tenant_id)
    REFERENCES tenant_channels(id, tenant_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_guide_domains_active_hostname
  ON guide_domains (hostname) WHERE status='ACTIVE';

CREATE INDEX IF NOT EXISTS idx_guide_domains_scope
  ON guide_domains (tenant_id, assistant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS guide_domain_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assistant_id UUID NOT NULL,
  domain_id UUID REFERENCES guide_domains(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(24) NOT NULL CHECK (event_type IN ('CREATED', 'VERIFIED', 'ACTIVATED', 'FAILED', 'ARCHIVED')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guide_domain_audit_scope
  ON guide_domain_audit_events (tenant_id, assistant_id, created_at DESC);
