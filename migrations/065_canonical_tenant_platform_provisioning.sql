-- One durable baseline ensure function is shared by new-tenant provisioning
-- and historical repair. Feature entities remain absent until explicitly
-- enabled through their normal tenant-owned service paths.
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_platform_provisioning (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  manifest_version INTEGER NOT NULL CHECK (manifest_version > 0),
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS platform_lifecycle_message_templates (
  message_key VARCHAR(64) NOT NULL,
  locale VARCHAR(8) NOT NULL CHECK (locale IN ('tr', 'en', 'ar')),
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  allowed_variables TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_key, locale),
  CHECK (allowed_variables <@ ARRAY['TOPIC']::TEXT[])
);

INSERT INTO platform_lifecycle_message_templates (message_key, locale, body, allowed_variables) VALUES
  ('human_support_default_topic', 'tr', 'Genel destek', ARRAY[]::TEXT[]),
  ('human_support_default_topic', 'en', 'General support', ARRAY[]::TEXT[]),
  ('human_support_default_topic', 'ar', 'الدعم العام', ARRAY[]::TEXT[]),
  ('human_support_request', 'tr', '{TOPIC} konusundaki canlı destek talebinizi aldık. Bir ekip üyesi en kısa sürede yardımcı olacaktır.', ARRAY['TOPIC']),
  ('human_support_request', 'en', 'We received your human-support request about {TOPIC}. A team member will assist you as soon as possible.', ARRAY['TOPIC']),
  ('human_support_request', 'ar', 'تلقينا طلب الدعم البشري بخصوص {TOPIC}. سيساعدك أحد أعضاء الفريق في أقرب وقت ممكن.', ARRAY['TOPIC']),
  ('human_session_warning', 'tr', 'Canlı destek talebiniz açık. Beklerken bu konuşmaya mesaj göndererek oturumu aktif tutabilirsiniz.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'en', 'Your human-support request remains open. You may send a message here to keep the conversation active while waiting.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'ar', 'لا يزال طلب الدعم البشري مفتوحًا. يمكنك إرسال رسالة هنا للحفاظ على المحادثة نشطة أثناء الانتظار.', ARRAY[]::TEXT[]),
  ('human_takeover', 'tr', 'Canlı destek ekibi bu konuşmayı devraldı. Ekip konuşmayı sonlandırana kadar AI yanıt vermeyecektir.', ARRAY[]::TEXT[]),
  ('human_takeover', 'en', 'The human-support team has taken over this conversation. AI responses remain paused until the team closes it.', ARRAY[]::TEXT[]),
  ('human_takeover', 'ar', 'تولى فريق الدعم البشري هذه المحادثة. ستتوقف ردود الذكاء الاصطناعي حتى ينهي الفريق المحادثة.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'tr', 'Canlı destek oturumu sona erdi. AI asistanıyla sohbete devam edebilirsiniz.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'en', 'The human-support session has ended. You may continue with the AI assistant.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'ar', 'انتهت جلسة الدعم البشري. يمكنك متابعة المحادثة مع مساعد الذكاء الاصطناعي.', ARRAY[]::TEXT[])
ON CONFLICT (message_key, locale) DO UPDATE
  SET body = EXCLUDED.body,
      allowed_variables = EXCLUDED.allowed_variables,
      active = TRUE,
      updated_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION ensure_tenant_platform_capabilities(
  target_tenant_id UUID,
  target_manifest_version INTEGER
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  policy_uuid UUID;
BEGIN
  IF target_manifest_version IS NULL OR target_manifest_version < 1 THEN
    RAISE EXCEPTION 'invalid tenant platform manifest version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = target_tenant_id) THEN
    RAISE EXCEPTION 'tenant platform target not found';
  END IF;

  INSERT INTO human_support_escalation_policies (tenant_id, event_type, enabled)
  VALUES (target_tenant_id, 'HUMAN_SUPPORT_REQUESTED', TRUE)
  ON CONFLICT (tenant_id, event_type) DO UPDATE
    SET updated_at = human_support_escalation_policies.updated_at
  RETURNING id INTO policy_uuid;

  INSERT INTO human_support_escalation_levels
    (policy_id, tenant_id, level_order, recipient_rule, acknowledgement_timeout_seconds)
  VALUES (policy_uuid, target_tenant_id, 1, 'ASSIGNED_OWNER', 300)
  ON CONFLICT (policy_id, level_order) DO NOTHING;

  INSERT INTO tenant_platform_provisioning (tenant_id, manifest_version)
  VALUES (target_tenant_id, target_manifest_version)
  ON CONFLICT (tenant_id) DO UPDATE
    SET manifest_version = GREATEST(tenant_platform_provisioning.manifest_version, EXCLUDED.manifest_version),
        updated_at = CURRENT_TIMESTAMP;
END $$;

SELECT ensure_tenant_platform_capabilities(id, 1) FROM tenants ORDER BY id;

-- The application provisioning/repair service now invokes the same function.
-- Remove the older independent new-row authority after every tenant is repaired.
DROP TRIGGER IF EXISTS trg_tenants_human_support_escalation_policy ON tenants;
DROP FUNCTION IF EXISTS provision_human_support_escalation_policy();

COMMIT;
