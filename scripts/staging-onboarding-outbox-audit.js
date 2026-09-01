import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { assertVerifiedTls, strictTlsConfig } from './staging-task6-e2e-support.js';

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error('ONBOARDING_OUTBOX_AUDIT_ENV_MISSING');
  return value;
}

function safeStatus(value) {
  return String(value ?? 'NONE').replace(/[^A-Z_]/g, '').slice(0, 40) || 'NONE';
}

function safeInteger(value) {
  return Number.isInteger(Number(value)) ? Number(value) : 0;
}

function safeBoolean(value) {
  return value === true ? 'YES' : 'NO';
}

function safeTimestamp(value) {
  return value ? 'PRESENT' : 'NONE';
}

function auditLine(result, fields) {
  return `${result} | ONBOARDING_OUTBOX_AUDIT | ${Object.entries(fields).map(([key, value]) => `${key}=${String(value).replace(/[^A-Za-z0-9_.-]/g, '')}`).join(' ')}`;
}

async function main() {
  const connectionString = required('STAGING_DATABASE_URL');
  const expectedDatabaseName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''));
  if (!expectedDatabaseName) throw new Error('ONBOARDING_OUTBOX_AUDIT_DATABASE_INVALID');

  const database = new pg.Pool(strictTlsConfig(connectionString));
  const client = await database.connect();
  try {
    assertVerifiedTls(client);
    await client.query('BEGIN READ ONLY');
    const identity = await client.query('SELECT current_database() AS database_name, current_schema() AS schema_name');
    if (identity.rowCount !== 1 || identity.rows[0].database_name !== expectedDatabaseName || identity.rows[0].schema_name !== 'public') {
      throw new Error('ONBOARDING_OUTBOX_AUDIT_DATABASE_IDENTITY_MISMATCH');
    }
    const result = await client.query(
      `SELECT o.status AS outbox_status, o.attempt_count, o.next_attempt_at, o.last_attempt_at,
              o.provider_code, o.encrypted_envelope_ciphertext IS NOT NULL AS has_envelope,
              COALESCE(i.status, r.status) AS authority_status,
              COALESCE(i.expires_at, r.expires_at) AS authority_expires_at,
              (o.next_attempt_at <= CURRENT_TIMESTAMP) AS due_now,
              (COALESCE(i.status, r.status) = 'PENDING' AND COALESCE(i.expires_at, r.expires_at) > CURRENT_TIMESTAMP
               AND o.encrypted_envelope_ciphertext IS NOT NULL) AS claimable_now
         FROM customer_invitation_outbox o
         LEFT JOIN customer_invitations i ON i.id = o.invitation_id
         LEFT JOIN password_reset_tokens r ON r.id = o.password_reset_token_id
        WHERE o.status IN ('PENDING_DELIVERY', 'DELIVERY_FAILED', 'SENDING')
        ORDER BY o.created_at DESC
        LIMIT 1`,
    );
    if (!result.rowCount) {
      console.log(auditLine('PASS', { pending_row: 'NONE', database_identity: 'VERIFIED' }));
      await client.query('ROLLBACK');
      return;
    }
    const row = result.rows[0];
    console.log(auditLine('PASS', {
      database_identity: 'VERIFIED',
      outbox_status: safeStatus(row.outbox_status),
      authority_status: safeStatus(row.authority_status),
      attempt_count: safeInteger(row.attempt_count),
      due_now: safeBoolean(row.due_now),
      claimable_now: safeBoolean(row.claimable_now),
      has_envelope: safeBoolean(row.has_envelope),
      next_attempt_at: safeTimestamp(row.next_attempt_at),
      last_attempt_at: safeTimestamp(row.last_attempt_at),
      provider_code: safeStatus(row.provider_code),
      expires_at: safeTimestamp(row.authority_expires_at),
    }));
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await database.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = /^ONBOARDING_OUTBOX_AUDIT_/.test(String(error?.message)) || error?.message === 'TLS_VERIFICATION_FAILED'
      ? error.message
      : 'ONBOARDING_OUTBOX_AUDIT_FAILED';
    console.error(auditLine('FAIL', { status: code }));
    process.exitCode = 1;
  });
}
