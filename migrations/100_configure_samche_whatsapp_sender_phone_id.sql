-- Migration 100: Ensure canonical WhatsApp sender phone number ID and WABA ID are properly configured for SamChe staging tenant

UPDATE tenant_channels
   SET external_channel_id = '1376040765584173',
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'
   AND channel_type = 'WHATSAPP';

UPDATE channel_integrations
   SET integration_key = 'whatsapp:1376040765584173',
       config = jsonb_set(
         jsonb_set(
           COALESCE(config, '{}'::jsonb),
           '{whatsapp,phone_number_id}',
           '"1376040765584173"'::jsonb,
           true
         ),
         '{whatsapp,waba_id}',
         '"947279035146304"'::jsonb,
         true
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'
   AND integration_type = 'WHATSAPP';
