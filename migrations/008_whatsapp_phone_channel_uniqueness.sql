-- Enforce one Meta WhatsApp phone-number channel globally while preserving tenant-scoped ownership.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_channels_whatsapp_phone_number
  ON tenant_channels(external_channel_id)
  WHERE channel_type = 'WHATSAPP' AND external_channel_id IS NOT NULL;
