-- Tenant-scoped deterministic WhatsApp social-response templates.
-- This configuration is separate from and must never modify assistant system prompts.
ALTER TABLE ai_assistants
  ADD COLUMN IF NOT EXISTS whatsapp_response_templates JSONB;


