-- Migration 076: Canonical Human Support UX, Exact Templates, and Escalation Invariants Repair
-- Permanently converges deterministic platform lifecycle templates to human-accepted wording
-- across TR, EN, AR and enforces platform parity across all historical and future tenants.

BEGIN;

INSERT INTO platform_lifecycle_message_templates (message_key, locale, body, allowed_variables) VALUES
  ('human_support_default_topic', 'tr', 'Genel Destek', ARRAY[]::TEXT[]),
  ('human_support_default_topic', 'en', 'General Support', ARRAY[]::TEXT[]),
  ('human_support_default_topic', 'ar', 'الدعم العام', ARRAY[]::TEXT[]),
  ('human_support_request', 'tr', 'Canlı temsilci ile görüşme ilgili talebinizi aldım. Genel Destek konusuyla ilgili size en doğru desteği sağlayabilmek için sizi canlı müşteri temsilcimize aktarıyorum.
Talebiniz işlem sırasına alınacak, en kısa süre içinde canlı müşteri temsilcimize bağlanacaksınız.
Müşteri temsilcimize bağlanırken lütfen beklemede kalın ⏳.', ARRAY[]::TEXT[]),
  ('human_support_request', 'en', 'I have received your request to speak with a live representative. In order to provide you with the most accurate support regarding General Support, I am transferring you to our live customer representative.
Your request will be queued, and you will be connected to our live customer representative shortly.
Please stay on the line while connecting to our representative ⏳.', ARRAY[]::TEXT[]),
  ('human_support_request', 'ar', 'لقد تلقيت طلبك للتحدث مع ممثل مباشر. لنقدم لك الدعم الأنسب بخصوص الدعم العام، أقوم بتحويلك إلى ممثل خدمة العملاء المباشر لدينا.
سيتم وضع طلبك في قائمة الانتظار، وسيتم ربطك بممثل خدمة العملاء المباشر في أقرب وقت.
يرجى البقاء على اتصال أثناء الاتصال بممثلنا ⏳.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'tr', 'Canlı destek talebiniz açık. Beklerken bu konuşmaya mesaj göndererek oturumu aktif tutabilirsiniz.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'en', 'Your live support request is open. You can send messages to this conversation while waiting to keep the session active.', ARRAY[]::TEXT[]),
  ('human_session_warning', 'ar', 'طلب الدعم المباشر الخاص بك مفتوح. يمكنك إرسال رسائل في هذه المحادثة أثناء الانتظار للحفاظ على الجلسة نشطة.', ARRAY[]::TEXT[]),
  ('human_takeover', 'tr', 'DİKKAT ⚠️ Canlı temsilcimiz bu konuşmayı devralmıştır. Lütfen sohbete bağlanana kadar beklemede kalın ⏳

⚠️ Canlı temsilcimiz bu konuşmayı sonlandırmadığı sürece yapay zeka danışmanı devre dışıdır. 🔒', ARRAY[]::TEXT[]),
  ('human_takeover', 'en', 'ATTENTION ⚠️ Our live representative has taken over this conversation. Please stay on the line until connected ⏳

⚠️ As long as our live representative does not end this conversation, the AI consultant is disabled. 🔒', ARRAY[]::TEXT[]),
  ('human_takeover', 'ar', 'تنبيه ⚠️ تولى ممثلنا المباشر هذه المحادثة. يرجى البقاء على اتصال حتى يتم الربط ⏳

⚠️ طالما لم يقم ممثلنا المباشر بإنهاء هذه المحادثة، فإن المستشار الذكي معطل. 🔒', ARRAY[]::TEXT[]),
  ('return_to_ai', 'tr', '🔒 Canlı destek oturumu sona ermiştir.

Yapay zeka asistanımızla sohbete devam edebilir ya da canlı temsilciye tekrar bağlanmak isterseniz sohbet alanına ''canlı destek'' yazmanız yeterlidir.
Ekibimiz size her zaman yardımcı olmaktan mutluluk duyacaktır.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'en', '🔒 The live support session has ended.

You may continue chatting with our AI assistant, or if you wish to connect to a live representative again, simply type ''live support'' in the chat.
Our team is always happy to assist you.', ARRAY[]::TEXT[]),
  ('return_to_ai', 'ar', '🔒 انتهت جلسة الدعم المباشر.

يمكنك متابعة الدردشة مع مساعد الذكاء الاصطناعي، أو إذا كنت ترغب في الاتصال بممثل مباشر مرة أخرى، فما عليك سوى كتابة ''دعم مباشر'' في الدردشة.
يسعد فريقنا دائمًا بمساعدتك.', ARRAY[]::TEXT[])
ON CONFLICT (message_key, locale) DO UPDATE
  SET body = EXCLUDED.body,
      allowed_variables = EXCLUDED.allowed_variables,
      active = TRUE,
      updated_at = CURRENT_TIMESTAMP;

-- 2. Idempotently backfill all historical and existing tenants to ensure 5+5 policy baseline
SELECT ensure_tenant_platform_capabilities(id, 1) FROM tenants ORDER BY id;

COMMIT;