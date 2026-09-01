export const PLAN_CODES = ['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'];
export const PLAN_RANK = Object.fromEntries(PLAN_CODES.map((code, index) => [code, index + 1]));
export function isHigherPlan(current, requested) { return Boolean(PLAN_RANK[requested] > PLAN_RANK[current]); }
export class TenantPlanError extends Error { constructor(code, message) { super(message); this.code = code; } }
function valid(code) { return PLAN_CODES.includes(String(code ?? '').toUpperCase()); }

// This is intentionally separate from an upgrade-request resolution: a Platform
// OWNER may make an explicit administrative assignment in either direction.
// A pending tenant request is a reviewable commercial decision, so it must be
// resolved before an owner assignment can make its assumptions stale.
export async function changeTenantPlanAsOwner({ database, tenantId, ownerUserId, planCode }) {
  const requested = String(planCode ?? '').toUpperCase();
  if (!valid(requested)) throw new TenantPlanError('PLAN_INVALID', 'Requested plan is invalid');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT plan_code FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (!tenant.rowCount) throw new TenantPlanError('PLAN_TENANT_NOT_FOUND', 'Tenant not found');
    const current = tenant.rows[0].plan_code;
    const pending = await client.query("SELECT id FROM tenant_plan_upgrade_requests WHERE tenant_id=$1 AND status='PENDING' FOR UPDATE", [tenantId]);
    if (pending.rowCount) throw new TenantPlanError('PLAN_MANUAL_CHANGE_PENDING_REQUEST', 'Resolve the pending upgrade request before changing this tenant plan');
    if (current === requested) throw new TenantPlanError('PLAN_UNCHANGED', 'Selected plan is already assigned');
    await client.query('UPDATE tenants SET plan_code=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1', [tenantId, requested]);
    const audit = await client.query(`INSERT INTO tenant_plan_change_audit
      (tenant_id, previous_plan_code, new_plan_code, changed_by_user_id, change_source)
      VALUES ($1,$2,$3,$4,'OWNER_MANUAL_CHANGE')
      RETURNING id, tenant_id, previous_plan_code, new_plan_code, changed_by_user_id, change_source, changed_at`, [tenantId, current, requested, ownerUserId]);
    await client.query('COMMIT');
    return audit.rows[0];
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
export async function requestTenantPlanUpgrade({ database, tenantId, requestedBy, requestedPlanCode }) {
  const requested = String(requestedPlanCode ?? '').toUpperCase();
  if (!valid(requested)) throw new TenantPlanError('PLAN_INVALID', 'Requested plan is invalid');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT plan_code FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (!tenant.rowCount) throw new TenantPlanError('PLAN_TENANT_NOT_FOUND', 'Tenant not found');
    const current = tenant.rows[0].plan_code;
    if (!isHigherPlan(current, requested)) throw new TenantPlanError('PLAN_UPGRADE_NOT_HIGHER', 'Requested plan must be higher than the current plan');
    const existing = await client.query(`SELECT id, requested_plan_code FROM tenant_plan_upgrade_requests WHERE tenant_id=$1 AND status='PENDING' FOR UPDATE`, [tenantId]);
    if (existing.rowCount) {
      if (existing.rows[0].requested_plan_code === requested) {
        await client.query('COMMIT');
        return { id: existing.rows[0].id, status: 'PENDING', reused: true, current_plan_code: current, requested_plan_code: requested };
      }
      throw new TenantPlanError('PLAN_REQUEST_PENDING', 'A plan upgrade request is already pending');
    }
    const result = await client.query(`INSERT INTO tenant_plan_upgrade_requests (tenant_id, requested_by_user_id, current_plan_code, requested_plan_code) VALUES ($1,$2,$3,$4) RETURNING id,status,current_plan_code,requested_plan_code,created_at`, [tenantId, requestedBy, current, requested]);
    await client.query('COMMIT'); return { ...result.rows[0], reused: false };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
export async function resolveTenantPlanUpgrade({ database, requestId, ownerUserId, decision }) {
  if (!['APPROVED','REJECTED'].includes(decision)) throw new TenantPlanError('PLAN_DECISION_INVALID', 'Plan decision is invalid');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM tenant_plan_upgrade_requests WHERE id=$1 FOR UPDATE', [requestId]);
    if (!found.rowCount || found.rows[0].status !== 'PENDING') throw new TenantPlanError('PLAN_REQUEST_UNAVAILABLE', 'Plan request is unavailable');
    const request = found.rows[0];
    const tenant = await client.query('SELECT plan_code FROM tenants WHERE id=$1 FOR UPDATE', [request.tenant_id]);
    if (!tenant.rowCount || tenant.rows[0].plan_code !== request.current_plan_code || !isHigherPlan(request.current_plan_code, request.requested_plan_code)) throw new TenantPlanError('PLAN_REQUEST_STALE', 'Plan request is no longer valid');
    if (decision === 'APPROVED') await client.query('UPDATE tenants SET plan_code=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1', [request.tenant_id, request.requested_plan_code]);
    const result = await client.query(`UPDATE tenant_plan_upgrade_requests SET status=$2,resolved_by_user_id=$3,resolved_at=CURRENT_TIMESTAMP,previous_plan_code=$4,new_plan_code=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`, [requestId, decision, ownerUserId, request.current_plan_code, decision === 'APPROVED' ? request.requested_plan_code : null]);
    await client.query('COMMIT'); return result.rows[0];
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
