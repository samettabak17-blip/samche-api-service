-- Migration 100: Configure canonical WhatsApp Phone Number ID and WABA ID in channel_integrations config

UPDATE channel_integrations
   SET config = jsonb_set(
         jsonb_set(
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
         '{phone_number_id}',
         '"1376040765584173"'::jsonb,
         true
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'
   AND UPPER(integration_type) = 'WHATSAPP';

