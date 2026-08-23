export function extractWhatsAppInboundText(message = {}) {
  if (message.text?.body) return message.text.body.trim();
  if (message.button?.text) return message.button.text.trim();
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title.trim();
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title.trim();
  if (message.image?.caption) return message.image.caption.trim();
  if (message.document?.caption) return message.document.caption.trim();
  return '';
}
