/**
 * Persists an assistant response under the existing handling-version guard,
 * then delivers it through the configured WhatsApp route. Provider acceptance is
 * not considered successful until the real WhatsApp message id is persisted on
 * the exact assistant message row.
 */
export async function persistAndDeliverWhatsAppAssistant({
  tenantId,
  conversationId,
  handlingVersion,
  knowledgeAuthority,
  idempotencyKey = null,
  recipient,
  content,
  persistAssistantResponse,
  persistProviderMessageId,
  deliver,
}) {
  console.info('WHATSAPP_ASSISTANT_SEND stage=STARTED');
  const persisted = await persistAssistantResponse({
    tenantId,
    conversationId,
    content,
    handlingVersion,
    ...(knowledgeAuthority ? { knowledgeAuthority } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  if (!persisted?.delivered) return { delivered: false, message: persisted?.message ?? null };

  let stage = 'PROVIDER_REQUEST';
  try {
    console.info('WHATSAPP_ASSISTANT_SEND stage=PROVIDER_REQUEST');
    const delivery = await deliver(recipient, content);
    const providerMessageId = String(delivery?.providerMessageId ?? delivery?.providerMessageIds?.[0] ?? '').trim();
    if (!providerMessageId) {
      const error = new Error('WhatsApp provider response did not include a message id');
      error.code = 'WHATSAPP_ASSISTANT_SEND_UNCORRELATED';
      throw error;
    }

    stage = 'PROVIDER_ACCEPTED';
    console.info('WHATSAPP_ASSISTANT_SEND stage=PROVIDER_ACCEPTED wamid_present=1');
    const message = await persistProviderMessageId({
      tenantId,
      conversationId,
      messageId: persisted.message.id,
      providerMessageId,
    });
    stage = 'WAMID_PERSISTED';
    console.info('WHATSAPP_ASSISTANT_SEND stage=WAMID_PERSISTED');
    console.info('WHATSAPP_ASSISTANT_SEND stage=COMPLETED');
    return { delivered: true, message, delivery, providerMessageId };
  } catch (error) {
    console.error('WHATSAPP_ASSISTANT_SEND stage=FAILED failure_stage=' + stage + ' code=' + (error?.code ?? error?.name ?? 'UNKNOWN'));
    throw error;
  }
}
