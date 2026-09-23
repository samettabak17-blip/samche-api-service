export const PLAN_CODES = ['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'];
export const PLAN_RANK = Object.fromEntries(PLAN_CODES.map((code, index) => [code, index + 1]));
export function isHigherPlan(current, requested) { return Boolean(PLAN_RANK[requested] > PLAN_RANK[current]); }
export class TenantPlanError extends Error { constructor(code, message) { super(message); this.code = code; } }
function valid(code) { return PLAN_CODES.includes(String(code ?? '').toUpperCase()); }

// This is intentionally separate from an upgrade-request resolution: a Platform
// OWNER may make an explicit administrative assignment in either direction.
// A pending tenant request is a reviewable commercial decision, so it must be
// resolved before an owner assignment can make its assumptions stale.
export async function changeTenantPlanAsOwner({ database, tenantId, ownerUserId, planCode, billingCycle = 'MONTHLY' }) {
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

    const planData = await client.query('SELECT * FROM platform_plans WHERE code = $1', [requested]);
    const plan = planData?.rows?.[0];

    await client.query('UPDATE tenants SET plan_code=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1', [tenantId, requested]);

    if (plan) {
      await client.query(
        `INSERT INTO tenant_subscriptions (
           tenant_id, plan_code, billing_cycle, currency,
           monthly_price_aed, annual_price_aed, setup_fee_aed, status, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id)
         DO UPDATE SET
           plan_code = EXCLUDED.plan_code,
           currency = EXCLUDED.currency,
           monthly_price_aed = EXCLUDED.monthly_price_aed,
           annual_price_aed = EXCLUDED.annual_price_aed,
           setup_fee_aed = EXCLUDED.setup_fee_aed,
           updated_at = CURRENT_TIMESTAMP`,
        [tenantId, requested, billingCycle, plan.currency || 'AED', plan.monthly_price_aed || 0, plan.annual_price_aed || 0, plan.setup_fee_aed || 0]
      );

      if (plan.included_limits && typeof plan.included_limits === 'object') {
        for (const [metricKey, limitVal] of Object.entries(plan.included_limits)) {
          await client.query(
            `INSERT INTO tenant_usage_allocations (tenant_id, metric_key, allocated_limit, reset_interval)
             VALUES ($1, $2, $3, 'MONTHLY')
             ON CONFLICT (tenant_id, metric_key)
             DO UPDATE SET allocated_limit = GREATEST(tenant_usage_allocations.allocated_limit, EXCLUDED.allocated_limit)`,
            [tenantId, metricKey, Number(limitVal)]
          );
        }
      }
    }

    const audit = await client.query(`INSERT INTO tenant_plan_change_audit
      (tenant_id, previous_plan_code, new_plan_code, changed_by_user_id, change_source)
      VALUES ($1,$2,$3,$4,'OWNER_MANUAL_CHANGE')
      RETURNING id, tenant_id, previous_plan_code, new_plan_code, changed_by_user_id, change_source, changed_at`, [tenantId, current, requested, ownerUserId]);

    await client.query(
      `INSERT INTO tenant_entitlement_audit_log (tenant_id, action_type, performed_by_user_id, details)
       VALUES ($1, 'PLAN_CHANGE', $2, $3::jsonb)`,
      [tenantId, ownerUserId, JSON.stringify({ previousPlan: current, newPlan: requested, changeSource: 'OWNER_MANUAL_CHANGE' })]
    );

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

    if (decision === 'APPROVED') {
      await client.query('UPDATE tenants SET plan_code=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1', [request.tenant_id, request.requested_plan_code]);
      const planData = await client.query('SELECT * FROM platform_plans WHERE code = $1', [request.requested_plan_code]);
      const plan = planData?.rows?.[0];
      if (plan) {
        await client.query(
          `INSERT INTO tenant_subscriptions (
             tenant_id, plan_code, billing_cycle, currency,
             monthly_price_aed, annual_price_aed, setup_fee_aed, status, updated_at
           ) VALUES ($1, $2, 'MONTHLY', $3, $4, $5, $6, 'ACTIVE', CURRENT_TIMESTAMP)
           ON CONFLICT (tenant_id)
           DO UPDATE SET
             plan_code = EXCLUDED.plan_code,
             currency = EXCLUDED.currency,
             monthly_price_aed = EXCLUDED.monthly_price_aed,
             annual_price_aed = EXCLUDED.annual_price_aed,
             setup_fee_aed = EXCLUDED.setup_fee_aed,
             updated_at = CURRENT_TIMESTAMP`,
          [request.tenant_id, request.requested_plan_code, plan.currency || 'AED', plan.monthly_price_aed || 0, plan.annual_price_aed || 0, plan.setup_fee_aed || 0]
        );

        if (plan.included_limits && typeof plan.included_limits === 'object') {
          for (const [metricKey, limitVal] of Object.entries(plan.included_limits)) {
            await client.query(
              `INSERT INTO tenant_usage_allocations (tenant_id, metric_key, allocated_limit, reset_interval)
               VALUES ($1, $2, $3, 'MONTHLY')
               ON CONFLICT (tenant_id, metric_key)
               DO UPDATE SET allocated_limit = GREATEST(tenant_usage_allocations.allocated_limit, EXCLUDED.allocated_limit)`,
              [request.tenant_id, metricKey, Number(limitVal)]
            );
          }
        }
      }

      await client.query(
        `INSERT INTO tenant_entitlement_audit_log (tenant_id, action_type, performed_by_user_id, details)
         VALUES ($1, 'PLAN_UPGRADE_APPROVED', $2, $3::jsonb)`,
        [request.tenant_id, ownerUserId, JSON.stringify({ requestId, previousPlan: request.current_plan_code, newPlan: request.requested_plan_code })]
      );
    }

    const result = await client.query(`UPDATE tenant_plan_upgrade_requests SET status=$2,resolved_by_user_id=$3,resolved_at=CURRENT_TIMESTAMP,previous_plan_code=$4,new_plan_code=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`, [requestId, decision, ownerUserId, request.current_plan_code, decision === 'APPROVED' ? request.requested_plan_code : null]);
    await client.query('COMMIT'); return result.rows[0];
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}
