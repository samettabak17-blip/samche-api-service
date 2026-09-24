import axios from 'axios';
import { instagramGraphApiBase } from './meta-graph-api-version.js';

export class InstagramDeliveryError extends Error {
  constructor(code, message = code, status = 502) {
    super(message);
    this.name = 'InstagramDeliveryError';
    this.code = code;
    this.status = status;
  }
}

function sanitizeMetaError(error) {
  const metaError = error?.response?.data?.error;
  const status = error?.response?.status || 502;
  const message = metaError?.message || error?.message || 'Instagram delivery failed';
  const code = metaError?.code ? `META_IG_ERROR_${metaError.code}` : (error?.code || 'INSTAGRAM_DELIVERY_FAILED');
  return new InstagramDeliveryError(code, message, status >= 500 ? 502 : 409);
}

export async function deliverInstagramText({
  recipientId,
  content,
  accessToken,
  pageId = 'me',
  instagramAccountId = null,
  http = axios,
  graphVersion,
}) {
  if (!recipientId || typeof recipientId !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_RECIPIENT_REQUIRED', 'Valid Instagram recipient ID is required', 400);
  }
  if (!content || typeof content !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_CONTENT_REQUIRED', 'Non-empty message content is required', 400);
  }
  if (!accessToken || typeof accessToken !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_CREDENTIAL_REQUIRED', 'Instagram access token is not configured', 409);
  }

  const baseUrl = instagramGraphApiBase();
  const targetId = String(instagramAccountId || pageId || 'me').trim();
  const endpoint = `${baseUrl}/${targetId}/messages`;

  const payload = {
    recipient: { id: recipientId },
    message: { text: content.trim() },
  };

  try {
    const response = await http.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const providerMessageId = response.data?.message_id || null;
    return {
      delivery: 'SENT_TO_INSTAGRAM',
      recipientId: response.data?.recipient_id || recipientId,
      providerMessageId,
    };
  } catch (error) {
    if (error instanceof InstagramDeliveryError) throw error;
    throw sanitizeMetaError(error);
  }
}

export async function deliverInstagramMedia({
  recipientId,
  mediaUrl,
  mediaCategory = 'IMAGE',
  caption = '',
  accessToken,
  pageId = 'me',
  instagramAccountId = null,
  http = axios,
  graphVersion,
}) {
  if (!recipientId || typeof recipientId !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_RECIPIENT_REQUIRED', 'Valid Instagram recipient ID is required', 400);
  }
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_MEDIA_URL_REQUIRED', 'Publicly accessible media URL is required', 400);
  }
  if (!accessToken || typeof accessToken !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_CREDENTIAL_REQUIRED', 'Instagram access token is not configured', 409);
  }

  const category = String(mediaCategory).toUpperCase();
  const attachmentType = category === 'IMAGE' ? 'image'
    : category === 'AUDIO' ? 'audio'
    : category === 'VIDEO' ? 'video'
    : 'file';

  const baseUrl = instagramGraphApiBase();
  const targetId = String(instagramAccountId || pageId || 'me').trim();
  const endpoint = `${baseUrl}/${targetId}/messages`;

  const payload = {
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: attachmentType,
        payload: { url: mediaUrl.trim() },
      },
    },
  };

  try {
    const response = await http.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });

    const providerMessageId = response.data?.message_id || null;

    // If caption provided and distinct, optionally deliver caption text
    if (caption && caption.trim() && category !== 'AUDIO') {
      try {
        await deliverInstagramText({
          recipientId,
          content: caption.trim(),
          accessToken,
          pageId: targetId,
          instagramAccountId: targetId,
          http,
          graphVersion,
        });
      } catch (captionErr) {
        console.warn('INSTAGRAM_CAPTION_SEND_WARN', captionErr?.message);
      }
    }

    return {
      delivery: 'SENT_TO_INSTAGRAM',
      recipientId: response.data?.recipient_id || recipientId,
      providerMessageId,
    };
  } catch (error) {
    if (error instanceof InstagramDeliveryError) throw error;
    throw sanitizeMetaError(error);
  }
}

export async function sendInstagramTypingIndicator({
  recipientId,
  accessToken,
  pageId = 'me',
  instagramAccountId = null,
  http = axios,
  graphVersion,
}) {
  if (!recipientId || !accessToken) return { ok: false, reason: 'CREDENTIALS_MISSING' };
  const baseUrl = instagramGraphApiBase();
  const targetId = String(instagramAccountId || pageId || 'me').trim();
  const endpoint = `${baseUrl}/${targetId}/messages`;
  try {
    await http.post(endpoint, {
      recipient: { id: recipientId },
      sender_action: 'typing_on',
    }, {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });
    return { ok: true };
  } catch (err) {
    console.warn('INSTAGRAM_TYPING_INDICATOR_WARN', err?.message);
    return { ok: false, reason: err?.message };
  }
}


