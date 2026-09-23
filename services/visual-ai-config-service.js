import crypto from 'node:crypto';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class VisualAiJobError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'VisualAiJobError';
    this.code = code;
  }
}

export function computeVisualAiIdempotencyKey({
  tenantId,
  conversationId,
  targetResourceId,
  referenceResourceId = null,
  referenceUrl = null,
  promptInstruction,
}) {
  return crypto.createHash('sha256')
    .update(String(tenantId || ''))
    .update(String(conversationId || ''))
    .update(String(targetResourceId || ''))
    .update(String(referenceResourceId || ''))
    .update(String(referenceUrl || ''))
    .update(String(promptInstruction || '').trim().toLowerCase())
    .digest('hex');
}

export async function getTenantVisualAiConfig({ database, tenantId }) {
  if (!database?.query || !UUID_REGEX.test(String(tenantId || ''))) {
    throw new VisualAiJobError('INVALID_TENANT_ID', 'Invalid tenant identifier.');
  }

  const result = await database.query(
    `SELECT tenant_id, enabled, max_monthly_generations, allowed_styles, custom_disclaimer, created_at, updated_at
       FROM tenant_visual_ai_config
      WHERE tenant_id = $1`,
    [tenantId]
  );

  return result.rows[0] ?? {
    tenant_id: tenantId,
    enabled: false,
    max_monthly_generations: 50,
    allowed_styles: ['CONCEPT_PREVIEW'],
    custom_disclaimer: null,
  };
}

export async function upsertTenantVisualAiConfig({
  database,
  tenantId,
  enabled = true,
  maxMonthlyGenerations = 50,
  allowedStyles = ['CONCEPT_PREVIEW'],
  customDisclaimer = null,
}) {
  if (!database?.query || !UUID_REGEX.test(String(tenantId || ''))) {
    throw new VisualAiJobError('INVALID_TENANT_ID', 'Invalid tenant identifier.');
  }

  const result = await database.query(
    `INSERT INTO tenant_visual_ai_config (tenant_id, enabled, max_monthly_generations, allowed_styles, custom_disclaimer)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       max_monthly_generations = EXCLUDED.max_monthly_generations,
       allowed_styles = EXCLUDED.allowed_styles,
       custom_disclaimer = EXCLUDED.custom_disclaimer,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, Boolean(enabled), maxMonthlyGenerations, JSON.stringify(allowedStyles), customDisclaimer]
  );

  return result.rows[0];
}

export async function assertTenantVisualAiEntitlement({ database, tenantId }) {
  const config = await getTenantVisualAiConfig({ database, tenantId });
  if (config.enabled) return config;

  // Check if effective entitlement grants visual_ai via plan or override
  try {
    const { resolveEffectiveTenantEntitlements } = await import('./tenant-entitlement-service.js');
    const effective = await resolveEffectiveTenantEntitlements({ database, tenantId });
    if (effective?.capabilities?.visual_ai?.entitled) {
      return { ...config, enabled: true };
    }
  } catch {
    // If resolution fails, keep config.enabled as strict check
  }

  throw new VisualAiJobError('VISUAL_AI_NOT_ENABLED', 'Visual AI capability is not enabled for this tenant.');
}
