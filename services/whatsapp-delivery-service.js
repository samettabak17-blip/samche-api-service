import axios from 'axios';
import https from 'https';

export class WhatsAppDeliveryError extends Error {
  constructor(code, message = 'WhatsApp delivery failed') {
    super(message);
    this.code = code;
  }
}

export const whatsappHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

function configuredValue(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function trustedRecipient(value) {
  const digits = String(value ?? '').replace(/^whatsapp:/, '').replace(/[^0-9]/g, '');
  return digits.length >= 7 && digits.length <= 20 ? digits : null;
}

function chunksFor(content) {
  const text = String(content ?? '');
  const chunks = [];
  for (let index = 0; index < text.length; index += 4000) {
    chunks.push(text.slice(index, index + 4000));
  }
  return chunks;
}

/**
 * Sends text only through the explicitly mapped configured WhatsApp phone number.
 * Callers must derive recipient identity from the persisted conversation, never request input.
 */
export async function deliverWhatsAppText({
  phoneNumberId,
  recipient,
  content,
  env = process.env,
  httpClient = axios,
  httpsAgent = whatsappHttpsAgent,
  continueOnChunkFailure = false,
  requireProviderMessageId = false,
}) {
  const configuredPhoneNumberId = configuredValue(env.WHATSAPP_PHONE_ID);
  const accessToken = configuredValue(env.WHATSAPP_TOKEN);
  const destination = trustedRecipient(recipient);
  const expectedPhoneNumberId = configuredValue(phoneNumberId);
  const body = String(content ?? '');

  if (!configuredPhoneNumberId || !accessToken) {
    throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_NOT_CONFIGURED');
  }
  if (!expectedPhoneNumberId || expectedPhoneNumberId !== configuredPhoneNumberId) {
    throw new WhatsAppDeliveryError('WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH');
  }
  if (!destination || !body.trim()) {
    throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_INVALID_INPUT');
  }

  const failures = [];
  const providerMessageIds = [];
  let deliveredChunks = 0;
  for (const chunk of chunksFor(body)) {
    try {
      const providerResponse = await httpClient.post(
        `https://graph.facebook.com/v20.0/${configuredPhoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: destination,
          text: { body: chunk },
        },
        {
          httpsAgent,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );
      const providerMessageId = configuredValue(providerResponse?.data?.messages?.[0]?.id);
      if (providerMessageId) {
        providerMessageIds.push(providerMessageId);
      } else if (requireProviderMessageId) {
        throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_UNCORRELATED');
      }
      deliveredChunks += 1;
    } catch (error) {
      const providerStatus = error?.response?.status;
      const failure = error instanceof WhatsAppDeliveryError
        ? error
        : new WhatsAppDeliveryError(
          providerStatus === 401 || providerStatus === 403
            ? 'WHATSAPP_DELIVERY_AUTH_FAILED'
            : 'WHATSAPP_DELIVERY_FAILED'
        );
      if (!continueOnChunkFailure) throw failure;
      failures.push(failure.code);
    }
  }

  return {
    deliveredChunks,
    failedChunks: failures.length,
    failures,
    providerMessageIds,
    providerMessageId: providerMessageIds[0] ?? null,
  };
}


function resolveMediaCategory(file, explicitCategory = null) {
  if (explicitCategory === 'IMAGE' || explicitCategory === 'AUDIO' || explicitCategory === 'DOCUMENT') return explicitCategory;
  const mimeType = String(file?.mimetype ?? '').toLowerCase();
  return mimeType.startsWith('image/') ? 'IMAGE' : mimeType.startsWith('audio/') ? 'AUDIO' : mimeType ? 'DOCUMENT' : null;
}

function mediaPayload({ mediaCategory, mediaId, caption = '', filename = '' }) {
  const type = mediaCategory === 'IMAGE' ? 'image' : mediaCategory === 'AUDIO' ? 'audio' : 'document';
  if (type === 'audio') return { type, audio: { id: mediaId } };
  if (type === 'image') return { type, image: { id: mediaId, ...(caption ? { caption } : {}) } };
  return { type, document: { id: mediaId, ...(filename ? { filename } : {}), ...(caption ? { caption } : {}) } };
}

/**
 * Uploads and sends one validated WhatsApp media resource through the exact
 * configured phone number. The caller persists the canonical conversation
 * resource only after this provider boundary succeeds.
 */
export async function deliverWhatsAppMedia({
  phoneNumberId,
  recipient,
  file,
  mediaCategory,
  caption = '',
  env = process.env,
  httpClient = axios,
  httpsAgent = whatsappHttpsAgent,
}) {
  const configuredPhoneNumberId = configuredValue(env.WHATSAPP_PHONE_ID);
  const accessToken = configuredValue(env.WHATSAPP_TOKEN);
  const destination = trustedRecipient(recipient);
  const expectedPhoneNumberId = configuredValue(phoneNumberId);
  const buffer = file?.buffer;
  const mimeType = configuredValue(file?.mimetype);
  const filename = configuredValue(file?.originalname) || 'attachment';
  const resolvedMediaCategory = resolveMediaCategory(file, mediaCategory);

  if (!configuredPhoneNumberId || !accessToken) throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_NOT_CONFIGURED');
  if (!expectedPhoneNumberId || expectedPhoneNumberId !== configuredPhoneNumberId) throw new WhatsAppDeliveryError('WHATSAPP_CHANNEL_CONFIGURATION_MISMATCH');
  if (!destination || !Buffer.isBuffer(buffer) || !buffer.length || !mimeType || !resolvedMediaCategory) throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_INVALID_INPUT');

  const startedAt = Date.now();
  const timing = (stage) => console.info(`AGENT_MEDIA_SEND_TIMING stage=${stage} elapsed_ms=${Date.now() - startedAt}`);
  let upload;
  try {
    timing('UPLOAD_STARTED');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    upload = await httpClient.post(
      `https://graph.facebook.com/v20.0/${configuredPhoneNumberId}/media`,
      form,
      { httpsAgent, headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 }
    );
    timing('UPLOAD_COMPLETED');
  } catch (error) {
    timing('UPLOAD_FAILED');
    throw new WhatsAppDeliveryError(error?.response?.status === 401 || error?.response?.status === 403 ? 'WHATSAPP_DELIVERY_AUTH_FAILED' : 'WHATSAPP_MEDIA_UPLOAD_FAILED');
  }

  const mediaId = configuredValue(upload?.data?.id);
  if (!mediaId) throw new WhatsAppDeliveryError('WHATSAPP_MEDIA_UPLOAD_FAILED');

  let submission;
  try {
    const payload = {
      messaging_product: 'whatsapp',
      to: destination,
      ...mediaPayload({ mediaCategory: resolvedMediaCategory, mediaId, caption: String(caption ?? '').trim().slice(0, 1024), filename }),
    };
    timing('WHATSAPP_SEND_STARTED');
    submission = await httpClient.post(
      `https://graph.facebook.com/v20.0/${configuredPhoneNumberId}/messages`,
      payload,
      { httpsAgent, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    timing('WHATSAPP_SEND_COMPLETED');
  } catch (error) {
    timing('WHATSAPP_SEND_FAILED');
    throw new WhatsAppDeliveryError(error?.response?.status === 401 || error?.response?.status === 403 ? 'WHATSAPP_DELIVERY_AUTH_FAILED' : 'WHATSAPP_MEDIA_SEND_FAILED');
  }

  const providerMessageId = configuredValue(submission?.data?.messages?.[0]?.id);
  if (!providerMessageId) {
    timing('WHATSAPP_SEND_UNCORRELATED');
    throw new WhatsAppDeliveryError('WHATSAPP_MEDIA_SEND_UNCORRELATED');
  }
  return { delivery: 'SENT_TO_WHATSAPP', mediaId, providerMessageId };
}
