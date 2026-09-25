/**
 * services/whatsapp-webhook-ingress-observability.js
 *
 * Canonical, generic, production-safe ingress observability for the shared
 * WhatsApp webhook boundary.
 *
 * Absence of business-processing logs must never be interpreted as proof that
 * Meta made no request. Without pre-validation evidence a rejected request and
 * a request that was never delivered are indistinguishable, which makes an App
 * Secret mismatch undiagnosable from the platform side.
 *
 * SAFETY CONTRACT (mandatory):
 *  - never logs request bodies or any customer message content
 *  - never logs tokens, secrets, or signature values
 *  - never logs personal data, phone numbers, or wa_ids
 *  - emits only bounded, non-reversible, structural evidence
 *
 * This is channel-transport observability. It is fully tenant-agnostic and
 * contains no tenant-specific behavior.
 */

import { createHash } from 'node:crypto';

export const WHATSAPP_INGRESS_EVENTS = Object.freeze({
  REQUEST_RECEIVED: 'REQUEST_RECEIVED',
  SIGNATURE_MISSING: 'SIGNATURE_MISSING',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  SIGNATURE_VALID: 'SIGNATURE_VALID',
  HANDLER_REACHED: 'HANDLER_REACHED',
  SECRET_NOT_CONFIGURED: 'SECRET_NOT_CONFIGURED',
  RAW_BODY_UNAVAILABLE: 'RAW_BODY_UNAVAILABLE',
});

/**
 * Non-reversible short fingerprint. Used so two independent observations can be
 * compared for equality without revealing the underlying value.
 */
export function safeFingerprint(value) {
  const normalized = String(value ?? '');
  if (!normalized) return 'none';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * Fingerprints the configured App Secret WITHOUT exposing it.
 *
 * This is the decisive diagnostic for an App Secret mismatch: the operator can
 * compare this fingerprint against the fingerprint of the secret shown in the
 * Meta App Dashboard without either value ever being printed or transmitted.
 * A SHA-256 prefix of a high-entropy 32-hex-character secret is not reversible.
 */
export function appSecretFingerprint(appSecret) {
  const normalized = String(appSecret ?? '').trim();
  if (!normalized) return 'unconfigured';
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

const MAX_INGRESS_OBSERVATIONS = 50;
const recentIngressObservations = [];

export function recordIngressObservation(entry) {
  recentIngressObservations.unshift({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (recentIngressObservations.length > MAX_INGRESS_OBSERVATIONS) {
    recentIngressObservations.pop();
  }
}

export function getRecentIngressObservations() {
  return [...recentIngressObservations];
}

/**
 * Emits one bounded, safe ingress observation line.
 */
export function logWhatsAppIngressEvent({
  event,
  signaturePresent = null,
  bodyBytes = null,
  appSecretConfigured = null,
  appSecretFingerprintValue = null,
  logger = console,
}) {
  const parts = ['WHATSAPP_WEBHOOK_INGRESS event=' + String(event ?? 'UNKNOWN')];
  if (signaturePresent !== null) parts.push('signature_present=' + (signaturePresent ? '1' : '0'));
  if (bodyBytes !== null) parts.push('body_bytes=' + (Number.isFinite(bodyBytes) ? bodyBytes : 'unknown'));
  if (appSecretConfigured !== null) parts.push('app_secret_configured=' + (appSecretConfigured ? '1' : '0'));
  if (appSecretFingerprintValue !== null) parts.push('app_secret_fingerprint=' + appSecretFingerprintValue);
  logger.info(parts.join(' '));

  recordIngressObservation({
    event: String(event ?? 'UNKNOWN'),
    signaturePresent,
    bodyBytes,
    appSecretConfigured,
    appSecretFingerprintValue,
  });
}
