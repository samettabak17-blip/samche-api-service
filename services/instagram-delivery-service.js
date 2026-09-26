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
/**
 * Splits message text into chunks that safely comply with Meta Instagram DM 1000-character payload limits.
 * Preserves paragraph breaks and sentence boundaries.
 */
export function splitIntoInstagramDmChunks(content, maxChunkLength = 950) {
  if (!content || typeof content !== 'string') return [];
  const text = content.trim();
  if (text.length <= maxChunkLength) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    if (!currentChunk) {
      if (trimmedPara.length <= maxChunkLength) {
        currentChunk = trimmedPara;
      } else {
        const lines = trimmedPara.split(/\n+/);
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          if (!currentChunk) {
            if (trimmedLine.length <= maxChunkLength) {
              currentChunk = trimmedLine;
            } else {
              const sentences = trimmedLine.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [trimmedLine];
              for (const sentence of sentences) {
                const s = sentence.trim();
                if (!s) continue;
                if (!currentChunk) {
                  currentChunk = s.slice(0, maxChunkLength);
                } else if ((currentChunk + ' ' + s).length <= maxChunkLength) {
                  currentChunk += ' ' + s;
                } else {
                  chunks.push(currentChunk.trim());
                  currentChunk = s.slice(0, maxChunkLength);
                }
              }
            }
          } else if ((currentChunk + '\n' + trimmedLine).length <= maxChunkLength) {
            currentChunk += '\n' + trimmedLine;
          } else {
            chunks.push(currentChunk.trim());
            currentChunk = trimmedLine.slice(0, maxChunkLength);
          }
        }
      }
    } else if ((currentChunk + '\n\n' + trimmedPara).length <= maxChunkLength) {
      currentChunk += '\n\n' + trimmedPara;
    } else {
      chunks.push(currentChunk.trim());
      if (trimmedPara.length <= maxChunkLength) {
        currentChunk = trimmedPara;
      } else {
        const lines = trimmedPara.split(/\n+/);
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          if (!currentChunk) {
            currentChunk = trimmedLine.slice(0, maxChunkLength);
          } else if ((currentChunk + '\n' + trimmedLine).length <= maxChunkLength) {
            currentChunk += '\n' + trimmedLine;
          } else {
            chunks.push(currentChunk.trim());
            currentChunk = trimmedLine.slice(0, maxChunkLength);
          }
        }
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text.slice(0, maxChunkLength)];
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

  const chunks = splitIntoInstagramDmChunks(content, 950);
  let primaryProviderMessageId = null;
  const deliveredIds = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const payload = {
      recipient: { id: recipientId },
      message: { text: chunk },
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
      if (providerMessageId) {
        if (!primaryProviderMessageId) primaryProviderMessageId = providerMessageId;
        deliveredIds.push(providerMessageId);
      }
    } catch (error) {
      if (error instanceof InstagramDeliveryError) throw error;
      throw sanitizeMetaError(error);
    }
  }

  return {
    delivery: 'SENT_TO_INSTAGRAM',
    recipientId,
    providerMessageId: primaryProviderMessageId,
    providerMessageIds: deliveredIds,
    chunkCount: chunks.length,
  };
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

export async function sendInstagramTypingOff({
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
      sender_action: 'typing_off',
    }, {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message };
  }
}


