import crypto from 'node:crypto';

export function samcheguideRuntimeSessionKey({ tenantId, assistantId, channelId, sessionId }) {
  return crypto.createHash('sha256')
    .update([tenantId, assistantId, channelId, sessionId].map((value) => String(value ?? '')).join('\u001f'))
    .digest('hex');
}
