import { decryptInvitationEnvelope } from './customer-invitation-crypto.js';

function envelopeFromRow(row) {
  return {
    ciphertext: row.encrypted_envelope_ciphertext,
    iv: row.envelope_iv,
    authTag: row.envelope_auth_tag,
    keyVersion: row.envelope_key_version,
  };
}

async function cancelAndDestroyEnvelope(client, outboxId) {
  await client.query(
    `UPDATE customer_invitation_outbox
     SET status = 'CANCELLED', encrypted_envelope_ciphertext = NULL, envelope_iv = NULL,
         envelope_auth_tag = NULL, terminal_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [outboxId],
  );
}

export async function processInvitationOutboxRow({ client, row, envelopeKey, mailer, now = new Date() }) {
  if (!['PENDING_DELIVERY', 'DELIVERY_FAILED'].includes(row.status) || row.invitation_status !== 'PENDING' || new Date(row.expires_at) <= now) {
    await cancelAndDestroyEnvelope(client, row.id);
    return { status: 'CANCELLED' };
  }
  let token;
  try {
    token = decryptInvitationEnvelope(envelopeFromRow(row), envelopeKey);
  } catch {
    if ((row.attempt_count ?? 0) >= 2) {
      await cancelAndDestroyEnvelope(client, row.id);
      return { status: 'DELIVERY_FAILED' };
    }
    await cancelAndDestroyEnvelope(client, row.id);
    return { status: 'DELIVERY_FAILED' };
  }
  try {
    await mailer.sendInvitation({ companyName: row.company_name, email: row.email, token, expiresAt: row.expires_at });
    await client.query(
      `UPDATE customer_invitation_outbox
       SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, encrypted_envelope_ciphertext = NULL,
           envelope_iv = NULL, envelope_auth_tag = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id],
    );
    return { status: 'SENT' };
  } catch {
    await client.query(
      `UPDATE customer_invitation_outbox
       SET status = 'DELIVERY_FAILED', attempt_count = attempt_count + 1,
           next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id],
    );
    return { status: 'DELIVERY_FAILED' };
  } finally {
    token = undefined;
  }
}

export function createCustomerInvitationOutboxWorker({ database, mailer, envelopeKey, intervalMs = 60_000 }) {
  let running = false;
  const runOnce = async () => {
    if (running) return;
    running = true;
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        `SELECT o.*, i.status AS invitation_status, i.expires_at, t.name AS company_name, u.email
         FROM customer_invitation_outbox o
         JOIN customer_invitations i ON i.id = o.invitation_id
         JOIN tenants t ON t.id = i.tenant_id
         JOIN users u ON u.id = i.user_id
         WHERE o.status IN ('PENDING_DELIVERY', 'DELIVERY_FAILED') AND o.next_attempt_at <= CURRENT_TIMESTAMP
         ORDER BY o.created_at ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (claimed.rowCount) await processInvitationOutboxRow({ client, row: claimed.rows[0], envelopeKey, mailer });
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
      running = false;
    }
  };
  const timer = setInterval(() => { void runOnce(); }, intervalMs);
  void runOnce();
  return { runOnce, stop: () => clearInterval(timer) };
}
