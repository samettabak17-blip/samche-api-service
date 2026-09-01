import { decryptInvitationEnvelope } from './customer-invitation-crypto.js';

function safeDeliveryFailureCode(error) {
  if (error?.code === 'SMTP_RECIPIENT_REJECTED') return 'SMTP_RECIPIENT_REJECTED';
  const command = String(error?.command ?? '').toUpperCase();
  const code = String(error?.code ?? '').toUpperCase();
  const message = String(error?.message ?? '').toUpperCase();
  if (command.includes('MAIL FROM')) return 'SMTP_FROM_REJECTED';
  if (command.includes('RCPT TO')) return 'SMTP_RECIPIENT_REJECTED';
  if (code === 'EAUTH' || command.includes('AUTH') || message.includes('AUTHENTICATION')) return 'SMTP_AUTH_FAILED';
  if (code === 'ETIMEDOUT' || message.includes('TIMED OUT')) return 'SMTP_TIMEOUT';
  if (message.includes('TLS') || message.includes('CERTIFICATE') || code.startsWith('ERR_TLS')) return 'SMTP_TLS_FAILED';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return 'SMTP_CONNECTION_FAILED';
  if (code === 'EENVELOPE' || command) return 'SMTP_PROVIDER_REJECTED';
  return 'SMTP_DELIVERY_FAILED';
}

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
  const authorityStatus = row.authority_status ?? row.invitation_status;
  if (!['PENDING_DELIVERY', 'DELIVERY_FAILED'].includes(row.status) || authorityStatus !== 'PENDING' || new Date(row.expires_at) <= now) {
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
    const delivery = row.template_version === 'PASSWORD_RESET_V1'
      ? await mailer.sendPasswordReset({ email: row.email, token, expiresAt: row.expires_at })
      : await mailer.sendInvitation({ companyName: row.company_name, email: row.email, token, expiresAt: row.expires_at });
    await client.query(
      `UPDATE customer_invitation_outbox
       SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, encrypted_envelope_ciphertext = NULL,
           envelope_iv = NULL, envelope_auth_tag = NULL, provider_code = $2, last_attempt_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id, delivery?.providerCode ?? 'SMTP_ACCEPTED'],
    );
    return { status: 'SENT' };
  } catch (error) {
    await client.query(
      `UPDATE customer_invitation_outbox
       SET status = 'DELIVERY_FAILED', attempt_count = attempt_count + 1,
           next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes', provider_code = $2,
           last_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.id, safeDeliveryFailureCode(error)],
    );
    return { status: 'DELIVERY_FAILED' };
  } finally {
    token = undefined;
  }
}

export function createCustomerInvitationOutboxWorker({ database, mailer, envelopeKey, intervalMs = 60_000, onStatus = () => {} }) {
  let running = false;
  const runOnce = async () => {
    if (running) return;
    running = true;
    let client;
    try {
      client = await database.connect();
      await client.query('BEGIN');
      const claimed = await client.query(
        `SELECT o.*, COALESCE(i.status, r.status) AS authority_status, COALESCE(i.expires_at, r.expires_at) AS expires_at, t.name AS company_name, u.email
         FROM customer_invitation_outbox o
         LEFT JOIN customer_invitations i ON i.id = o.invitation_id
         LEFT JOIN password_reset_tokens r ON r.id = o.password_reset_token_id
         LEFT JOIN tenants t ON t.id = i.tenant_id
         JOIN users u ON u.id = COALESCE(i.user_id, r.user_id)
         WHERE o.status IN ('PENDING_DELIVERY', 'DELIVERY_FAILED') AND o.next_attempt_at <= CURRENT_TIMESTAMP
         ORDER BY o.created_at ASC
         LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,
      );
      if (claimed.rowCount) await processInvitationOutboxRow({ client, row: claimed.rows[0], envelopeKey, mailer });
      await client.query('COMMIT');
      onStatus({ state: 'RUNNING' });
    } catch {
      await client?.query('ROLLBACK').catch(() => {});
      onStatus({ state: 'ERROR', code: 'OUTBOX_WORKER_FAILURE' });
    } finally {
      client?.release();
      running = false;
    }
  };
  const timer = setInterval(() => { void runOnce(); }, intervalMs);
  void runOnce();
  return { runOnce, stop: () => clearInterval(timer) };
}
