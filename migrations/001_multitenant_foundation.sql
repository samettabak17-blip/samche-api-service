CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- TENANTS
-- =========================================================

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    system_role VARCHAR(50) NOT NULL
        CHECK (system_role IN ('OWNER', 'CUSTOMER')),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- TENANT USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS tenant_users (
    tenant_id UUID NOT NULL
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    tenant_role VARCHAR(50) NOT NULL
        CHECK (tenant_role IN ('ADMIN', 'AGENT')),

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (tenant_id, user_id)
);

-- =========================================================
-- AI ASSISTANTS
-- =========================================================

CREATE TABLE IF NOT EXISTS ai_assistants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL
        REFERENCES tenants(id)
        ON DELETE CASCADE,

    name VARCHAR(255) NOT NULL,

    system_prompt TEXT,

    model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',

    status VARCHAR(50) NOT NULL DEFAULT 'active',

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id
    ON tenant_users(user_id);

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id
    ON tenant_users(tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_assistants_tenant_id
    ON ai_assistants(tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_assistants_lookup
    ON ai_assistants(tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);

CREATE INDEX IF NOT EXISTS idx_users_system_role
    ON users(system_role);

CREATE INDEX IF NOT EXISTS idx_tenants_status
    ON tenants(status);

CREATE INDEX IF NOT EXISTS idx_ai_assistants_status
    ON ai_assistants(status);
