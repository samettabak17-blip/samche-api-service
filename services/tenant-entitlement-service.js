import crypto from 'node:crypto';

export const PLAN_CODES = Object.freeze(['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE']);
export const BILLING_CYCLES = Object.freeze(['MONTHLY', 'ANNUAL']);
export const PLAN_RANK = Object.freeze({
  STARTER: 1,
  GROWTH: 2,
  BUSINESS: 3,
  ENTERPRISE: 4,
});

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TenantEntitlementError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TenantEntitlementError';
    this.code = code;
    this.details = details;
  }
}

export function isHigherPlan(current, requested) {
  return Boolean((PLAN_RANK[requested] ?? 0) > (PLAN_RANK[current] ?? 0));
}

export function isPlanAtLeast(planCode, minimumPlanCode) {
  return (PLAN_RANK[planCode] ?? 0) >= (PLAN_RANK[minimumPlanCode] ?? 0);
}

export const CANONICAL_CAPABILITY_CATALOG = Object.freeze({
  webchat: { key: 'webchat', name: 'Web Chatbot', min_plan: 'STARTER', category: 'CHANNELS', description: 'Web Chat widget on website' },
  whatsapp: { key: 'whatsapp', name: 'WhatsApp AI', min_plan: 'GROWTH', category: 'CHANNELS', description: 'WhatsApp Business AI chatbot integration' },
  guide: { key: 'guide', name: 'AI Guide', min_plan: 'BUSINESS', category: 'CHANNELS', description: 'Interactive AI Guide white-label experience' },
  human_support: { key: 'human_support', name: 'Human Support & Escalations', min_plan: 'STARTER', category: 'SUPPORT', description: 'Human handoff and escalation policies' },
  shared_inbox: { key: 'shared_inbox', name: 'Shared Inbox', min_plan: 'GROWTH', category: 'SUPPORT', description: 'Multi-agent shared Live Inbox' },
  contextual_followup: { key: 'contextual_followup', name: 'Contextual Follow-Up', min_plan: 'GROWTH', category: 'ENGAGEMENT', description: 'Automated contextual conversation follow-ups' },
  basic_knowledge_intelligence: { key: 'basic_knowledge_intelligence', name: 'Basic Knowledge Intelligence', min_plan: 'STARTER', category: 'KNOWLEDGE', description: 'Document extraction and vector semantic retrieval' },
  advanced_knowledge_intelligence: { key: 'advanced_knowledge_intelligence', name: 'Advanced Knowledge Intelligence', min_plan: 'GROWTH', category: 'KNOWLEDGE', description: 'Knowledge candidate extraction and gap analysis' },
  entity_awareness: { key: 'entity_awareness', name: 'Entity Awareness', min_plan: 'BUSINESS', category: 'KNOWLEDGE', description: 'Catalog entities and visual knowledge media' },
  site_intelligence: { key: 'site_intelligence', name: 'Site Intelligence', min_plan: 'STARTER', category: 'KNOWLEDGE', description: 'Web page crawling and real-time site indexing' },
  basic_lead_capture: { key: 'basic_lead_capture', name: 'Basic Lead Capture', min_plan: 'STARTER', category: 'CRM', description: 'Conversational lead contact capture' },
  lead_qualification: { key: 'lead_qualification', name: 'Lead Qualification & Routing', min_plan: 'GROWTH', category: 'CRM', description: 'AI qualification analysis and routing' },
  lead_scoring: { key: 'lead_scoring', name: 'Lead Scoring', min_plan: 'BUSINESS', category: 'CRM', description: 'Predictive lead scoring analytics' },
  crm_integrations: { key: 'crm_integrations', name: 'CRM Integrations', min_plan: 'GROWTH', category: 'INTEGRATIONS', description: 'Connectors to CRMs and external booking systems' },
  api_workflow_capabilities: { key: 'api_workflow_capabilities', name: 'API & Custom Workflows', min_plan: 'BUSINESS', category: 'INTEGRATIONS', description: 'Custom API webhooks and event automation' },
  visual_ai: { key: 'visual_ai', name: 'Visual AI Generation', min_plan: 'BUSINESS', category: 'MULTIMODAL', description: 'Catalog-grounded generative visual transformations' },
  multiple_brands_websites: { key: 'multiple_brands_websites', name: 'Multiple Brands & Websites', min_plan: 'ENTERPRISE', category: 'ENTERPRISE', description: 'Multi-brand multi-domain isolation' },
  extended_multilingual: { key: 'extended_multilingual', name: 'Extended Multilingual', min_plan: 'ENTERPRISE', category: 'ENTERPRISE', description: 'Extended multilingual models and locale custom rules' },
  enterprise_integrations: { key: 'enterprise_integrations', name: 'Enterprise Integrations', min_plan: 'ENTERPRISE', category: 'ENTERPRISE', description: 'Dedicated enterprise systems and connectors' },
  advanced_security_controls: { key: 'advanced_security_controls', name: 'Advanced Security Controls', min_plan: 'ENTERPRISE', category: 'SECURITY', description: 'SSO, audit log streaming, and custom security' },
  custom_retention_support: { key: 'custom_retention_support', name: 'Custom Retention & Support', min_plan: 'ENTERPRISE', category: 'SUPPORT', description: 'Custom data retention policies and dedicated support' },
  // Future Tenant Commerce capabilities (Task 10, 13, 16)
  payment_links: { key: 'payment_links', name: 'Payment Links', min_plan: 'BUSINESS', category: 'COMMERCE', description: 'Generate customer payment links in chat' },
  payments: { key: 'payments', name: 'Direct Payments', min_plan: 'BUSINESS', category: 'COMMERCE', description: 'Accept in-chat payments' },
  orders: { key: 'orders', name: 'Order Management', min_plan: 'BUSINESS', category: 'COMMERCE', description: 'Track orders created in conversations' },
  invoicing: { key: 'invoicing', name: 'Invoicing', min_plan: 'BUSINESS', category: 'COMMERCE', description: 'Generate customer invoices' },
  automatic_invoice_delivery: { key: 'automatic_invoice_delivery', name: 'Automatic Invoice Delivery', min_plan: 'BUSINESS', category: 'COMMERCE', description: 'Automatically deliver invoices to customers' },
  accounting_connectors: { key: 'accounting_connectors', name: 'Accounting Connectors', min_plan: 'ENTERPRISE', category: 'COMMERCE', description: 'Connect to external accounting systems' },
});

export const CANONICAL_USAGE_METRICS = Object.freeze({
  monthly_interactions: { key: 'monthly_interactions', name: 'Monthly Interactions', reset_interval: 'MONTHLY' },
  max_languages: { key: 'max_languages', name: 'Supported Languages', reset_interval: 'NEVER' },
  max_web_chatbots: { key: 'max_web_chatbots', name: 'Web Chatbots', reset_interval: 'NEVER' },
  max_team_users: { key: 'max_team_users', name: 'Team Users', reset_interval: 'NEVER' },
  max_integrations: { key: 'max_integrations', name: 'Integrations', reset_interval: 'NEVER' },
  monthly_visual_generations: { key: 'monthly_visual_generations', name: 'Monthly Visual Generations', reset_interval: 'MONTHLY' },
});

export async function listPlatformPlans({ database }) {
  if (!database?.query) throw new TenantEntitlementError('DATABASE_UNAVAILABLE', 'Database is unavailable');
  const result = await database.query(
    `SELECT code, rank, display_name, customer_subtitle,
            monthly_price_aed, annual_price_aed, setup_fee_aed, currency,
            included_capabilities, included_limits, metadata, active, updated_at
       FROM platform_plans
      WHERE active = TRUE
      ORDER BY rank ASC`
  );
  return result.rows;
}

export async function getTenantSubscription({ database, tenantId }) {
  if (!database?.query) throw new TenantEntitlementError('DATABASE_UNAVAILABLE', 'Database is unavailable');
  if (!UUID_REGEX.test(String(tenantId ?? ''))) throw new TenantEntitlementError('INVALID_TENANT_ID', 'Tenant ID is invalid');

  const result = await database.query(
    `SELECT s.id, s.tenant_id, s.plan_code, s.billing_cycle, s.currency,
            s.monthly_price_aed, s.annual_price_aed, s.setup_fee_aed, s.status,
            s.started_at, s.current_period_start, s.current_period_end, s.created_at, s.updated_at,
            p.display_name, p.customer_subtitle, p.rank, p.included_capabilities, p.included_limits, p.metadata AS plan_metadata
       FROM tenant_subscriptions s
       JOIN platform_plans p ON p.code = s.plan_code
      WHERE s.tenant_id = $1`,
    [tenantId]
  );

  if (result.rowCount) return result.rows[0];

  // Fallback: Check tenants table if subscription row is not yet initialized
  const fallback = await database.query(
    `SELECT t.id AS tenant_id, t.plan_code,
            p.display_name, p.customer_subtitle, p.rank, p.monthly_price_aed, p.annual_price_aed, p.setup_fee_aed, p.currency,
            p.included_capabilities, p.included_limits, p.metadata AS plan_metadata
       FROM tenants t
       JOIN platform_plans p ON p.code = t.plan_code
      WHERE t.id = $1`,
    [tenantId]
  );

  if (!fallback.rowCount) throw new TenantEntitlementError('TENANT_NOT_FOUND', 'Tenant not found');

  const row = fallback.rows[0];
  return {
    id: null,
    tenant_id: row.tenant_id,
    plan_code: row.plan_code,
    billing_cycle: 'MONTHLY',
    currency: row.currency,
    monthly_price_aed: row.monthly_price_aed,
    annual_price_aed: row.annual_price_aed,
    setup_fee_aed: row.setup_fee_aed,
    status: 'ACTIVE',
    started_at: null,
    current_period_start: null,
    current_period_end: null,
    display_name: row.display_name,
    customer_subtitle: row.customer_subtitle,
    rank: row.rank,
    included_capabilities: row.included_capabilities,
    included_limits: row.included_limits,
    plan_metadata: row.plan_metadata,
  };
}

export async function resolveEffectiveTenantEntitlements({ database, tenantId }) {
  const sub = await getTenantSubscription({ database, tenantId });

  // 1. Fetch overrides for tenant
  const overridesResult = await database.query(
    `SELECT capability_key, effect, reason, granted_by_user_id, created_at, updated_at
       FROM tenant_entitlement_overrides
      WHERE tenant_id = $1`,
    [tenantId]
  );
  const overridesMap = new Map(overridesResult.rows.map((row) => [row.capability_key, row]));

  // 2. Fetch usage allocations and limits
  const allocationsResult = await database.query(
    `SELECT metric_key, allocated_limit, current_usage, reset_interval, last_reset_at
       FROM tenant_usage_allocations
      WHERE tenant_id = $1`,
    [tenantId]
  );
  const allocationsMap = new Map(allocationsResult.rows.map((row) => [row.metric_key, row]));

  // 3. Fetch current live counts / feature states for accuracy
  const countsResult = await database.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM ai_assistants WHERE tenant_id = $1 AND status = 'active') AS active_assistants_count,
       (SELECT COUNT(*)::integer FROM tenant_users WHERE tenant_id = $1) AS team_users_count,
       (SELECT COUNT(*)::integer FROM channel_integrations WHERE tenant_id = $1 AND enabled = TRUE) AS active_integrations_count,
       (SELECT COUNT(*)::integer FROM channel_integrations WHERE tenant_id = $1 AND enabled = TRUE AND integration_type = 'WEB_CHAT') AS webchat_integrations_count,
       (SELECT COUNT(*)::integer FROM channel_integrations WHERE tenant_id = $1 AND enabled = TRUE AND integration_type = 'WHATSAPP') AS whatsapp_integrations_count,
       (SELECT COUNT(*)::integer FROM channel_integrations WHERE tenant_id = $1 AND enabled = TRUE AND integration_type = 'SAMCHEGUIDE') AS guide_integrations_count,
       (SELECT enabled FROM tenant_visual_ai_config WHERE tenant_id = $1) AS visual_ai_config_enabled`,
    [tenantId]
  );
  const liveCounts = countsResult.rows[0] ?? {};

  const planIncluded = new Set(Array.isArray(sub.included_capabilities) ? sub.included_capabilities : []);
  const planLimits = sub.included_limits && typeof sub.included_limits === 'object' ? sub.included_limits : {};

  // Build resolved capabilities
  const resolvedCapabilities = {};
  const lockedCapabilities = [];

  for (const [key, meta] of Object.entries(CANONICAL_CAPABILITY_CATALOG)) {
    const override = overridesMap.get(key);
    let entitled = false;
    let source = 'PLAN';
    let reason = null;

    if (override) {
      if (override.effect === 'GRANT') {
        entitled = true;
        source = 'OVERRIDE';
        reason = override.reason || 'Super Owner override grant';
      } else if (override.effect === 'DENY') {
        entitled = false;
        source = 'OVERRIDE_DENIED';
        reason = override.reason || 'Super Owner override denial';
      }
    } else if (planIncluded.has(key)) {
      entitled = true;
      source = 'PLAN';
    } else if (key === 'visual_ai' && liveCounts.visual_ai_config_enabled === true) {
      // Backward compatibility for existing enabled Visual AI configurations
      entitled = true;
      source = 'CONFIG_PRESERVED';
    } else {
      entitled = false;
      source = 'LOCKED';
    }

    let enabled = false;
    if (entitled) {
      if (key === 'webchat') enabled = Number(liveCounts.webchat_integrations_count || 0) > 0;
      else if (key === 'whatsapp') enabled = Number(liveCounts.whatsapp_integrations_count || 0) > 0;
      else if (key === 'guide') enabled = Number(liveCounts.guide_integrations_count || 0) > 0;
      else if (key === 'visual_ai') enabled = liveCounts.visual_ai_config_enabled === true;
      else enabled = true;
    }

    resolvedCapabilities[key] = {
      key,
      name: meta.name,
      category: meta.category,
      min_plan: meta.min_plan,
      entitled,
      source,
      enabled,
      reason,
      upgrade_required: entitled ? null : meta.min_plan,
    };

    if (!entitled) {
      lockedCapabilities.push({
        key,
        name: meta.name,
        category: meta.category,
        min_plan: meta.min_plan,
        description: meta.description,
      });
    }
  }

  // Build resolved limits
  const resolvedLimits = {};
  for (const [metricKey, metricMeta] of Object.entries(CANONICAL_USAGE_METRICS)) {
    const alloc = allocationsMap.get(metricKey);
    const planLimit = Number(planLimits[metricKey] ?? (metricKey === 'monthly_interactions' ? 5000 : 0));
    const allocatedLimit = alloc ? Number(alloc.allocated_limit) : planLimit;
    let current = alloc ? Number(alloc.current_usage) : 0;

    if (metricKey === 'max_team_users') current = Math.max(current, Number(liveCounts.team_users_count || 0));
    else if (metricKey === 'max_web_chatbots') current = Math.max(current, Number(liveCounts.webchat_integrations_count || 0));
    else if (metricKey === 'max_integrations') current = Math.max(current, Number(liveCounts.active_integrations_count || 0));

    resolvedLimits[metricKey] = {
      metric_key: metricKey,
      name: metricMeta.name,
      limit: allocatedLimit,
      current,
      remaining: Math.max(0, allocatedLimit - current),
      reset_interval: alloc?.reset_interval || metricMeta.reset_interval,
    };
  }

  return {
    tenant_id: tenantId,
    plan: {
      code: sub.plan_code,
      display_name: sub.display_name,
      customer_subtitle: sub.customer_subtitle,
      rank: sub.rank,
      billing_cycle: sub.billing_cycle || 'MONTHLY',
      currency: sub.currency || 'AED',
      monthly_price_aed: Number(sub.monthly_price_aed),
      annual_price_aed: Number(sub.annual_price_aed),
      setup_fee_aed: Number(sub.setup_fee_aed),
      status: sub.status || 'ACTIVE',
    },
    capabilities: resolvedCapabilities,
    limits: resolvedLimits,
    locked_capabilities: lockedCapabilities,
    overrides: overridesResult.rows,
  };
}

export async function assertTenantEntitlement({ database, tenantId, capabilityKey }) {
  if (!database?.query || !tenantId || !capabilityKey) {
    throw new TenantEntitlementError('ENTITLEMENT_CHECK_INVALID', 'Invalid entitlement check parameters');
  }

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId });
  const capability = effective.capabilities[capabilityKey];

  if (!capability?.entitled) {
    const minPlan = CANONICAL_CAPABILITY_CATALOG[capabilityKey]?.min_plan || 'GROWTH';
    throw new TenantEntitlementError(
      'ENTITLEMENT_REQUIRED',
      `Capability '${capabilityKey}' is not included in the current plan (${effective.plan.code}). Upgrade to ${minPlan} or contact Super Owner for access.`,
      { capabilityKey, currentPlan: effective.plan.code, requiredPlan: minPlan }
    );
  }

  return capability;
}

export async function assertTenantMetricLimit({ database, tenantId, metricKey, currentCount = null, incrementBy = 1 }) {
  if (!database?.query || !tenantId || !metricKey) {
    throw new TenantEntitlementError('LIMIT_CHECK_INVALID', 'Invalid limit check parameters');
  }

  const effective = await resolveEffectiveTenantEntitlements({ database, tenantId });
  const limitInfo = effective.limits[metricKey];

  if (!limitInfo) return true;

  const current = currentCount !== null ? Number(currentCount) : Number(limitInfo.current);
  const next = current + Number(incrementBy || 1);

  if (limitInfo.limit > 0 && next > limitInfo.limit) {
    throw new TenantEntitlementError(
      'LIMIT_EXCEEDED',
      `Usage limit exceeded for '${limitInfo.name}': currently ${current}/${limitInfo.limit}, requested +${incrementBy}. Upgrade plan or adjust allocation.`,
      { metricKey, current, limit: limitInfo.limit, requested: next }
    );
  }

  return limitInfo;
}

export async function grantTenantEntitlementOverride({ database, tenantId, capabilityKey, effect = 'GRANT', reason = null, ownerUserId }) {
  if (!database?.query || !tenantId || !capabilityKey) {
    throw new TenantEntitlementError('OVERRIDE_INVALID', 'Invalid override parameters');
  }
  if (!['GRANT', 'DENY'].includes(effect)) {
    throw new TenantEntitlementError('OVERRIDE_EFFECT_INVALID', 'Override effect must be GRANT or DENY');
  }

  const result = await database.query(
    `INSERT INTO tenant_entitlement_overrides (tenant_id, capability_key, effect, reason, granted_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, capability_key)
     DO UPDATE SET
       effect = EXCLUDED.effect,
       reason = EXCLUDED.reason,
       granted_by_user_id = EXCLUDED.granted_by_user_id,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, capabilityKey, effect, reason, ownerUserId]
  );

  await database.query(
    `INSERT INTO tenant_entitlement_audit_log (tenant_id, action_type, performed_by_user_id, details)
     VALUES ($1, 'OVERRIDE_GRANT', $2, $3::jsonb)`,
    [tenantId, ownerUserId, JSON.stringify({ capabilityKey, effect, reason })]
  );

  return result.rows[0];
}

export async function revokeTenantEntitlementOverride({ database, tenantId, capabilityKey, ownerUserId }) {
  if (!database?.query || !tenantId || !capabilityKey) {
    throw new TenantEntitlementError('OVERRIDE_INVALID', 'Invalid override parameters');
  }

  const deleted = await database.query(
    `DELETE FROM tenant_entitlement_overrides
      WHERE tenant_id = $1 AND capability_key = $2
     RETURNING *`,
    [tenantId, capabilityKey]
  );

  if (deleted.rowCount) {
    await database.query(
      `INSERT INTO tenant_entitlement_audit_log (tenant_id, action_type, performed_by_user_id, details)
       VALUES ($1, 'OVERRIDE_REVOKE', $2, $3::jsonb)`,
      [tenantId, ownerUserId, JSON.stringify({ capabilityKey, previousEffect: deleted.rows[0].effect })]
    );
  }

  return { success: true, revoked: deleted.rowCount > 0 };
}

export async function updateTenantUsageAllocation({ database, tenantId, metricKey, allocatedLimit, ownerUserId }) {
  if (!database?.query || !tenantId || !metricKey || typeof allocatedLimit !== 'number' || allocatedLimit < 0) {
    throw new TenantEntitlementError('ALLOCATION_INVALID', 'Invalid allocation parameters');
  }

  const result = await database.query(
    `INSERT INTO tenant_usage_allocations (tenant_id, metric_key, allocated_limit, reset_interval, updated_by_user_id)
     VALUES ($1, $2, $3, 'MONTHLY', $4)
     ON CONFLICT (tenant_id, metric_key)
     DO UPDATE SET
       allocated_limit = EXCLUDED.allocated_limit,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, metricKey, allocatedLimit, ownerUserId]
  );

  await database.query(
    `INSERT INTO tenant_entitlement_audit_log (tenant_id, action_type, performed_by_user_id, details)
     VALUES ($1, 'LIMIT_UPDATE', $2, $3::jsonb)`,
    [tenantId, ownerUserId, JSON.stringify({ metricKey, allocatedLimit })]
  );

  return result.rows[0];
}


export async function changeTenantSubscriptionAsOwner({ database, tenantId, ownerUserId, planCode, billingCycle = 'MONTHLY', status = 'ACTIVE' }) {
  const requestedPlan = String(planCode ?? '').toUpperCase();
  const requestedCycle = String(billingCycle ?? 'MONTHLY').toUpperCase();

  if (!PLAN_CODES.includes(requestedPlan)) throw new TenantEntitlementError('PLAN_INVALID', 'Requested plan is invalid');
  if (!BILLING_CYCLES.includes(requestedCycle)) throw new TenantEntitlementError('BILLING_CYCLE_INVALID', 'Billing cycle must be MONTHLY or ANNUAL');

  const client = await database.connect();
  try {
    await client.query('BEGIN');

    const tenant = await client.query('SELECT plan_code FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (!tenant.rowCount) throw new TenantEntitlementError('TENANT_NOT_FOUND', 'Tenant not found');
    const currentPlan = tenant.rows[0].plan_code;

    const planData = await client.query('SELECT * FROM platform_plans WHERE code = $1', [requestedPlan]);
    if (!planData.rowCount) throw new TenantEntitlementError('PLAN_NOT_FOUND', 'Plan definition not found');
    const plan = planData.rows[0];

    // Check pending requests
    const pending = await client.query(
      "SELECT id FROM tenant_plan_upgrade_requests WHERE tenant_id = $1 AND status = 'PENDING' FOR UPDATE",
      [tenantId]
    );
    if (pending.rowCount) {
      throw new TenantEntitlementError('PLAN_MANUAL_CHANGE_PENDING_REQUEST', 'Resolve the pending upgrade request before changing this tenant plan');
    }

    // Update tenants table
    await client.query(
      'UPDATE tenants SET plan_code = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [tenantId, requestedPlan]
    );

    // Update/upsert tenant_subscriptions table
    const subResult = await client.query(
      `INSERT INTO tenant_subscriptions (
         tenant_id, plan_code, billing_cycle, currency,
         monthly_price_aed, annual_price_aed, setup_fee_aed, status,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         plan_code = EXCLUDED.plan_code,
         billing_cycle = EXCLUDED.billing_cycle,
         currency = EXCLUDED.currency,
         monthly_price_aed = EXCLUDED.monthly_price_aed,
         annual_price_aed = EXCLUDED.annual_price_aed,
         setup_fee_aed = EXCLUDED.setup_fee_aed,
         status = EXCLUDED.status,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        tenantId, requestedPlan, requestedCycle, plan.currency,
        plan.monthly_price_aed, plan.annual_price_aed, plan.setup_fee_aed, status,
      ]
    );

    // Sync default allocations from plan included_limits for any missing metrics
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

    // Write audit logs
    await client.query(
      `INSERT INTO tenant_plan_change_audit
        (tenant_id, previous_plan_code, new_plan_code, changed_by_user_id, change_source)
       VALUES ($1, $2, $3, $4, 'OWNER_MANUAL_CHANGE')`,
      [tenantId, currentPlan, requestedPlan, ownerUserId]
    );

    await client.query(
      `INSERT INTO tenant_entitlement_audit_log (tenant_id, action_type, performed_by_user_id, details)
       VALUES ($1, 'PLAN_CHANGE', $2, $3::jsonb)`,
      [tenantId, ownerUserId, JSON.stringify({ previousPlan: currentPlan, newPlan: requestedPlan, billingCycle: requestedCycle, status })]
    );

    await client.query('COMMIT');
    return subResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listTenantEntitlementAuditLog({ database, tenantId, limit = 50, offset = 0 }) {
  if (!database?.query || !tenantId) throw new TenantEntitlementError('INVALID_TENANT_ID', 'Invalid tenant ID');
  const result = await database.query(
    `SELECT a.id, a.tenant_id, a.action_type, a.details, a.created_at,
            u.email AS performed_by_email, u.system_role AS performed_by_role
       FROM tenant_entitlement_audit_log a
       LEFT JOIN users u ON u.id = a.performed_by_user_id
      WHERE a.tenant_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2 OFFSET $3`,
    [tenantId, Math.max(1, Math.min(Number(limit) || 50, 100)), Math.max(0, Number(offset) || 0)]
  );
  return result.rows;
}



