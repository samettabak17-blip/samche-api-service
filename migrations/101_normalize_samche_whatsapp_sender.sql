-- Migration 101: Normalize all WhatsApp tenant channels and integrations for SamChe to Phone Number ID 1376040765584173

UPDATE tenant_channels
   SET external_channel_id = '1376040765584173',
       status = 'active',
       updated_at = CURRENT_TIMESTAMP
 WHERE tenant_id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'
   AND UPPER(channel_type) = 'WHATSAPP';

UPDATE channel_integrations
   SET integration_key = 'whatsapp:1376040765584173',
       enabled = TRUE,
       config = jsonb_set(
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

UPDATE tenant_channels tc
   SET external_channel_id = '1376040765584173',
       status = 'active',
       updated_at = CURRENT_TIMESTAMP
  FROM channel_integrations ci
 WHERE ci.channel_id = tc.id
   AND ci.tenant_id = 'b85d7e7b-d52e-4541-92e7-284a6a67024b'
   AND UPPER(ci.integration_type) = 'WHATSAPP';
