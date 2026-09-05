-- Backward-compatible human-support policy repair for enabled WhatsApp
-- integrations. Existing tenant wording and explicit disable flags win; this
-- only fills missing policy keys with neutral platform wording.
WITH defaults AS (
  SELECT jsonb_build_object(
    'general_topic', jsonb_build_object(
      'tr', 'Genel destek',
      'en', 'General support',
      'ar', 'الدعم العام'
    ),
    'transfer', jsonb_build_object(
      'tr', 'Canlı destek talebinizi aldık. {{topicSummary}} konusunda bir ekip üyesi yardımcı olacaktır.',
      'en', 'We have received your human-support request. A team member will assist you with {{topicSummary}}.',
      'ar', 'تلقينا طلبك للدعم البشري. سيساعدك أحد أعضاء الفريق بخصوص {{topicSummary}}.'
    ),
    'manual_takeover', jsonb_build_object(
      'tr', 'Canlı destek ekibi bu konuşmayı devraldı. Ekip konuşmayı sonlandırana kadar AI yanıt vermeyecektir.',
      'en', 'The human-support team has taken over this conversation. AI responses remain paused until the team closes it.',
      'ar', 'تولى فريق الدعم البشري هذه المحادثة. ستتوقف ردود الذكاء الاصطناعي حتى ينهي الفريق المحادثة.'
    ),
    'warning_5m', jsonb_build_object(
      'tr', 'Canlı destek talebiniz açık. Beklerken bu konuşmaya mesaj göndererek oturumu aktif tutabilirsiniz.',
      'en', 'Your human-support request remains open. You may send a message here to keep the conversation active while waiting.',
      'ar', 'لا يزال طلب الدعم البشري مفتوحًا. يمكنك إرسال رسالة هنا للحفاظ على المحادثة نشطة أثناء الانتظار.'
    ),
    'timeout_close', jsonb_build_object(
      'tr', 'Canlı destek oturumu sona erdi. Dilediğiniz zaman yeniden destek isteyebilirsiniz.',
      'en', 'The human-support session has ended. You may request support again at any time.',
      'ar', 'انتهت جلسة الدعم البشري. يمكنك طلب الدعم مرة أخرى في أي وقت.'
    ),
    'return_to_ai', jsonb_build_object(
      'tr', 'Canlı destek oturumu sona erdi. AI asistanıyla sohbete devam edebilirsiniz.',
      'en', 'The human-support session has ended. You may continue with the AI assistant.',
      'ar', 'انتهت جلسة الدعم البشري. يمكنك متابعة المحادثة مع مساعد الذكاء الاصطناعي.'
    )
  ) AS human_support
), eligible AS (
  SELECT DISTINCT ci.tenant_id, ci.assistant_id
    FROM channel_integrations ci
    JOIN tenant_channels tc ON tc.id = ci.channel_id AND tc.tenant_id = ci.tenant_id
    JOIN ai_assistants a ON a.id = ci.assistant_id AND a.tenant_id = ci.tenant_id
    JOIN tenants t ON t.id = ci.tenant_id
   WHERE ci.integration_type = 'WHATSAPP'
     AND ci.enabled = TRUE
     AND tc.channel_type = 'WHATSAPP'
     AND tc.status = 'active'
     AND a.status = 'active'
     AND t.status = 'active'
), candidates AS (
  SELECT a.id, a.tenant_id,
         COALESCE(a.whatsapp_response_templates, '{}'::jsonb)
         || jsonb_build_object(
           'human_support',
           defaults.human_support || COALESCE(a.whatsapp_response_templates -> 'human_support', '{}'::jsonb)
         ) AS templates
    FROM ai_assistants a
    JOIN eligible e ON e.tenant_id = a.tenant_id AND e.assistant_id = a.id
   CROSS JOIN defaults
)
UPDATE ai_assistants a
   SET whatsapp_response_templates = candidates.templates,
       updated_at = CURRENT_TIMESTAMP
  FROM candidates
 WHERE a.id = candidates.id
   AND a.tenant_id = candidates.tenant_id
   AND a.whatsapp_response_templates IS DISTINCT FROM candidates.templates;
