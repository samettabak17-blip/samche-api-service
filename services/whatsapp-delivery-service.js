import axios from 'axios';
import FormData from 'form-data';
import https from 'https';
import { applyWhatsAppAdaptivePacing } from './whatsapp-response-pacing-service.js';

export class WhatsAppDeliveryError extends Error {
  constructor(code, message = 'WhatsApp delivery failed', diagnostic = {}) {
    super(message);
    this.code = code;
    this.providerStage = diagnostic.providerStage ?? null;
    this.providerStatus = diagnostic.providerStatus ?? null;
    this.providerCode = diagnostic.providerCode ?? null;
  }
}

function safeProviderDiagnostic(error, providerStage) {
  const status = Number(error?.response?.status);
  const providerCode = error?.response?.data?.error?.code;
  return {
    providerStage,
    providerStatus: Number.isInteger(status) ? status : null,
    providerCode: providerCode === undefined || providerCode === null ? null : String(providerCode).slice(0, 32),
  };
}

function logMediaProviderFailure(diagnostic) {
  console.info(
    'WHATSAPP_MEDIA_PROVIDER_FAILURE stage=' + diagnostic.providerStage
    + ' http_status=' + (diagnostic.providerStatus ?? 'UNKNOWN')
    + ' provider_code=' + (diagnostic.providerCode ?? 'UNKNOWN')
  );
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
  const accessToken = configuredValue(env.WHATSAPP_TOKEN);
  const destination = trustedRecipient(recipient);
  const targetPhoneNumberId = configuredValue(phoneNumberId);
  const body = String(content ?? '');

  if (!targetPhoneNumberId || !accessToken) {
    throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_NOT_CONFIGURED');
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
        `https://graph.facebook.com/v20.0/${targetPhoneNumberId}/messages`,
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
  const accessToken = configuredValue(env.WHATSAPP_TOKEN);
  const destination = trustedRecipient(recipient);
  const targetPhoneNumberId = configuredValue(phoneNumberId);
  const buffer = file?.buffer;
  const mimeType = configuredValue(file?.mimetype);
  const filename = configuredValue(file?.originalname) || 'attachment';
  const resolvedMediaCategory = resolveMediaCategory(file, mediaCategory);

  if (!targetPhoneNumberId || !accessToken) throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_NOT_CONFIGURED');
  if (!destination || !Buffer.isBuffer(buffer) || !buffer.length || !mimeType || !resolvedMediaCategory) throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_INVALID_INPUT');

  const startedAt = Date.now();
  const isVoiceMessage = resolvedMediaCategory === 'AUDIO';
  const timing = (stage) => console.info(`AGENT_MEDIA_SEND_TIMING stage=${stage} elapsed_ms=${Date.now() - startedAt}`);
  const voiceStage = (stage) => { if (isVoiceMessage) console.info('VOICE_SEND stage=' + stage); };
  let upload;
  try {
    timing('UPLOAD_STARTED');
    voiceStage('META_MEDIA_UPLOAD_STARTED');
    if (isVoiceMessage) console.info('VOICE_AUDIO_DIAGNOSTIC meta_upload_mime=' + mimeType + ' filename_extension=' + (filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : 'none'));
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    // Node form-data preserves the binary stream, multipart boundary, and per-file Content-Type.
    form.append('file', buffer, { filename, contentType: mimeType, knownLength: buffer.length });
    upload = await httpClient.post(
      `https://graph.facebook.com/v20.0/${targetPhoneNumberId}/media`,
      form,
      { httpsAgent, headers: { Authorization: `Bearer ${accessToken}`, ...form.getHeaders() }, timeout: 20000 }
    );
    timing('UPLOAD_COMPLETED');
  } catch (error) {
    timing('UPLOAD_FAILED');
    const diagnostic = safeProviderDiagnostic(error, 'MEDIA_UPLOAD');
    logMediaProviderFailure(diagnostic);
    throw new WhatsAppDeliveryError(
      error?.response?.status === 401 || error?.response?.status === 403 ? 'WHATSAPP_DELIVERY_AUTH_FAILED' : 'WHATSAPP_MEDIA_UPLOAD_FAILED',
      'WhatsApp delivery failed',
      diagnostic
    );
  }

  const mediaId = configuredValue(upload?.data?.id);
  if (!mediaId) throw new WhatsAppDeliveryError('WHATSAPP_MEDIA_UPLOAD_FAILED');
  if (isVoiceMessage) console.info('VOICE_SEND stage=META_MEDIA_UPLOAD_ACCEPTED media_id_present=1');

  let submission;
  try {
    const payload = {
      messaging_product: 'whatsapp',
      to: destination,
      ...mediaPayload({ mediaCategory: resolvedMediaCategory, mediaId, caption: String(caption ?? '').trim().slice(0, 1024), filename }),
    };
    timing('WHATSAPP_SEND_STARTED');
    voiceStage('META_MESSAGE_SEND_STARTED');
    submission = await httpClient.post(
      `https://graph.facebook.com/v20.0/${targetPhoneNumberId}/messages`,
      payload,
      { httpsAgent, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    timing('WHATSAPP_SEND_COMPLETED');
  } catch (error) {
    timing('WHATSAPP_SEND_FAILED');
    const diagnostic = safeProviderDiagnostic(error, 'WHATSAPP_SEND');
    logMediaProviderFailure(diagnostic);
    throw new WhatsAppDeliveryError(
      error?.response?.status === 401 || error?.response?.status === 403 ? 'WHATSAPP_DELIVERY_AUTH_FAILED' : 'WHATSAPP_MEDIA_SEND_FAILED',
      'WhatsApp delivery failed',
      diagnostic
    );
  }

  const providerMessageId = configuredValue(submission?.data?.messages?.[0]?.id);
  if (!providerMessageId) {
    timing('WHATSAPP_SEND_UNCORRELATED');
    throw new WhatsAppDeliveryError('WHATSAPP_MEDIA_SEND_UNCORRELATED');
  }
  if (isVoiceMessage) console.info('VOICE_SEND stage=META_MESSAGE_ACCEPTED wamid_present=1');
  return { delivery: 'SENT_TO_WHATSAPP', mediaId, providerMessageId };
}

/**
 * Dispatches the official WhatsApp native typing indicator / read receipt presence
 * for an incoming message. Associates strictly with the inbound WhatsApp message ID.
 */
export async function sendWhatsAppTypingIndicator({
  phoneNumberId,
  incomingMessageId,
  env = process.env,
  httpClient = axios,
  httpsAgent = whatsappHttpsAgent,
}) {
  const accessToken = configuredValue(env.WHATSAPP_TOKEN);
  const targetPhoneNumberId = configuredValue(phoneNumberId);
  const messageId = configuredValue(incomingMessageId);

  if (!accessToken || !targetPhoneNumberId) {
    throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_NOT_CONFIGURED');
  }
  if (!messageId) {
    throw new WhatsAppDeliveryError('WHATSAPP_DELIVERY_INVALID_INPUT');
  }

  try {
    const response = await httpClient.post(
      `https://graph.facebook.com/v20.0/${targetPhoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      },
      {
        httpsAgent,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    const success = Boolean(response?.data?.success ?? true);
    return {
      ok: success,
      messageId,
      providerStatus: Number.isInteger(Number(response?.status)) ? Number(response.status) : null,
    };
  } catch (error) {
    const diagnostic = safeProviderDiagnostic(error, 'TYPING_INDICATOR');
    throw new WhatsAppDeliveryError(
      error?.response?.status === 401 || error?.response?.status === 403
        ? 'WHATSAPP_DELIVERY_AUTH_FAILED'
        : 'WHATSAPP_TYPING_INDICATOR_FAILED',
      'WhatsApp typing indicator failed',
      diagnostic
    );
  }
}

/**
 * Canonical platform delivery abstraction for automated WhatsApp messages.
 * Initiates native typing and natural pacing before outbound delivery when an inbound
 * message context is available, failing gracefully if typing cannot be presented.
 */
export async function deliverAutomatedWhatsAppMessageWithTyping({
  database = null,
  tenantId = null,
  conversationId = null,
  phoneNumberId,
  recipient,
  content,
  incomingMessageId = null,
  sendTyping = sendWhatsAppTypingIndicator,
  deliverText = deliverWhatsAppText,
  applyPacing = applyWhatsAppAdaptivePacing,
  logger = console,
}) {
  const startedAt = Date.now();
  let resolvedMessageId = incomingMessageId;

  if (!resolvedMessageId && database?.query && tenantId && conversationId) {
    try {
      const result = await database.query(
        `SELECT external_message_id
           FROM conversation_messages
          WHERE tenant_id = $1
            AND conversation_id = $2
            AND sender_type = 'CUSTOMER'
            AND external_message_id IS NOT NULL
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [tenantId, conversationId]
      );
      if (result.rows?.[0]?.external_message_id) {
        resolvedMessageId = result.rows[0].external_message_id;
      }
    } catch (err) {
      logger.warn('LIFECYCLE_TYPING_WAMID_LOOKUP_FAILED', err?.message);
    }
  }

  let typingAttempted = false;
  let typingSucceeded = false;
  let typingProviderStatus = null;

  if (resolvedMessageId && phoneNumberId) {
    typingAttempted = true;
    try {
      const outcome = await sendTyping({
        phoneNumberId,
        incomingMessageId: resolvedMessageId,
      });
      typingSucceeded = outcome?.ok !== false;
      typingProviderStatus = outcome?.providerStatus ?? 200;
    } catch (err) {
      typingSucceeded = false;
      typingProviderStatus = err?.providerStatus ?? (err instanceof WhatsAppDeliveryError ? 400 : 500);
      logger.warn('LIFECYCLE_TYPING_INDICATOR_NON_BLOCKING_ERROR', err?.message);
    }
  }

  let delayedMs = 0;
  if (typingAttempted && typingSucceeded) {
    try {
      const pacingOutcome = await applyPacing({
        generationStartedAt: startedAt,
        content,
      });
      delayedMs = pacingOutcome?.delayedMs ?? 0;
    } catch {
      delayedMs = 0;
    }
  }

  const deliveryResult = await deliverText({
    phoneNumberId,
    recipient,
    content,
  });

  logger.info(
    'AUTOMATED_WHATSAPP_DELIVERY_DIAGNOSTIC'
    + ' tenant=' + String(tenantId ?? 'unknown').slice(0, 8)
    + ' conversation=' + String(conversationId ?? 'unknown').slice(0, 8)
    + ' typing_attempted=' + (typingAttempted ? '1' : '0')
    + ' typing_succeeded=' + (typingSucceeded ? '1' : '0')
    + ' typing_status=' + (typingProviderStatus ?? 'SKIPPED')
    + ' wamid=' + (resolvedMessageId ? 'RESOLVED' : 'NONE')
    + ' pacing_ms=' + delayedMs
  );

  return {
    ...deliveryResult,
    typing: {
      attempted: typingAttempted,
      succeeded: typingSucceeded,
      providerStatus: typingProviderStatus,
      wamidResolved: Boolean(resolvedMessageId),
      delayedMs,
    },
  };
}


