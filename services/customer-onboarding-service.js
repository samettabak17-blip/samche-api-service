import crypto from 'node:crypto';
import { normalizeEmail, isValidEmail, isValidTenantRole } from '../middleware/validators.js';
import { createInvitationLifecycle } from './customer-invitation-service.js';
import { PLAN_CODES } from './tenant-plan-service.js';

export class CustomerOnboardingError extends Error {
  constructor(code, message = 'Customer onboarding request is invalid') {
    super(message);
    this.code = code;
  }
}

export function validateOnboardingInput({ idempotencyKey, payload }) {
  if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{32,128}$/.test(idempotencyKey)) {
    throw new CustomerOnboardingError('IDEMPOTENCY_KEY_INVALID');
  }
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const firstName = typeof payload?.first_name === 'string' ? payload.first_name.trim() : '';
  const lastName = typeof payload?.last_name === 'string' ? payload.last_name.trim() : '';
  const email = normalizeEmail(payload?.email);
  const tenantRole = payload?.tenant_role ?? 'ADMIN';
  const planCode = String(payload?.plan_code ?? '').toUpperCase();
  if (!name || name.length > 255 || !firstName || firstName.length > 120 || !lastName || lastName.length > 120 || !isValidEmail(email) || tenantRole !== 'ADMIN' || !isValidTenantRole(tenantRole) || !PLAN_CODES.includes(planCode)) {
    throw new CustomerOnboardingError('ONBOARDING_INPUT_INVALID');
  }
  return { name, firstName, lastName, email, tenantRole, planCode };
}

export function createOnboardingPayloadHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify({
    name: input.name,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    tenantRole: input.tenantRole,
    planCode: input.planCode,
  })).digest('hex');
}

async function transaction(database, work) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function onboardCustomer({ database, ownerUserId, idempotencyKey, payload, envelopeKey }) {
  const input = validateOnboardingInput({ idempotencyKey, payload });
  const payloadHash = createOnboardingPayloadHash(input);
  return transaction(database, async (client) => {
    const existingKey = await client.query(
      `SELECT payload_hash, status, response_json
       FROM owner_onboarding_idempotency
       WHERE owner_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [ownerUserId, idempotencyKey],
    );
    if (existingKey.rowCount) {
      const record = existingKey.rows[0];
      if (record.payload_hash !== payloadHash) throw new CustomerOnboardingError('IDEMPOTENCY_KEY_CONFLICT');
      if (record.status === 'COMPLETED') return { ...record.response_json, replayed: true };
      throw new CustomerOnboardingError('ONBOARDING_IN_PROGRESS');
    }
    await client.query(
      `INSERT INTO owner_onboarding_idempotency (owner_user_id, idempotency_key, payload_hash, expires_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '24 hours')`,
      [ownerUserId, idempotencyKey, payloadHash],
    );
    const tenant = (await client.query(
      `INSERT INTO tenants (name, plan_code) VALUES ($1, $2) RETURNING id, name, status, plan_code, created_at`,
      [input.name, input.planCode],
    )).rows[0];
    const userResult = await client.query(
      `SELECT id, email, system_role, status FROM users WHERE email_normalized = $1 FOR UPDATE`,
      [input.email],
    );
    let result;
    if (!userResult.rowCount) {
      const user = (await client.query(
        `INSERT INTO users (email, email_normalized, first_name, last_name, password_hash, system_role, status)
         VALUES ($1, $1, $2, $3, NULL, 'CUSTOMER', 'INVITED')
         RETURNING id, email, system_role, status`,
        [input.email, input.firstName, input.lastName],
      )).rows[0];
      const lifecycle = await createInvitationLifecycle({ client, userId: user.id, tenantId: tenant.id, tenantRole: input.tenantRole, envelopeKey });
      result = { tenant, customer: { id: user.id, email: user.email, status: 'INVITED' }, invitation: { id: lifecycle.invitation.id, status: lifecycle.invitation.status, expires_at: lifecycle.invitation.expires_at }, onboarding_status: 'INVITED' };
    } else {
      const user = userResult.rows[0];
      if (user.system_role !== 'CUSTOMER') throw new CustomerOnboardingError('CUSTOMER_EMAIL_UNAVAILABLE');
      if (user.status === 'ACTIVE') {
        await client.query(
          `INSERT INTO tenant_users (tenant_id, user_id, tenant_role)
           VALUES ($1, $2, $3) ON CONFLICT (tenant_id, user_id) DO NOTHING`,
          [tenant.id, user.id, input.tenantRole],
        );
        result = { tenant, customer: { id: user.id, email: user.email, status: 'ACTIVE' }, onboarding_status: 'ASSIGNED_EXISTING_CUSTOMER' };
      } else if (user.status === 'INVITED') {
        const lifecycle = await createInvitationLifecycle({ client, userId: user.id, tenantId: tenant.id, tenantRole: input.tenantRole, envelopeKey });
        result = { tenant, customer: { id: user.id, email: user.email, status: 'INVITED' }, invitation: { id: lifecycle.invitation.id, status: lifecycle.invitation.status, expires_at: lifecycle.invitation.expires_at }, onboarding_status: 'INVITED' };
      } else {
        throw new CustomerOnboardingError('CUSTOMER_ACCOUNT_UNAVAILABLE');
      }
    }
    await client.query(
      `UPDATE owner_onboarding_idempotency
       SET status = 'COMPLETED', response_json = $3::jsonb, tenant_id = $4, updated_at = CURRENT_TIMESTAMP
       WHERE owner_user_id = $1 AND idempotency_key = $2`,
      [ownerUserId, idempotencyKey, JSON.stringify(result), tenant.id],
    );
    return result;
  });
}
