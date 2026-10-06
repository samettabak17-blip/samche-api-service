import axios from 'axios';
import crypto from 'node:crypto';
import { instagramGraphApiBase, metaGraphApiBase } from './meta-graph-api-version.js';

export class InstagramDeliveryError extends Error {
  constructor(code, message = code, status = 502) {
    super(message);
    this.name = 'InstagramDeliveryError';
    this.code = code;
    this.status = status;
  }
}

const recentOutboundDeliveries = new Map();

function getDeliveryDedupeKey(recipientId, text) {
  const hash = crypto.createHash('sha256').update(String(text || '').trim()).digest('hex').slice(0, 24);
  return `${recipientId}:${hash}`;
}

export function sanitizeMetaError(error) {
  const metaError = error?.response?.data?.error;
  const status = error?.response?.status || (error instanceof InstagramDeliveryError ? error.status : 502);
  const message = metaError?.message || error?.message || 'Instagram delivery failed';
  const metaCode = metaError?.code ?? null;
  const metaSubcode = metaError?.error_subcode ?? null;
  const code = metaCode ? `META_IG_ERROR_${metaCode}` : (error?.code || 'INSTAGRAM_DELIVERY_FAILED');
  const reasonCategory = metaCode === 10 || metaCode === 200 || metaCode === 190 ? 'AUTH_PERMISSION'
    : metaCode === 100 ? 'INVALID_PARAMETER'
    : metaCode === 10900 ? 'MESSAGE_REQUEST_NOT_PERMITTED'
    : metaCode === 4 ? 'RATE_LIMITED'
    : (status >= 500 ? 'SERVER_ERROR' : 'DELIVERY_REJECTED');

  const deliveryError = new InstagramDeliveryError(code, message, status >= 500 ? 502 : 409);
  deliveryError.metaCode = metaCode;
  deliveryError.metaSubcode = metaSubcode;
  deliveryError.reasonCategory = reasonCategory;
  deliveryError.status = status;
  return deliveryError;
}

export function resolveInstagramDeliveryTarget({ authMode = null, instagramAccountId = null, pageId = 'me', instagramUserId = null } = {}) {
  const normalizedAuthMode = String(authMode || '').trim().toUpperCase();
  if (normalizedAuthMode === 'INSTAGRAM_LOGIN') return 'me';
  return String(instagramAccountId || pageId || 'me').trim();
}

export const MAX_FINAL_INSTAGRAM_CHUNK_LENGTH = 900;

export function resolveCandidateEndpoints({ authMode, instagramAccountId, pageId, instagramUserId, token }) {
  const igBaseUrl = instagramGraphApiBase();
  const fbBaseUrl = metaGraphApiBase();
  const isInstagramLoginToken = String(authMode || '').trim().toUpperCase() === 'INSTAGRAM_LOGIN'
    || String(token || '').startsWith('IGA')
    || String(token || '').startsWith('IGQ');

  const cleanTargetIds = Array.from(new Set([
    pageId && pageId !== 'me' ? String(pageId).trim() : null,
    instagramAccountId && instagramAccountId !== 'me' ? String(instagramAccountId).trim() : null,
    instagramUserId && instagramUserId !== 'me' ? String(instagramUserId).trim() : null,
  ].filter(Boolean)));

  if (isInstagramLoginToken) {
    return Array.from(new Set([
      `${igBaseUrl}/me/messages`,
      ...cleanTargetIds.map((id) => `${igBaseUrl}/${id}/messages`),
      `${fbBaseUrl}/me/messages`,
      ...cleanTargetIds.map((id) => `${fbBaseUrl}/${id}/messages`),
    ]));
  }

  return Array.from(new Set([
    ...cleanTargetIds.map((id) => `${fbBaseUrl}/${id}/messages`),
    `${fbBaseUrl}/me/messages`,
    `${igBaseUrl}/me/messages`,
    ...cleanTargetIds.map((id) => `${igBaseUrl}/${id}/messages`),
  ]));
}

/**
 * Splits message text into safe Instagram DM chunks strictly respecting MAX_FINAL_INSTAGRAM_CHUNK_LENGTH (900 chars).
 * Preserves paragraph breaks, list items, sentences, Turkish/Arabic Unicode characters, and URLs.
 * Guarantees zero text loss: concat(chunks) reconstructs the full semantic content.
 */
export function splitIntoInstagramDmChunks(content, maxChunkLength = MAX_FINAL_INSTAGRAM_CHUNK_LENGTH) {
  if (!content || typeof content !== 'string') return [];
  const limit = Math.max(50, Math.min(Number(maxChunkLength) || MAX_FINAL_INSTAGRAM_CHUNK_LENGTH, MAX_FINAL_INSTAGRAM_CHUNK_LENGTH));
  const text = content.trim();
  if (!text) return [];
  if (text.length <= limit) return [text];

  function breakIntoLeaves(block) {
    if (block.length <= limit) return [block];

    // Priority 1: Paragraphs (\n\n)
    if (block.includes('\n\n')) {
      const parts = block.split(/\n\n+/);
      if (parts.length > 1) {
        const leaves = [];
        for (const p of parts) {
          const trimmed = p.trim();
          if (trimmed) leaves.push(...breakIntoLeaves(trimmed));
        }
        return leaves;
      }
    }

    // Priority 2: Lines (\n)
    if (block.includes('\n')) {
      const lines = block.split(/\n+/);
      if (lines.length > 1) {
        const leaves = [];
        for (const l of lines) {
          const trimmed = l.trim();
          if (trimmed) leaves.push(...breakIntoLeaves(trimmed));
        }
        return leaves;
      }
    }

    // Priority 3: Sentences (split after sentence-ending punctuation followed by whitespace)
    const sentenceParts = [];
    let lastIndex = 0;
    const sentenceBoundaryRegex = /([.!?…]+)\s+/gu;
    let match;
    while ((match = sentenceBoundaryRegex.exec(block)) !== null) {
      const matchEnd = match.index + match[1].length;
      const sentence = block.slice(lastIndex, matchEnd).trim();
      if (sentence) sentenceParts.push(sentence);
      lastIndex = match.index + match[0].length;
    }
    const remainder = block.slice(lastIndex).trim();
    if (remainder) sentenceParts.push(remainder);

    if (sentenceParts.length > 1) {
      const leaves = [];
      for (const s of sentenceParts) {
        leaves.push(...breakIntoLeaves(s));
      }
      return leaves;
    }

    // Priority 4: Words / whitespace, keeping Markdown links [Label](URL) and URLs intact
    const tokenRegex = /\[[^\]\n]+\]\([^\)\s]+\)|https?:\/\/[^\s]+|\S+/gu;
    const tokens = block.match(tokenRegex) || [];
    if (tokens.length > 1) {
      const wordLeaves = [];
      let currentWordGroup = '';
      for (const t of tokens) {
        if (!currentWordGroup) {
          if (t.length <= limit) currentWordGroup = t;
          else wordLeaves.push(...breakIntoLeaves(t));
        } else if ((currentWordGroup + ' ' + t).length <= limit) {
          currentWordGroup += ' ' + t;
        } else {
          wordLeaves.push(currentWordGroup);
          if (t.length <= limit) currentWordGroup = t;
          else {
            wordLeaves.push(...breakIntoLeaves(t));
            currentWordGroup = '';
          }
        }
      }
      if (currentWordGroup) wordLeaves.push(currentWordGroup);
      return wordLeaves;
    }

    // Priority 5: Hard slice for oversized continuous token
    const chars = Array.from(block);
    const hardLeaves = [];
    for (let i = 0; i < chars.length; i += limit) {
      hardLeaves.push(chars.slice(i, i + limit).join(''));
    }
    return hardLeaves;
  }

  const rawLeaves = breakIntoLeaves(text);
  const chunks = [];
  let currentChunk = '';

  for (const leaf of rawLeaves) {
    const trimmedLeaf = leaf.trim();
    if (!trimmedLeaf) continue;

    if (!currentChunk) {
      currentChunk = trimmedLeaf;
      continue;
    }

    const candidateDoubleNewline = currentChunk + '\n\n' + trimmedLeaf;
    const candidateSingleNewline = currentChunk + '\n' + trimmedLeaf;
    const candidateSpace = currentChunk + ' ' + trimmedLeaf;

    if (candidateDoubleNewline.length <= limit && (currentChunk.endsWith(':') || trimmedLeaf.startsWith('•') || trimmedLeaf.startsWith('-') || currentChunk.endsWith('.') || currentChunk.endsWith('!') || currentChunk.endsWith('?'))) {
      currentChunk = candidateDoubleNewline;
    } else if (candidateSingleNewline.length <= limit && (trimmedLeaf.startsWith('•') || currentChunk.startsWith('•') || trimmedLeaf.startsWith('-'))) {
      currentChunk = candidateSingleNewline;
    } else if (candidateSpace.length <= limit) {
      currentChunk = candidateSpace;
    } else {
      chunks.push(currentChunk.trim());
      currentChunk = trimmedLeaf;
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trim());

  const finalChunks = [];
  for (const c of chunks) {
    if (c.length <= limit) finalChunks.push(c);
    else {
      const chars = Array.from(c);
      for (let i = 0; i < chars.length; i += limit) {
        const piece = chars.slice(i, i + limit).join('').trim();
        if (piece) finalChunks.push(piece);
      }
    }
  }

  return finalChunks.filter(Boolean);
}


export async function deliverInstagramText({
  recipientId,
  content,
  accessToken,
  pageId = 'me',
  instagramAccountId = null,
  instagramUserId = null,
  authMode = null,
  http = axios,
  graphVersion,
}) {
  const httpClient = http || axios;
  if (!recipientId || typeof recipientId !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_RECIPIENT_REQUIRED', 'Valid Instagram recipient ID is required', 400);
  }
  if (!content || typeof content !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_CONTENT_REQUIRED', 'Non-empty message content is required', 400);
  }
  if (!accessToken || typeof accessToken !== 'string') {
    throw new InstagramDeliveryError('INSTAGRAM_CREDENTIAL_REQUIRED', 'Instagram access token is not configured', 409);
  }

  const cleanRecipientId = String(recipientId).replace(/^instagram:\s*/i, '').trim();
  const token = accessToken.trim();
  const candidateEndpoints = resolveCandidateEndpoints({ authMode, instagramAccountId, pageId, instagramUserId, token });

  // Outbound circuit breaker / duplicate send barrier
  const dedupeKey = getDeliveryDedupeKey(cleanRecipientId, content);
  const existingDelivery = recentOutboundDeliveries.get(dedupeKey);
  if (existingDelivery && Date.now() - existingDelivery.timestamp < 6000) {
    console.warn('INSTAGRAM_DUPLICATE_OUTBOUND_BLOCKED recipient=' + cleanRecipientId.slice(0, 8));
    return existingDelivery.result;
  }

  const rawChunks = splitIntoInstagramDmChunks(content, MAX_FINAL_INSTAGRAM_CHUNK_LENGTH);
  const chunks = [...rawChunks];
  let primaryProviderMessageId = null;
  const deliveredIds = [];
  let workingEndpoint = candidateEndpoints[0];

  console.info(
    `INSTAGRAM_OUTBOUND_ATTEMPTED recipient=${cleanRecipientId.slice(0, 8)}` +
    ` chars=${String(content || '').length}` +
    ` chunks=${chunks.length}` +
    ` endpoint=${authMode === 'INSTAGRAM_LOGIN' ? 'ig_messages' : 'fb_messages'}`
  );

  // Inter-chunk sequential pacing
  const INTER_CHUNK_PACING_MS = 600;

  let i = 0;
  while (i < chunks.length) {
    const chunk = chunks[i];

    // Pre-send Hard Limit Assertion: Must never exceed MAX_FINAL_INSTAGRAM_CHUNK_LENGTH (900)
    if (chunk.length > MAX_FINAL_INSTAGRAM_CHUNK_LENGTH) {
      const emergencySubChunks = splitIntoInstagramDmChunks(chunk, MAX_FINAL_INSTAGRAM_CHUNK_LENGTH);
      chunks.splice(i, 1, ...emergencySubChunks);
      continue;
    }

    console.info(
      `INSTAGRAM_CHUNK_DELIVERY_ATTEMPT recipient=${cleanRecipientId.slice(0, 8)}` +
      ` chunk_index=${i}` +
      ` chunk_count=${chunks.length}` +
      ` chunk_length=${chunk.length}`
    );

    const payload = {
      recipient: { id: cleanRecipientId },
      message: { text: chunks[i] },
    };

    let response = null;
    let lastError = null;

    // Try working endpoint first, fallback to remaining candidate endpoints on route/node errors
    const endpointsToTry = [workingEndpoint, ...candidateEndpoints.filter((ep) => ep !== workingEndpoint)];

    for (const endpoint of endpointsToTry) {
      try {
        response = await httpClient.post(endpoint, payload, {
          params: { access_token: token },
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        });

        if (response?.data?.message_id || response?.status === 200) {
          workingEndpoint = endpoint;
          lastError = null;
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!response && lastError) {
      const sanitized = (lastError instanceof InstagramDeliveryError) ? lastError : sanitizeMetaError(lastError);
      sanitized.chunkIndex = i;
      sanitized.totalChunks = chunks.length;
      sanitized.deliveredProviderIds = [...deliveredIds];
      console.error(
        `INSTAGRAM_OUTBOUND_FAILED recipient=${cleanRecipientId.slice(0, 8)}` +
        ` canonical_response_length=${String(content || '').length}` +
        ` chunk_index=${i}` +
        ` chunk_count=${chunks.length}` +
        ` chunk_length=${chunk.length}` +
        ` code=${sanitized.code}` +
        ` status=${sanitized.status || 502}` +
        ` meta_code=${sanitized.metaCode || 'none'}` +
        ` meta_subcode=${sanitized.metaSubcode || 'none'}` +
        ` reason_category=${sanitized.reasonCategory || 'DELIVERY_FAILURE'}`
      );
      throw sanitized;
    }

    const providerMessageId = response?.data?.message_id || null;
    if (!providerMessageId) {
      const error = new InstagramDeliveryError(
        'INSTAGRAM_PROVIDER_MESSAGE_ID_MISSING',
        'Instagram provider accepted the request without a correlatable message ID',
        502
      );
      error.chunkIndex = i;
      error.totalChunks = chunks.length;
      error.deliveredProviderIds = [...deliveredIds];
      console.error(
        `INSTAGRAM_OUTBOUND_FAILED recipient=${cleanRecipientId.slice(0, 8)}` +
        ` canonical_response_length=${String(content || '').length}` +
        ` chunk_index=${i}` +
        ` chunk_count=${chunks.length}` +
        ` chunk_length=${chunk.length}` +
        ` code=${error.code}` +
        ` status=502 meta_code=none meta_subcode=none reason_category=DELIVERY_FAILURE`
      );
      throw error;
    }

    if (!primaryProviderMessageId) primaryProviderMessageId = providerMessageId;
    deliveredIds.push(providerMessageId);

    console.info(
      `INSTAGRAM_CHUNK_DELIVERY_SUCCEEDED recipient=${cleanRecipientId.slice(0, 8)}` +
      ` chunk_index=${i}` +
      ` chunk_count=${chunks.length}` +
      ` chunk_length=${chunk.length}` +
      ` provider_mid=${String(providerMessageId).slice(0, 16)}`
    );

    // Apply human pacing between sequential chunks if there are multiple chunks
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, INTER_CHUNK_PACING_MS));
    }

    i++;
  }

  console.info(
    `INSTAGRAM_OUTBOUND_SUCCEEDED recipient=${cleanRecipientId.slice(0, 8)}` +
    ` canonical_response_length=${String(content || '').length}` +
    ` chunk_count=${chunks.length}` +
    ` provider_mid=${primaryProviderMessageId ? String(primaryProviderMessageId).slice(0, 16) : 'present'}`
  );

  const result = {
    delivery: 'SENT_TO_INSTAGRAM',
    recipientId: cleanRecipientId,
    providerMessageId: primaryProviderMessageId,
    providerMessageIds: deliveredIds,
    chunkCount: chunks.length,
    chunksDelivered: deliveredIds.length,
    totalChunks: chunks.length,
  };

  recentOutboundDeliveries.set(dedupeKey, { timestamp: Date.now(), result });
  const dedupeCleanupTimer = setTimeout(() => recentOutboundDeliveries.delete(dedupeKey), 60000);
  dedupeCleanupTimer.unref?.();

  return result;
}

export async function deliverInstagramMedia({
  recipientId,
  mediaUrl,
  mediaCategory = 'IMAGE',
  caption = '',
  accessToken,
  pageId = 'me',
  instagramAccountId = null,
  instagramUserId = null,
  authMode = null,
  http = axios,
  graphVersion,
}) {
  const httpClient = http || axios;
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
  const targetId = resolveInstagramDeliveryTarget({ authMode, instagramAccountId, pageId, instagramUserId });
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
    const response = await httpClient.post(endpoint, payload, {
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
          instagramUserId,
          authMode,
          http: httpClient,
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
  instagramUserId = null,
  authMode = null,
  http = axios,
  graphVersion,
}) {
  if (!recipientId || !accessToken) return { ok: false, reason: 'CREDENTIALS_MISSING' };
  const httpClient = http || axios;
  const cleanRecipientId = String(recipientId).replace(/^instagram:\s*/i, '').trim();
  const token = accessToken.trim();
  const candidateEndpoints = resolveCandidateEndpoints({ authMode, instagramAccountId, pageId, instagramUserId, token });

  let lastError = null;
  for (const endpoint of candidateEndpoints) {
    try {
      await httpClient.post(endpoint, {
        recipient: { id: cleanRecipientId },
        sender_action: 'typing_on',
      }, {
        params: { access_token: token },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
      return { ok: true };
    } catch (err) {
      lastError = err;
    }
  }
  return { ok: false, reason: lastError?.message || 'TYPING_INDICATOR_FAILED' };
}

export async function sendInstagramTypingOff({
  recipientId,
  accessToken,
  pageId = 'me',
  instagramAccountId = null,
  instagramUserId = null,
  authMode = null,
  http = axios,
  graphVersion,
}) {
  if (!recipientId || !accessToken) return { ok: false, reason: 'CREDENTIALS_MISSING' };
  const httpClient = http || axios;
  const cleanRecipientId = String(recipientId).replace(/^instagram:\s*/i, '').trim();
  const token = accessToken.trim();
  const candidateEndpoints = resolveCandidateEndpoints({ authMode, instagramAccountId, pageId, instagramUserId, token });

  let lastError = null;
  for (const endpoint of candidateEndpoints) {
    try {
      await httpClient.post(endpoint, {
        recipient: { id: cleanRecipientId },
        sender_action: 'typing_off',
      }, {
        params: { access_token: token },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
      return { ok: true };
    } catch (err) {
      lastError = err;
    }
  }
  return { ok: false, reason: lastError?.message || 'TYPING_OFF_FAILED' };
}

export async function sendInstagramMarkSeen() {
  return { ok: false, reason: 'NATIVE_STATE_SYNC_NOT_SUPPORTED' };
}


