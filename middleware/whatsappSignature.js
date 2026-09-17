import { createHmac, timingSafeEqual } from 'crypto';
import {
  WHATSAPP_INGRESS_EVENTS,
  appSecretFingerprint,
  logWhatsAppIngressEvent,
} from '../services/whatsapp-webhook-ingress-observability.js';

/**
 * Canonical WhatsApp webhook signature boundary.
 *
 * Security semantics are unchanged and are never weakened: a missing, absent-raw-body,
 * or mismatched `x-hub-signature-256` is still rejected with 401, and an unconfigured
 * app secret still fails closed with 500.
 *
 * Safe ingress observability is added so REQUEST_RECEIVED, SIGNATURE_MISSING,
 * SIGNATURE_INVALID and SIGNATURE_VALID are distinguishable in production logs
 * without ever emitting request bodies, customer content, tokens, secrets, or
 * signature values.
 */
export function verifyWhatsAppSignature(req, res, next, appSecret = process.env.WHATSAPP_APP_SECRET, logger = console) {
  const signature = req.get('x-hub-signature-256');
  const bodyBytes = Buffer.isBuffer(req.rawBody) ? req.rawBody.length : null;
  const secretConfigured = Boolean(String(appSecret ?? '').trim());

  logWhatsAppIngressEvent({
    event: WHATSAPP_INGRESS_EVENTS.REQUEST_RECEIVED,
    signaturePresent: Boolean(signature),
    bodyBytes,
    appSecretConfigured: secretConfigured,
    appSecretFingerprintValue: appSecretFingerprint(appSecret),
    logger,
  });

  if (!appSecret) {
    console.error('WHATSAPP_APP_SECRET is not configured.');
    logWhatsAppIngressEvent({ event: WHATSAPP_INGRESS_EVENTS.SECRET_NOT_CONFIGURED, logger });
    return res.sendStatus(500);
  }

  if (!signature || !req.rawBody) {
    logWhatsAppIngressEvent({
      event: signature
        ? WHATSAPP_INGRESS_EVENTS.RAW_BODY_UNAVAILABLE
        : WHATSAPP_INGRESS_EVENTS.SIGNATURE_MISSING,
      signaturePresent: Boolean(signature),
      bodyBytes,
      logger,
    });
    return res.sendStatus(401);
  }

  const expectedSignature = `sha256=${createHmac('sha256', appSecret)
    .update(req.rawBody)
    .digest('hex')}`;
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const receivedBuffer = Buffer.from(signature, 'utf8');

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    // An App Secret belonging to a different Meta App produces exactly this
    // outcome. The fingerprint lets an operator compare the configured secret
    // with the Meta App Dashboard value without either being exposed.
    logWhatsAppIngressEvent({
      event: WHATSAPP_INGRESS_EVENTS.SIGNATURE_INVALID,
      signaturePresent: true,
      bodyBytes,
      appSecretConfigured: true,
      appSecretFingerprintValue: appSecretFingerprint(appSecret),
      logger,
    });
    return res.sendStatus(401);
  }

  logWhatsAppIngressEvent({
    event: WHATSAPP_INGRESS_EVENTS.SIGNATURE_VALID,
    signaturePresent: true,
    bodyBytes,
    logger,
  });
  return next();
}

