/**
 * Persists an assistant response under the existing handling-version guard,
 * then uses the caller's configured channel delivery function. It deliberately
 * does not choose a recipient or channel; those remain conversation-derived.
 */
export async function persistAndDeliverWhatsAppAssistant({
  tenantId,
  conversationId,
  handlingVersion,
  recipient,
  content,
  persistAssistantResponse,
  deliver,
}) {
  const persisted = await persistAssistantResponse({
    tenantId,
    conversationId,
    content,
    handlingVersion,
  });
  if (!persisted?.delivered) return { delivered: false, message: persisted?.message ?? null };
  await deliver(recipient, content);
  return { delivered: true, message: persisted.message };
}
