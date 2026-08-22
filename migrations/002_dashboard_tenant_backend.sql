DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_ai_assistants_id_tenant') THEN
    ALTER TABLE ai_assistants ADD CONSTRAINT uq_ai_assistants_id_tenant UNIQUE (id, tenant_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    assistant_id UUID,
    channel_type VARCHAR(50) NOT NULL CHECK (channel_type IN ('WEB_CHAT', 'WHATSAPP')),
    display_name VARCHAR(255) NOT NULL,
    external_channel_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, tenant_id),
    UNIQUE (tenant_id, channel_type, external_channel_id),
    CONSTRAINT fk_tenant_channels_assistant
      FOREIGN KEY (assistant_id, tenant_id)
      REFERENCES ai_assistants(id, tenant_id)
      ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    external_conversation_id VARCHAR(255),
    customer_external_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, tenant_id),
    UNIQUE (channel_id, external_conversation_id),
    CONSTRAINT fk_conversations_channel
      FOREIGN KEY (channel_id, tenant_id)
      REFERENCES tenant_channels(id, tenant_id)
      ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    external_message_id VARCHAR(255),
    sender_type VARCHAR(50) NOT NULL CHECK (sender_type IN ('CUSTOMER', 'ASSISTANT', 'AGENT', 'SYSTEM')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (conversation_id, external_message_id),
    CONSTRAINT fk_conversation_messages_conversation
      FOREIGN KEY (conversation_id, tenant_id)
      REFERENCES conversations(id, tenant_id)
      ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS knowledge_base_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    assistant_id UUID,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (id, tenant_id),
    CONSTRAINT fk_knowledge_base_documents_assistant
      FOREIGN KEY (assistant_id, tenant_id)
      REFERENCES ai_assistants(id, tenant_id)
      ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tenant_channels_tenant_id ON tenant_channels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_created ON conversations(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_created ON conversation_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_documents_tenant_id ON knowledge_base_documents(tenant_id);

