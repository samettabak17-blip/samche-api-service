-- Migration 097: Configure approved Instagram qualified lead WhatsApp notification template for SamChe staging tenant

UPDATE channel_integrations
   SET config = jsonb_set(
         jsonb_set(
           COALESCE(config, '{}'::jsonb),
           '{lead_whatsapp_destination}',
           '"+971527288586"'::jsonb
         ),
         '{lead_notification_template}',
         '{"status": "APPROVED", "name": "instagram_qualified_lead", "language_code": "tr"}'::jsonb
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'
   AND integration_type = 'INSTAGRAM';
