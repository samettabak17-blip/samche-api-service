-- Canonical Human Support Platform Experience Restoration
-- Restores deterministic non-quoting lifecycle messages, operator auto-assignment parity,
-- and clean return-to-ai wording across TR, EN, AR.
BEGIN;

INSERT INTO platform_lifecycle_message_templates (message_key, locale, body, allowed_variables) VALUES
  ('human_support_default_topic', 'tr', 'Genel destek', ARRAY[]::TEXT[]),
  ('human_support_default_topic', 'en', 'General support', ARRAY[]::TEXT[]),
  ('human_support_default_topic', 'ar', 'الدعم العام', ARRAY[]::TEXT[]),
  ('human_support_request', 'tr', 'Canlı destek talebinizi aldık. Görüşmeniz canlı destek ekibimize aktarılıyor, bir ekip üyesi en kısa sürede yardımcı olacaktır.', ARRAY[]::TEXT[]),
  ('human_support_request', 'en', 'We have received your live support request. We are transferring you to our live support team, and a team member will assist you shortly.', ARRAY[]::TEXT[]),
  ('human_support_request', 'ar', 'لقد تلقينا طلب الدعم المباشر الخاص بك. نقوم بتحويل المحادثة إلى فريق الدعم المباشر لدينا، وسيقوم أحد أعضاء الفريق بمساعدتك في أقرب وقت.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'tr', 'Canlı destek talebiniz açık. Beklerken bu konuşmaya mesaj göndererek oturumu aktif tutabilirsiniz.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'en', 'Your live support request is open. You can send messages to this conversation while waiting to keep the session active.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'ar', 'طلب الدعم المباشر الخاص بك مفتوح. يمكنك إرسال رسائل في هذه المحادثة أثناء الانتظار للحفاظ على الجلسة نشطة.', ARRAY[]::TEXT[]),
  ('human_takeover', 'tr', 'Canlı destek ekibi bu konuşmayı devraldı. Ekip konuşmayı sonlandırana kadar AI yanıt vermeyecektir.', ARRAY[]::TEXT[]),
  ('human_takeover', 'en', 'Our live support team has taken over this conversation. The AI assistant will not respond until the team ends the session.', ARRAY[]::TEXT[]),
  ('human_takeover', 'ar', 'تولى فريق الدعم المباشر هذه المحادثة. لن يستجيب مساعد الذكاء الاصطناعي حتى ينهي الفريق الجلسة.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'tr', 'Canlı destek oturumu sona erdi. AI asistanıyla sohbete devam edebilirsiniz.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'en', 'The live support session has ended. You may continue chatting with the AI assistant.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'ar', 'انتهت جلسة الدعم المباشر. يمكنك متابعة الدردشة مع مساعد الذكاء الاصطناعي.', ARRAY[]::TEXT[])
ON CONFLICT (message_key, locale) DO UPDATE
  SET body = EXCLUDED.body,
      allowed_variables = EXCLUDED.allowed_variables,
      active = TRUE,
      updated_at = CURRENT_TIMESTAMP;

-- 2. Update ensure_tenant_platform_capabilities function to guarantee 5 + 5 escalation chain
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
  ON CONFLICT (policy_id, level_order) DO UPDATE
    SET recipient_rule = EXCLUDED.recipient_rule,
        acknowledgement_timeout_seconds = EXCLUDED.acknowledgement_timeout_seconds;

  INSERT INTO human_support_escalation_levels
    (policy_id, tenant_id, level_order, recipient_rule, recipient_target, acknowledgement_timeout_seconds)
  VALUES (policy_uuid, target_tenant_id, 2, 'ROLE', '{"role": "ADMIN"}'::jsonb, 300)
  ON CONFLICT (policy_id, level_order) DO UPDATE
    SET recipient_rule = EXCLUDED.recipient_rule,
        recipient_target = EXCLUDED.recipient_target,
        acknowledgement_timeout_seconds = EXCLUDED.acknowledgement_timeout_seconds;

  INSERT INTO tenant_platform_provisioning (tenant_id, manifest_version)
  VALUES (target_tenant_id, target_manifest_version)
  ON CONFLICT (tenant_id) DO UPDATE
    SET manifest_version = GREATEST(tenant_platform_provisioning.manifest_version, EXCLUDED.manifest_version),
        updated_at = CURRENT_TIMESTAMP;
END $$;

-- 3. Idempotently backfill all historical and existing tenants
SELECT ensure_tenant_platform_capabilities(id, 1) FROM tenants ORDER BY id;

COMMIT;
