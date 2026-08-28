-- Revoked knowledge must not remain authoritative through persisted provider history.
-- Epochs are tenant + Assistant scoped and bump in the same transaction as authority changes.
ALTER TABLE ai_assistants
  ADD COLUMN IF NOT EXISTS knowledge_authority_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS authority_assistant_id UUID,
  ADD COLUMN IF NOT EXISTS knowledge_authority_version BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_assistants_knowledge_authority_version'
  ) THEN
    ALTER TABLE ai_assistants
      ADD CONSTRAINT chk_ai_assistants_knowledge_authority_version
      CHECK (knowledge_authority_version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_messages_knowledge_authority_version'
  ) THEN
    ALTER TABLE conversation_messages
      ADD CONSTRAINT chk_conversation_messages_knowledge_authority_version
      CHECK (knowledge_authority_version IS NULL OR knowledge_authority_version > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_messages_authority_provenance_pair'
  ) THEN
    ALTER TABLE conversation_messages
      ADD CONSTRAINT chk_conversation_messages_authority_provenance_pair
      CHECK (
        (authority_assistant_id IS NULL AND knowledge_authority_version IS NULL)
        OR
        (authority_assistant_id IS NOT NULL AND knowledge_authority_version IS NOT NULL)
      );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'fk_conversation_messages_authority_assistant'
       AND confdeltype <> 'r'
  ) THEN
    ALTER TABLE conversation_messages
      DROP CONSTRAINT fk_conversation_messages_authority_assistant;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversation_messages_authority_assistant'
  ) THEN
    ALTER TABLE conversation_messages
      ADD CONSTRAINT fk_conversation_messages_authority_assistant
      FOREIGN KEY (authority_assistant_id, tenant_id)
      REFERENCES ai_assistants(id, tenant_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_provider_authority
  ON conversation_messages (
    tenant_id,
    conversation_id,
    authority_assistant_id,
    knowledge_authority_version,
    created_at DESC
  );

CREATE OR REPLACE FUNCTION stamp_conversation_message_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Never trust caller-supplied provenance. Resolve it from the tenant-scoped
  -- conversation channel and current Assistant epoch in this transaction.
  NEW.authority_assistant_id := NULL;
  NEW.knowledge_authority_version := NULL;

  SELECT assistant.id, assistant.knowledge_authority_version
    INTO NEW.authority_assistant_id, NEW.knowledge_authority_version
    FROM conversations AS conversation
    JOIN tenant_channels AS channel
      ON channel.id = conversation.channel_id
     AND channel.tenant_id = conversation.tenant_id
    JOIN ai_assistants AS assistant
      ON assistant.id = channel.assistant_id
     AND assistant.tenant_id = channel.tenant_id
   WHERE conversation.id = NEW.conversation_id
     AND conversation.tenant_id = NEW.tenant_id
     AND channel.status = 'active'
     AND assistant.status = 'active'
   LIMIT 1;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_conversation_message_authority ON conversation_messages;
CREATE TRIGGER trg_stamp_conversation_message_authority
BEFORE INSERT ON conversation_messages
FOR EACH ROW EXECUTE FUNCTION stamp_conversation_message_authority();

CREATE OR REPLACE FUNCTION bump_assistant_knowledge_authority(
  authority_tenant_id UUID,
  authority_assistant_id UUID
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE ai_assistants
     SET knowledge_authority_version = knowledge_authority_version + 1
   WHERE tenant_id = authority_tenant_id
     AND id = authority_assistant_id;
END;
$$;

CREATE OR REPLACE FUNCTION bump_knowledge_source_assignment_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_assistant_knowledge_authority(NEW.tenant_id, NEW.assistant_id);
    RETURN NEW;
  END IF;

  PERFORM bump_assistant_knowledge_authority(OLD.tenant_id, OLD.assistant_id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_knowledge_source_assignment_authority ON knowledge_source_assistants;
CREATE TRIGGER trg_knowledge_source_assignment_authority
AFTER INSERT OR DELETE ON knowledge_source_assistants
FOR EACH ROW EXECUTE FUNCTION bump_knowledge_source_assignment_authority();

CREATE OR REPLACE FUNCTION bump_task6_source_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.content_hash IS NULL AND OLD.content_hash IS NULL THEN
    RETURN NEW;
  END IF;

  IF (
       NEW.status = 'active'
       AND NEW.enabled = TRUE
       AND NEW.processing_status = 'READY'
       AND NEW.indexing_status = 'READY'
     ) IS NOT DISTINCT FROM (
       OLD.status = 'active'
       AND OLD.enabled = TRUE
       AND OLD.processing_status = 'READY'
       AND OLD.indexing_status = 'READY'
     ) THEN
    RETURN NEW;
  END IF;

  UPDATE ai_assistants AS assistant
     SET knowledge_authority_version = assistant.knowledge_authority_version + 1
   WHERE assistant.tenant_id = NEW.tenant_id
     AND EXISTS (
       SELECT 1
         FROM knowledge_source_assistants AS assignment
        WHERE assignment.tenant_id = NEW.tenant_id
          AND assignment.source_id = NEW.id
          AND assignment.assistant_id = assistant.id
     );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task6_source_authority ON knowledge_base_documents;
CREATE TRIGGER trg_task6_source_authority
AFTER UPDATE OF status, enabled, processing_status, indexing_status
ON knowledge_base_documents
FOR EACH ROW EXECUTE FUNCTION bump_task6_source_authority();

CREATE OR REPLACE FUNCTION bump_legacy_knowledge_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_tenant_id UUID;
  old_assistant_id UUID;
  new_assistant_id UUID;
  old_is_global BOOLEAN := FALSE;
  new_is_global BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.content_hash IS NOT NULL THEN
      RETURN NEW;
    END IF;
    affected_tenant_id := NEW.tenant_id;
    new_assistant_id := NEW.assistant_id;
    new_is_global := NEW.assistant_id IS NULL;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.content_hash IS NOT NULL THEN
      RETURN OLD;
    END IF;
    affected_tenant_id := OLD.tenant_id;
    old_assistant_id := OLD.assistant_id;
    old_is_global := OLD.assistant_id IS NULL;
  ELSE
    IF OLD.content_hash IS NOT NULL AND NEW.content_hash IS NOT NULL THEN
      RETURN NEW;
    END IF;

    IF ROW(NEW.assistant_id, NEW.content, NEW.status, NEW.enabled)
       IS NOT DISTINCT FROM
       ROW(OLD.assistant_id, OLD.content, OLD.status, OLD.enabled) THEN
      RETURN NEW;
    END IF;

    affected_tenant_id := NEW.tenant_id;
    old_assistant_id := CASE WHEN OLD.content_hash IS NULL THEN OLD.assistant_id END;
    new_assistant_id := CASE WHEN NEW.content_hash IS NULL THEN NEW.assistant_id END;
    old_is_global := OLD.content_hash IS NULL AND OLD.assistant_id IS NULL;
    new_is_global := NEW.content_hash IS NULL AND NEW.assistant_id IS NULL;
  END IF;

  UPDATE ai_assistants AS assistant
     SET knowledge_authority_version = assistant.knowledge_authority_version + 1
   WHERE assistant.tenant_id = affected_tenant_id
     AND assistant.status = 'active'
     AND (
       old_is_global
       OR new_is_global
       OR assistant.id = old_assistant_id
       OR assistant.id = new_assistant_id
     );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legacy_knowledge_authority ON knowledge_base_documents;
CREATE TRIGGER trg_legacy_knowledge_authority
AFTER INSERT OR DELETE OR UPDATE OF assistant_id, content, status, enabled, content_hash
ON knowledge_base_documents
FOR EACH ROW EXECUTE FUNCTION bump_legacy_knowledge_authority();

CREATE OR REPLACE FUNCTION bump_active_configuration_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.active_configuration_version_id IS DISTINCT FROM OLD.active_configuration_version_id THEN
    NEW.knowledge_authority_version := OLD.knowledge_authority_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_active_configuration_authority ON ai_assistants;
CREATE TRIGGER trg_active_configuration_authority
BEFORE UPDATE OF active_configuration_version_id ON ai_assistants
FOR EACH ROW EXECUTE FUNCTION bump_active_configuration_authority();

CREATE OR REPLACE FUNCTION bump_active_business_profile_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.active_version_id IS NOT DISTINCT FROM OLD.active_version_id THEN
    RETURN NEW;
  END IF;

  UPDATE ai_assistants AS assistant
     SET knowledge_authority_version = assistant.knowledge_authority_version + 1
   WHERE assistant.tenant_id = NEW.tenant_id
     AND assistant.status = 'active';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_active_business_profile_authority ON business_profiles;
CREATE TRIGGER trg_active_business_profile_authority
AFTER UPDATE OF active_version_id ON business_profiles
FOR EACH ROW EXECUTE FUNCTION bump_active_business_profile_authority();
