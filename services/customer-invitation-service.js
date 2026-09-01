import {
  createInvitationToken,
  encryptInvitationEnvelope,
  hashInvitationToken,
} from './customer-invitation-crypto.js';

const invitationExpiryHours = 72;

export function validateInvitationTokenInput(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43,512}$/.test(token);
}

function expirationFrom(now) {
  return new Date(now.getTime() + invitationExpiryHours * 60 * 60 * 1000);
}

export async function revokePendingInvitation({ client, userId, tenantId }) {
  const pending = await client.query(
    `SELECT id FROM customer_invitations
      WHERE user_id = $1 AND tenant_id = $2 AND status = 'PENDING'
      FOR UPDATE`,
    [userId, tenantId],
  );
  for (const row of pending.rows) {
    await client.query(
      `UPDATE customer_invitations
       SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'PENDING'`,
      [row.id],
    );
    await client.query(
      `UPDATE customer_invitation_outbox
       SET status = 'CANCELLED', encrypted_envelope_ciphertext = NULL, envelope_iv = NULL,
           envelope_auth_tag = NULL, terminal_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE invitation_id = $1 AND status IN ('PENDING_DELIVERY', 'SENDING', 'DELIVERY_FAILED')`,
      [row.id],
    );
  }
}

export async function createInvitationLifecycle({ client, userId, tenantId, tenantRole, envelopeKey, now = new Date() }) {
  if (!['ADMIN', 'AGENT'].includes(tenantRole)) throw new Error('Invalid tenant invitation role');

  await revokePendingInvitation({ client, userId, tenantId });
  const token = createInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const envelope = encryptInvitationEnvelope(token, envelopeKey);
  const expiresAt = expirationFrom(now);
  const invitationResult = await client.query(
    `INSERT INTO customer_invitations (user_id, tenant_id, tenant_role, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, tenant_id, tenant_role, status, expires_at`,
    [userId, tenantId, tenantRole, tokenHash, expiresAt],
  );
  const invitation = invitationResult.rows[0];
  await client.query(
    `INSERT INTO customer_invitation_outbox
      (invitation_id, encrypted_envelope_ciphertext, envelope_iv, envelope_auth_tag, envelope_key_version)
     VALUES ($1, $2, $3, $4, $5)`,
    [invitation.id, envelope.ciphertext, envelope.iv, envelope.authTag, envelope.keyVersion],
  );
  return { invitation, token, tokenHash };
}

export async function resendInvitationLifecycle({ client, tenantId, invitationId, envelopeKey }) {
  const found = await client.query(
    `SELECT id, user_id, tenant_id, tenant_role
       FROM customer_invitations
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE`,
    [invitationId, tenantId],
  );
  if (!found.rowCount) throw new Error('Invitation unavailable');
  const invitation = found.rows[0];
  return createInvitationLifecycle({ client, userId: invitation.user_id, tenantId: invitation.tenant_id, tenantRole: invitation.tenant_role, envelopeKey });
}

export async function revokeInvitationLifecycle({ client, tenantId, invitationId }) {
  const found = await client.query(
    `SELECT id, user_id, tenant_id FROM customer_invitations
      WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [invitationId, tenantId],
  );
  if (!found.rowCount) throw new Error('Invitation unavailable');
  await revokePendingInvitation({ client, userId: found.rows[0].user_id, tenantId: found.rows[0].tenant_id });
}
