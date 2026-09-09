-- Canonical Human Support Lifecycle & Multi-Level Escalation Chain
BEGIN;

INSERT INTO platform_lifecycle_message_templates (message_key, locale, body, allowed_variables) VALUES
  ('human_support_default_topic', 'tr', 'Genel destek', ARRAY[]::TEXT[]),
  ('human_support_default_topic', 'en', 'General support', ARRAY[]::TEXT[]),
  ('human_support_default_topic', 'ar', 'الدعم العام', ARRAY[]::TEXT[]),
  ('human_support_request', 'tr', 'Canlı temsilci ile görüşme talebinizi aldım. {TOPIC} konusuyla ilgili size en doğru desteği sağlayabilmek için sizi canlı müşteri temsilcimize aktarıyorum.

Talebiniz işlem sırasına alınacak, en kısa süre içinde canlı müşteri temsilcimize bağlanacaksınız.

Müşteri temsilcimize bağlanırken lütfen beklemede kalın ⌛️.', ARRAY['TOPIC']),
  ('human_support_request', 'en', 'I have received your request to speak with a live representative. Regarding {TOPIC}, I am transferring you to our live customer representative to provide the most accurate support.

Your request has been queued, and you will be connected to our live customer representative as soon as possible.

Please stay on hold while we connect you ⌛️.', ARRAY['TOPIC']),
  ('human_support_request', 'ar', 'لقد تلقيت طلبك للتحدث مع ممثل مباشر. بخصوص {TOPIC}، أقوم بتحويلك إلى ممثل خدمة العملاء المباشر لدينا لتقديم الدعم الأنسب لك.

سيتم وضع طلبك في قائمة الانتظار، وسيتم توصيلك بممثلنا المباشر في أقرب وقت ممكن.

يرجى البقاء على الخط أثناء الاتصال بممثل خدمة العملاء لدينا ⌛️.', ARRAY['TOPIC']),
  ('human_session_warning', 'tr', '⚠️ Lütfen dikkat, bu sohbet oturumu 5 dakika sonra sona erecektir.

Ekibimizden yanıt beklerken oturumu aktif tutmak için bu sohbette mesaj gönderebilirsiniz.

Oturumunuz sona ererse, istediğiniz zaman tekrar bizimle iletişime geçmekten çekinmeyin; daha fazla sorunuzda size yardımcı olmaktan memnuniyet duyarız.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'en', '⚠️ Please note that this chat session will end in 5 minutes.

While waiting for our team, you may send a message in this chat to keep the session active.

If your session ends, you are welcome to contact us again at any time; we will be happy to help with further questions.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'ar', '⚠️ يرجى الانتباه، ستنتهي جلسة الدردشة هذه بعد 5 دقائق.

أثناء انتظار رد فريقنا، يمكنك إرسال رسالة في هذه الدردشة للحفاظ على الجلسة نشطة.

إذا انتهت جلستك، يمكنك التواصل معنا مرة أخرى في أي وقت، ويسعدنا مساعدتك في أي أسئلة إضافية.', ARRAY[]::TEXT[]),
  ('human_takeover', 'tr', 'DİKKAT⚠️ Canlı temsilcimiz bu konuşmayı devralmıştır. Lütfen sohbete bağlanana kadar beklemede kalın ⌛️

⚠️Canlı temsilci bu konuşmayı sonlandırmadığı sürece yapay zeka danışmanı devre dışıdır.🔒', ARRAY[]::TEXT[]),
  ('human_takeover', 'en', 'ATTENTION ⚠️ Our live representative has taken over this conversation. Please remain on hold until connected ⌛️

⚠️ The AI assistant remains disabled until the live representative ends this conversation. 🔒', ARRAY[]::TEXT[]),
  ('human_takeover', 'ar', 'تنبيه ⚠️ تولى ممثلنا المباشر هذه المحادثة. يرجى البقاء في الانتظار حتى يتم الاتصال ⌛️

⚠️ سيظل مساعد الذكاء الاصطناعي معطلاً حتى ينهي الممثل المباشر هذه المحادثة. 🔒', ARRAY[]::TEXT[]),
  ('return_to_ai', 'tr', '🔒 Bu sohbet oturumu sona ermiştir.

Başka sorularınız varsa veya ek yardıma ihtiyacınız olursa, lütfen istediğiniz zaman tekrar bizimle iletişime geçmekten çekinmeyin. Canlı Destek Ekibimiz size yardımcı olmaktan mutluluk duyacaktır.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'en', '🔒 This chat session has ended.

If you have further questions or need additional assistance, please feel free to contact us again at any time. Our Live Support Team will be happy to help.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'ar', '🔒 انتهت جلسة الدردشة هذه.

إذا كانت لديك أسئلة أخرى أو احتجت إلى مساعدة إضافية، فلا تتردد في التواصل معنا مرة أخرى في أي وقت. سيسعد فريق الدعم المباشر لدينا بمساعدتك.', ARRAY[]::TEXT[])
ON CONFLICT (message_key, locale) DO UPDATE
  SET body = EXCLUDED.body,
      allowed_variables = EXCLUDED.allowed_variables,
      active = TRUE,
      updated_at = CURRENT_TIMESTAMP;

-- 2. Update canonical ensure_tenant_platform_capabilities function to guarantee
-- 5 + 5 minute escalation chain: Level 1 (ASSIGNED_OWNER, 300s) -> Level 2 (ROLE: ADMIN, 300s)
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
