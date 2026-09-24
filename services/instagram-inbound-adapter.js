/**
 * Instagram Inbound Webhook Event Adapter
 *
 * Normalizes incoming Meta Graph API Instagram messaging webhook payloads into
 * canonical platform event structures.
 *
 * Provider payload structures remain isolated inside this adapter.
 */

export function isInstagramWebhookEvent(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.object === 'instagram') return true;
  if (Array.isArray(body.entry) && body.entry.some((e) => Array.isArray(e?.messaging) && e.messaging.length > 0)) {
    return true;
  }
  return false;
}

export function isWhatsAppWebhookEvent(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.object === 'whatsapp_business_account') return true;
  if (Array.isArray(body.entry) && body.entry.some((e) => Array.isArray(e?.changes) && e.changes.length > 0)) {
    return true;
  }
  return false;
}

export function parseInstagramMessagingEvent(entry, messagingEvent) {
  if (!messagingEvent || typeof messagingEvent !== 'object') return null;

  const senderId = String(messagingEvent.sender?.id ?? '').trim();
  const recipientId = String(messagingEvent.recipient?.id ?? entry?.id ?? '').trim();
  const timestamp = Number(messagingEvent.timestamp || entry?.time || Date.now());

  // Echo and self-message detection (must be dropped to prevent message loops)
  const isEcho = Boolean(
    messagingEvent.message?.is_echo ||
    messagingEvent.is_self ||
    messagingEvent.message?.is_self
  );

  const messageId = messagingEvent.message?.mid || messagingEvent.postback?.mid || null;
  let text = '';
  if (typeof messagingEvent.message?.text === 'string') {
    text = messagingEvent.message.text;
  } else if (typeof messagingEvent.postback?.title === 'string') {
    text = messagingEvent.postback.title;
  } else if (typeof messagingEvent.postback?.payload === 'string') {
    text = messagingEvent.postback.payload;
  }

  const quickReplyPayload = messagingEvent.message?.quick_reply?.payload || null;
  const postbackPayload = messagingEvent.postback?.payload || null;
  const replyToMid = messagingEvent.message?.reply_to?.mid || null;

  // Attachment normalization
  const rawAttachments = Array.isArray(messagingEvent.message?.attachments)
    ? messagingEvent.message.attachments
    : [];

  const attachments = rawAttachments.map((att) => {
    const type = String(att?.type ?? 'file').toLowerCase();
    const url = typeof att?.payload?.url === 'string' ? att.payload.url.trim() : null;
    return {
      type,
      url,
      title: att?.title || null,
    };
  }).filter((att) => Boolean(att.url));

  // Determine if this is a story mention or share
  const isStoryMention = rawAttachments.some((att) => att?.type === 'story_mention');
  const isShare = rawAttachments.some((att) => att?.type === 'share');

  return {
    senderId,
    recipientId,
    timestamp,
    isEcho,
    messageId,
    text: text.trim(),
    quickReplyPayload,
    postbackPayload,
    replyToMid,
    attachments,
    isStoryMention,
    isShare,
    rawEventType: messagingEvent.postback ? 'postback' : (messagingEvent.message ? 'message' : 'unknown'),
  };
}

export function extractInstagramInboundEvents(body) {
  if (!body || !Array.isArray(body.entry)) return [];

  const events = [];
  for (const entry of body.entry) {
    if (!Array.isArray(entry?.messaging)) continue;
    for (const messagingEvent of entry.messaging) {
      const parsed = parseInstagramMessagingEvent(entry, messagingEvent);
      if (parsed) {
        events.push(parsed);
      }
    }
  }
  return events;
}
