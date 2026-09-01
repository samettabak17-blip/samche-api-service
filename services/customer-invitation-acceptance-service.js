import argon2 from 'argon2';
import { hashInvitationToken } from './customer-invitation-crypto.js';
import { validateInvitationTokenInput } from './customer-invitation-service.js';

export class InvitationAcceptanceError extends Error {
  constructor(code = 'INVITATION_INVALID') {
    super('Invitation is unavailable');
    this.code = code;
  }
}

export function validateInvitationPassword(password, confirmPassword) {
  return typeof password === 'string'
    && password.length >= 8
    && password.length <= 256
    && password === confirmPassword;
}

export function validatePublicInvitationBody(body) {
  return Buffer.isBuffer(body) && body.length <= 4096;
}

function usableInvitation(row, now = new Date()) {
  return row && row.status === 'PENDING' && new Date(row.expires_at) > now && row.user_status === 'INVITED';
}

async function loadInvitation(client, token, lock = false) {
  if (!validateInvitationTokenInput(token)) throw new InvitationAcceptanceError();
  const result = await client.query(
    `SELECT i.id, i.user_id, i.tenant_id, i.tenant_role, i.status, i.expires_at,
            u.email, u.status AS user_status, t.name AS company_name
       FROM customer_invitations i
       JOIN users u ON u.id = i.user_id
       JOIN tenants t ON t.id = i.tenant_id
      WHERE i.token_hash = $1${lock ? ' FOR UPDATE' : ''}`,
    [hashInvitationToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function validateInvitation({ database, token, now = new Date() }) {
  const row = await loadInvitation(database, token);
  if (!usableInvitation(row, now)) throw new InvitationAcceptanceError();
  return { companyName: row.company_name, email: row.email, expiresAt: row.expires_at };
}

export async function acceptInvitation({ database, token, password, confirmPassword, now = new Date() }) {
  if (!validateInvitationPassword(password, confirmPassword)) throw new InvitationAcceptanceError('PASSWORD_INVALID');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const invitation = await loadInvitation(client, token, true);
    if (!usableInvitation(invitation, now)) {
      if (invitation?.status === 'PENDING' && new Date(invitation.expires_at) <= now) {
        await client.query(`UPDATE customer_invitations SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'PENDING'`, [invitation.id]);
        await client.query(`UPDATE customer_invitation_outbox SET status = 'CANCELLED', encrypted_envelope_ciphertext = NULL, envelope_iv = NULL, envelope_auth_tag = NULL, terminal_at = CURRENT_TIMESTAMP WHERE invitation_id = $1 AND status <> 'SENT'`, [invitation.id]);
      }
      throw new InvitationAcceptanceError();
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await client.query(
      `UPDATE users SET password_hash = $2, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'INVITED'`,
      [invitation.user_id, passwordHash],
    );
    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id, tenant_role)
       VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [invitation.tenant_id, invitation.user_id, invitation.tenant_role],
    );
    const consumed = await client.query(
      `UPDATE customer_invitations
       SET status = 'CONSUMED', consumed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'PENDING'
       RETURNING id`,
      [invitation.id],
    );
    if (!consumed.rowCount) throw new InvitationAcceptanceError();
    await client.query(
      `UPDATE customer_invitation_outbox
       SET status = CASE WHEN status = 'SENT' THEN status ELSE 'CANCELLED' END,
           encrypted_envelope_ciphertext = NULL, envelope_iv = NULL, envelope_auth_tag = NULL,
           terminal_at = COALESCE(terminal_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE invitation_id = $1`,
      [invitation.id],
    );
    await client.query('COMMIT');
    return { companyName: invitation.company_name, email: invitation.email };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof InvitationAcceptanceError) throw error;
    throw new InvitationAcceptanceError();
  } finally {
    client.release();
  }
}
