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
  let deliveredChunks = 0;
  for (const chunk of chunksFor(body)) {
    try {
      await httpClient.post(
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
      deliveredChunks += 1;
    } catch (error) {
      const providerStatus = error?.response?.status;
      const failure = new WhatsAppDeliveryError(
        providerStatus === 401 || providerStatus === 403
          ? 'WHATSAPP_DELIVERY_AUTH_FAILED'
          : 'WHATSAPP_DELIVERY_FAILED'
      );
      if (!continueOnChunkFailure) throw failure;
      failures.push(failure.code);
    }
  }

  return { deliveredChunks, failedChunks: failures.length, failures };
}
