import pg from 'pg';
import { getDashboardOverview } from '../services/dashboard-analytics-service.js';

const connectionString = process.env.STAGING_DATABASE_URL;
if (!connectionString) throw new Error('STAGING_DATABASE_URL is required for the dashboard analytics verification');

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
try {
  const tenantResult = await pool.query('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1');
  const tenantId = tenantResult.rows[0]?.id;
  if (!tenantId) {
    console.log('SKIP | STAGING | dashboard analytics: no tenant rows');
  } else {
    const overview = await getDashboardOverview(pool.query.bind(pool), { tenantId });
    console.log(JSON.stringify({
      status: 'PASS',
      check: 'STAGING_DASHBOARD_ANALYTICS',
      tenant_prefix: String(tenantId).slice(0, 8),
      range: overview.range,
      totals: overview.kpis.total_conversations,
      channels: overview.channel_distribution.length,
      intents: overview.top_intents.length,
    }));
  }
} catch (error) {
  console.error(JSON.stringify({
    status: 'FAIL',
    check: 'STAGING_DASHBOARD_ANALYTICS',
    code: error?.code ?? 'UNKNOWN',
    message: String(error?.message ?? 'Unknown error').replace(/\s+/g, ' ').slice(0, 240),
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
