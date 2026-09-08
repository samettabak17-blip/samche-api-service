import crypto from 'node:crypto';
import { normalizeWhatsAppExternalId } from './whatsapp-channel-ownership-service.js';

function shortId(value) {
  return String(value ?? 'unavailable').slice(0, 8);
}

function phoneFingerprint(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 16);
}

function failureCategory(error) {
  if (error?.code === 'WHATSAPP_DELIVERY_AUTH_FAILED') return 'AUTH';
  if (error?.code === 'WHATSAPP_DELIVERY_NOT_CONFIGURED') return 'CONFIGURATION';
  if (error?.providerStatus) return 'PROVIDER';
  return 'TRANSPORT';
}

function logDiagnostic(logger, context, typing, outboundProceeded) {
  logger.info(
    'WHATSAPP_TYPING_DIAGNOSTIC'
    + ' tenant=' + shortId(context.tenantId)
    + ' channel=' + shortId(context.channelId)
    + ' phone=' + context.phoneFingerprint
    + ' attempted=' + (typing.attempted ? '1' : '0')
    + ' succeeded=' + (typing.succeeded ? '1' : '0')
    + ' meta_status=' + (typing.providerStatus ?? 'UNKNOWN')
    + ' provider_code=' + (typing.providerCode ?? 'UNKNOWN')
    + ' failure_category=' + (typing.failureCategory ?? 'NONE')
    + ' outbound_proceeded=' + (outboundProceeded ? '1' : '0')
  );
}

export async function orchestrateWhatsAppInboundAiResponse({
  whatsappInbox,
  incomingMessageId,
  sendTyping,
  processAiResponse,
  logger = console,
}) {
  const eligible = Boolean(
    whatsappInbox
    && !whatsappInbox.duplicate
    && whatsappInbox.shouldInvokeAi
    && whatsappInbox.conversation?.handling_mode === 'AI'
  );
  if (!eligible) return { suppressed: true, typing: { attempted: false, succeeded: false }, outboundProceeded: false };

  let phoneNumberId;
  try {
    phoneNumberId = normalizeWhatsAppExternalId(whatsappInbox.integration?.external_channel_id);
  } catch {
    phoneNumberId = null;
  }
  const context = {
    tenantId: whatsappInbox.integration?.tenant_id,
    channelId: whatsappInbox.integration?.channel_id,
    phoneFingerprint: phoneFingerprint(phoneNumberId),
  };
  let typing = {
    attempted: false,
    succeeded: false,
    providerStatus: null,
    providerCode: null,
    failureCategory: null,
  };

  if (phoneNumberId && incomingMessageId) {
    typing.attempted = true;
    try {
      const outcome = await sendTyping({ phoneNumberId, incomingMessageId });
      typing = {
        ...typing,
        succeeded: outcome?.ok !== false,
        providerStatus: outcome?.providerStatus ?? null,
      };
    } catch (error) {
      typing = {
        ...typing,
        succeeded: false,
        providerStatus: error?.providerStatus ?? null,
        providerCode: error?.providerCode ?? null,
        failureCategory: failureCategory(error),
      };
    }
  } else {
    typing.failureCategory = 'CONFIGURATION';
  }

  try {
    const response = await processAiResponse({ typing });
    const outboundProceeded = Boolean(response?.delivered);
    logDiagnostic(logger, context, typing, outboundProceeded);
    return { suppressed: false, typing, outboundProceeded, response };
  } catch (error) {
    logDiagnostic(logger, context, typing, false);
    throw error;
  }
}
