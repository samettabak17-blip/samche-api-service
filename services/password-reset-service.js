import argon2 from 'argon2';
import { createInvitationToken, encryptInvitationEnvelope, hashInvitationToken } from './customer-invitation-crypto.js';
import { validateInvitationTokenInput } from './customer-invitation-service.js';
import { validateInvitationPassword } from './customer-invitation-acceptance-service.js';
import { normalizeEmail } from '../middleware/validators.js';

const expiryHours = 1;
export function validatePasswordResetInput(token) { return validateInvitationTokenInput(token); }

export async function requestPasswordReset({ client, email, envelopeKey, now = new Date() }) {
  const canonicalEmail = normalizeEmail(email);
  const user = (await client.query(`SELECT id, email, status FROM users WHERE email_normalized = $1 FOR UPDATE`, [canonicalEmail])).rows[0];
  if (!user || user.status !== 'ACTIVE') return { queued: false };
  const previous = await client.query(`SELECT id FROM password_reset_tokens WHERE user_id = $1 AND status = 'PENDING' FOR UPDATE`, [user.id]);
  for (const item of previous.rows) {
    await client.query(`UPDATE password_reset_tokens SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [item.id]);
    await client.query(`UPDATE customer_invitation_outbox SET status = 'CANCELLED', encrypted_envelope_ciphertext = NULL, envelope_iv = NULL, envelope_auth_tag = NULL, terminal_at = CURRENT_TIMESTAMP WHERE password_reset_token_id = $1 AND status IN ('PENDING_DELIVERY','DELIVERY_FAILED','SENDING')`, [item.id]);
  }
  const token = createInvitationToken();
  const reset = (await client.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id, expires_at`, [user.id, hashInvitationToken(token), new Date(now.getTime() + expiryHours * 3600000)])).rows[0];
  const envelope = encryptInvitationEnvelope(token, envelopeKey);
  await client.query(`INSERT INTO customer_invitation_outbox (invitation_id, password_reset_token_id, template_version, encrypted_envelope_ciphertext, envelope_iv, envelope_auth_tag, envelope_key_version) VALUES (NULL, $1, 'PASSWORD_RESET_V1', $2, $3, $4, $5)`, [reset.id, envelope.ciphertext, envelope.iv, envelope.authTag, envelope.keyVersion]);
  return { queued: true, reset };
}

export async function validatePasswordReset({ database, token, now = new Date() }) {
  if (!validatePasswordResetInput(token)) throw new Error('RESET_INVALID');
  const row = (await database.query(`SELECT r.id, r.status, r.expires_at, u.email, u.status AS user_status FROM password_reset_tokens r JOIN users u ON u.id = r.user_id WHERE r.token_hash = $1`, [hashInvitationToken(token)])).rows[0];
  if (!row || row.status !== 'PENDING' || row.user_status !== 'ACTIVE' || new Date(row.expires_at) <= now) throw new Error('RESET_INVALID');
  return { email: row.email };
}

export async function consumePasswordReset({ database, token, password, confirmPassword, now = new Date() }) {
  if (!validatePasswordResetInput(token) || !validateInvitationPassword(password, confirmPassword)) throw new Error('RESET_INVALID');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT r.id, r.user_id, r.status, r.expires_at, u.status AS user_status FROM password_reset_tokens r JOIN users u ON u.id = r.user_id WHERE r.token_hash = $1 FOR UPDATE`, [hashInvitationToken(token)])).rows[0];
    if (!row || row.status !== 'PENDING' || row.user_status !== 'ACTIVE' || new Date(row.expires_at) <= now) throw new Error('RESET_INVALID');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await client.query(`UPDATE users SET password_hash = $2 WHERE id = $1 AND status = 'ACTIVE'`, [row.user_id, passwordHash]);
    await client.query(`UPDATE password_reset_tokens SET status = 'CONSUMED', consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [row.id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}

export async function changePassword({ database, userId, currentPassword, newPassword, confirmPassword }) {
  if (!validateInvitationPassword(newPassword, confirmPassword)) throw new Error('PASSWORD_INVALID');
  const user = (await database.query(`SELECT id, password_hash, status FROM users WHERE id = $1`, [userId])).rows[0];
  if (!user || user.status !== 'ACTIVE' || !user.password_hash || !(await argon2.verify(user.password_hash, currentPassword))) throw new Error('PASSWORD_INVALID');
  const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await database.query(`UPDATE users SET password_hash = $2 WHERE id = $1 AND status = 'ACTIVE'`, [user.id, passwordHash]);
}
