export function normalizeDashboardRange(value) {
  return Number.parseInt(String(value ?? '7'), 10) === 30 ? 30 : 7;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const number = (value) => Number(value ?? 0);
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function midnight(value) {
  return new Date(value + 'T00:00:00.000Z');
}

function endOfDay(value) {
  return new Date(value + 'T23:59:59.999Z');
}

function iso(value) {
  return value.toISOString();
}

/**
 * Converts either a supported preset or an explicit inclusive UTC date range
 * into one tenant-safe SQL range and the immediately preceding comparison
 * range. Explicit dates are intentionally bounded so a malformed UI value
 * cannot turn the Overview into an unbounded aggregate query.
 */
export function resolveDashboardDateRange({ days = 7, startDate, endDate } = {}, now = new Date()) {
  if (typeof startDate === 'string' && typeof endDate === 'string' && isoDate.test(startDate) && isoDate.test(endDate)) {
    const start = midnight(startDate);
    const end = endOfDay(endDate);
    const rangeDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
    if (rangeDays >= 1 && rangeDays <= 366) {
      const previousEnd = new Date(start.getTime() - 1);
      const previousStart = new Date(start.getTime() - (rangeDays * DAY_MS));
      return { startDate: iso(start), endDate: iso(end), previousStartDate: iso(previousStart), previousEndDate: iso(previousEnd), rangeDays };
    }
  }

  const rangeDays = normalizeDashboardRange(days);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const start = new Date(end.getTime() - ((rangeDays - 1) * DAY_MS));
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(start.getTime() - (rangeDays * DAY_MS));
  return { startDate: iso(start), endDate: iso(end), previousStartDate: iso(previousStart), previousEndDate: iso(previousEnd), rangeDays };
}

export async function getDashboardOverview(query, { tenantId, days = 7, startDate, endDate } = {}) {
  const range = resolveDashboardDateRange({ days, startDate, endDate });
  const rangeParams = [tenantId, range.startDate, range.endDate];
  const comparisonParams = [...rangeParams, range.previousStartDate, range.previousEndDate];
  const [totals, series, channels, recent, intents, peak, assistant, statuses] = await Promise.all([
    query(`SELECT
      COUNT(*) FILTER (WHERE c.created_at >= $2::timestamptz AND c.created_at <= $3::timestamptz)::int AS total_conversations,
      COUNT(*) FILTER (WHERE c.created_at >= $4::timestamptz AND c.created_at <= $5::timestamptz)::int AS previous_conversations,
      (SELECT COUNT(*)::int FROM crm_leads l WHERE l.tenant_id = $1 AND l.created_at >= $2::timestamptz AND l.created_at <= $3::timestamptz) AS new_leads
      FROM conversations c WHERE c.tenant_id = $1`, comparisonParams),
    query(`WITH dates AS (
        SELECT generate_series($2::timestamptz::date, $3::timestamptz::date, INTERVAL '1 day')::date AS day
      )
      SELECT d.day::text AS day, COUNT(c.id)::int AS count
      FROM dates d
      LEFT JOIN conversations c ON c.tenant_id = $1 AND c.created_at >= d.day AND c.created_at < d.day + INTERVAL '1 day'
      GROUP BY d.day ORDER BY d.day`, rangeParams),
    query(`SELECT tc.channel_type AS channel, COUNT(c.id)::int AS count
      FROM conversations c
      JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND c.created_at >= $2::timestamptz AND c.created_at <= $3::timestamptz
      GROUP BY tc.channel_type ORDER BY count DESC, tc.channel_type ASC`, rangeParams),
    query(`SELECT c.id, c.customer_external_id, c.last_activity_at, tc.channel_type,
        COALESCE(NULLIF(contact.display_name, ''), c.customer_external_id, c.external_conversation_id, 'Customer') AS contact_name,
        latest.content AS last_message_preview
      FROM conversations c
      JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
      LEFT JOIN crm_contacts contact ON contact.id = c.contact_id AND contact.tenant_id = c.tenant_id
      LEFT JOIN LATERAL (
        SELECT content FROM conversation_messages m
        WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1
      ) latest ON TRUE
      WHERE c.tenant_id = $1
        AND COALESCE(c.last_activity_at, c.created_at) >= $2::timestamptz
        AND COALESCE(c.last_activity_at, c.created_at) <= $3::timestamptz
      ORDER BY c.last_activity_at DESC NULLS LAST, c.created_at DESC LIMIT 5`, rangeParams),
    query(`SELECT COALESCE(NULLIF(TRIM(l.intent), ''), NULLIF(TRIM(l.service_interest), '')) AS label, COUNT(*)::int AS count
      FROM crm_leads l
      WHERE l.tenant_id = $1 AND l.created_at >= $2::timestamptz AND l.created_at <= $3::timestamptz
        AND COALESCE(NULLIF(TRIM(l.intent), ''), NULLIF(TRIM(l.service_interest), '')) IS NOT NULL
      GROUP BY label ORDER BY count DESC, label ASC LIMIT 6`, rangeParams),
    query(`SELECT LPAD(EXTRACT(HOUR FROM timezone('UTC', m.created_at))::int::text, 2, '0') || ':00' AS hour, COUNT(*)::int AS count
      FROM conversation_messages m
      WHERE m.tenant_id = $1 AND m.created_at >= $2::timestamptz AND m.created_at <= $3::timestamptz
      GROUP BY EXTRACT(HOUR FROM timezone('UTC', m.created_at)) ORDER BY count DESC, hour ASC LIMIT 1`, rangeParams),
    query(`SELECT a.id, a.name, ARRAY_AGG(DISTINCT tc.channel_type ORDER BY tc.channel_type) AS channel_types, COUNT(c.id)::int AS count
      FROM conversations c
      JOIN tenant_channels tc ON tc.id = c.channel_id AND tc.tenant_id = c.tenant_id
      JOIN ai_assistants a ON a.id = tc.assistant_id AND a.tenant_id = tc.tenant_id
      WHERE c.tenant_id = $1 AND c.created_at >= $2::timestamptz AND c.created_at <= $3::timestamptz
      GROUP BY a.id, a.name ORDER BY count DESC, a.id ASC LIMIT 1`, rangeParams),
    query(`SELECT c.status, COUNT(*)::int AS count
      FROM conversations c
      WHERE c.tenant_id = $1 AND c.created_at >= $2::timestamptz AND c.created_at <= $3::timestamptz
      GROUP BY c.status ORDER BY c.status`, rangeParams),
  ]);
  const total = totals.rows[0] ?? {};
  const current = number(total.total_conversations);
  const previous = number(total.previous_conversations);
  const growth = previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(1)) : null;
  const channelDistribution = channels.rows.map((row) => ({ channel: row.channel, count: number(row.count) }));
  const mostActiveAssistant = assistant.rows[0]
    ? { id: assistant.rows[0].id, name: assistant.rows[0].name, channel_types: assistant.rows[0].channel_types ?? [], conversation_count: number(assistant.rows[0].count) }
    : null;
  return {
    range_days: range.rangeDays,
    range: { start_date: range.startDate, end_date: range.endDate, previous_start_date: range.previousStartDate, previous_end_date: range.previousEndDate },
    kpis: {
      total_conversations: current,
      new_leads: number(total.new_leads),
      appointments: null,
      automations: null,
      satisfaction_rate: null,
      conversation_growth: growth,
    },
    conversation_timeseries: series.rows.map((row) => ({ day: row.day, count: number(row.count) })),
    channel_distribution: channelDistribution,
    recent_conversations: recent.rows,
    ai_performance: { response_rate: null, average_response_time_ms: null, containment_rate: null, satisfaction_rate: null },
    top_intents: intents.rows.map((row) => ({ label: row.label, count: number(row.count) })),
    insights: {
      peak_hour: peak.rows[0]?.hour ?? null,
      peak_hour_timezone: 'UTC',
      best_channel: channelDistribution[0]?.channel ?? null,
      most_active_assistant: mostActiveAssistant,
      growth,
      growth_status: previous > 0 ? 'AVAILABLE' : 'INSUFFICIENT_DATA',
    },
    conversation_status_distribution: statuses.rows.map((row) => ({ status: row.status, count: number(row.count) })),
  };
}
