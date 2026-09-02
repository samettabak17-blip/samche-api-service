import crypto from 'node:crypto';

export function whatsappRuntimeSessionKey({ tenantId, assistantId, customerPhone }) {
  return crypto
    .createHash('sha256')
    .update([String(tenantId ?? ''), String(assistantId ?? ''), String(customerPhone ?? '')].join('|'))
    .digest('hex');
}
