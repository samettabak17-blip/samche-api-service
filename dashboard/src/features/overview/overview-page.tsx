import { useQuery } from '@tanstack/react-query';
import { Bot, CalendarDays, CheckSquare, Clock3, MessagesSquare, Sparkles, UsersRound, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import type { DashboardOverview } from '../../types/api';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { overviewRangeRequest, useOverviewDateRange } from './overview-date-range-context';

const channelColors: Record<string, string> = { WHATSAPP: '#20c77a', WEB_CHAT: '#e3343d', SAMCHEGUIDE: '#7767f6' };
const channelName = (channel?: string | null) => channel === 'WEB_CHAT' ? 'Web Chatbot' : channel === 'SAMCHEGUIDE' ? 'AI Guide' : channel === 'WHATSAPP' ? 'WhatsApp' : '—';
const compactDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
const relativeTime = (value?: string | null) => {
  if (!value) return '—';
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60000);
  return minutes < 1 ? 'Now' : minutes < 60 ? minutes + 'm ago' : minutes < 1440 ? Math.floor(minutes / 60) + 'h ago' : Math.floor(minutes / 1440) + 'd ago';
};
export const formatOverviewValue = (value: number | null, suffix = '') => value === null ? '—' : value + suffix;
export const overviewWorkspaceName = (name?: string) => name || 'your workspace';
export const overviewConversationLabel = (value?: string | null) => {
  const cleaned = value?.replace(/^(whatsapp|samcheguide|web[_-]?chat):/i, '').trim();
  if (!cleaned) return 'Customer';
  if (/^\+?\d{7,15}$/.test(cleaned)) return cleaned.startsWith('+') ? cleaned : '+' + cleaned;
  return cleaned;
};

function MiniTrend({ trend }: { trend: number | null }) {
  return trend === null
    ? <span className="text-[10px] text-stone-500">—</span>
    : <span className={trend >= 0 ? 'text-[10px] text-emerald-400' : 'text-[10px] text-red-300'}>{trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs prior period</span>;
}

function LineChart({ series }: { series: DashboardOverview['conversation_timeseries'] }) {
  const max = Math.max(...series.map((item) => item.count), 1);
  const points = series.map((item, index) => ({ item, x: series.length === 1 ? 0 : (index / (series.length - 1)) * 100, y: 94 - (item.count / max) * 78 }));
  const line = points.map(({ x, y }) => x + ',' + y).join(' ');
  return <div className="mt-3">
    <div className="h-56 overflow-hidden rounded-xl border border-line/70 bg-[linear-gradient(180deg,rgba(12,21,33,.92),rgba(5,11,18,.78))] p-3 sm:h-64">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-label="Conversations over time">
        <defs><linearGradient id="overview-red-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ef343d" stopOpacity=".30" /><stop offset="100%" stopColor="#ef343d" stopOpacity="0" /></linearGradient></defs>
        {[22, 48, 74].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#263448" strokeDasharray="1 2" vectorEffect="non-scaling-stroke" />)}
        {points.length > 0 && <><polygon points={'0,100 ' + line + ' 100,100'} fill="url(#overview-red-fill)" /><polyline points={line} fill="none" stroke="#ef343d" strokeWidth="1.55" vectorEffect="non-scaling-stroke" />{points.map(({ item, x, y }) => <circle key={item.day} cx={x} cy={y} r="1.55" fill="#ef343d"><title>{compactDate(item.day)}: {item.count} conversations</title></circle>)}</>}
      </svg>
    </div>
    <div className="mt-2 flex justify-between text-[10px] text-stone-500">{series.length ? <><span>{compactDate(series[0].day)}</span><span>{compactDate(series[series.length - 1].day)}</span></> : <span>No conversation activity for this range.</span>}</div>
  </div>;
}

function Donut({ distribution }: { distribution: DashboardOverview['channel_distribution'] }) {
  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  let cursor = 0;
  const colors = distribution.map((item) => { const start = cursor; cursor += total ? (item.count / total) * 100 : 0; return (channelColors[item.channel] ?? '#d7a330') + ' ' + start + '% ' + cursor + '%'; });
  return <div className="mt-5 flex items-center gap-5">
    <div className="grid h-36 w-36 shrink-0 place-items-center rounded-full shadow-[0_0_30px_rgba(24,184,109,.08)]" style={{ background: total ? 'conic-gradient(' + colors.join(',') + ')' : '#172234' }}>
      <div className="grid h-20 w-20 place-items-center rounded-full bg-panel text-center"><span className="text-xl font-semibold text-ink">{total || '—'}</span><span className="text-[9px] uppercase tracking-wider text-stone-500">Total</span></div>
    </div>
    <ul className="min-w-0 flex-1 space-y-2.5">{distribution.length ? distribution.map((item) => <li key={item.channel} className="flex items-center justify-between gap-2 text-xs"><span className="flex min-w-0 items-center gap-2 text-stone-300"><i className="h-2.5 w-2.5 rounded-full" style={{ background: channelColors[item.channel] ?? '#d7a330' }} />{channelName(item.channel)}</span><span className="text-stone-500">{item.count} · {Math.round((item.count / total) * 100)}%</span></li>) : <li className="text-xs text-stone-500">No channel activity yet.</li>}</ul>
  </div>;
}

function NeuralBrain() {
  return <svg viewBox="0 0 82 82" aria-hidden="true" className="h-14 w-14 shrink-0 drop-shadow-[0_0_12px_rgba(228,52,60,.55)]">
    <g fill="none" stroke="#ef343d" strokeWidth="2"><path d="M39 10C24 4 11 15 14 28C3 35 10 53 21 54C21 69 35 75 41 65C48 75 63 69 62 54C74 51 78 34 67 28C70 15 56 4 43 10" /><path d="M41 13v51M22 25l18 12 19-12M19 47l21-10 22 10M30 17l10 20 12-20M28 57l12-20 14 20" /></g>
    {[[22,25],[30,17],[40,13],[52,17],[60,25],[19,47],[28,57],[41,65],[54,57],[63,47],[40,37]].map(([cx,cy]) => <circle key={cx + '-' + cy} cx={cx} cy={cy} r="2.8" fill="#ff626a" />)}
  </svg>;
}

export function OverviewPage() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? '';
  const { activeRange } = useOverviewDateRange();
  const query = useQuery({
    queryKey: tenantKeys.dashboardOverview(tenantId, activeRange.startDate, activeRange.endDate),
    queryFn: () => tenantApi.getDashboardOverview(tenantId, activeRange),
    enabled: Boolean(tenantId),
  });

  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a tenant to view its workspace data." />;
  if (query.isLoading) return <div className="space-y-4"><SkeletonBlock className="h-20 w-80" /><SkeletonBlock className="h-32" /><SkeletonBlock className="h-80" /></div>;
  if (query.isError) return <QueryErrorState error={query.error} onRetry={() => void query.refetch()} resource="dashboard analytics" />;

  const data = query.data!;
  const kpis = [
    ['Total Conversations', data.kpis.total_conversations, MessagesSquare],
    ['New Leads', data.kpis.new_leads, UsersRound],
    ['Appointments', data.kpis.appointments, CalendarDays],
    ['Automations', data.kpis.automations, Zap],
    ['Satisfaction Rate', data.kpis.satisfaction_rate, CheckSquare],
  ] as const;
  const maxIntent = Math.max(...data.top_intents.map((item) => item.count), 1);
  const peakTime = data.insights.peak_hour ? data.insights.peak_hour.replace(/^0/, '') : null;

  return <div className="mx-auto max-w-[1540px] space-y-4 pb-6">
    <header className="flex flex-wrap items-end justify-between gap-4 px-1">
      <div><p className="eyebrow">SamChe AI Platform</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Dashboard Overview</h1><p className="mt-1 text-sm text-stone-400">Live workspace activity and customer engagement for {overviewWorkspaceName(selectedTenant?.name)}.</p></div>
      <span className="rounded-lg border border-line bg-black/10 px-2.5 py-1.5 text-[10px] font-semibold text-stone-400 xl:hidden">{activeRange.label}</span>
    </header>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{kpis.map(([label, value, Icon], index) => <article key={label} className="dashboard-card relative overflow-hidden p-4"><div className="absolute right-0 top-0 h-16 w-16 rounded-bl-[2.4rem] bg-signal/[.035]" /><div className={'icon-orb ' + (index === 0 ? 'text-signal' : index === 1 ? 'text-[#7884ff]' : index === 2 ? 'text-emerald-400' : index === 3 ? 'text-gold' : 'text-sky-400')}><Icon size={18} /></div><p className="mt-4 text-xs text-stone-400">{label}</p><div className="mt-1 flex items-end justify-between gap-2"><p className="text-2xl font-semibold tracking-tight text-ink">{formatOverviewValue(value, label === 'Satisfaction Rate' ? '%' : '')}</p>{index === 0 && <MiniTrend trend={data.kpis.conversation_growth} />}</div></article>)}</section>

    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(19rem,.9fr)]">
      <article className="dashboard-card p-4 sm:p-5"><header className="flex items-center justify-between gap-3"><div><p className="dashboard-section-label">Analytics</p><h2 className="mt-1 text-sm font-semibold text-ink">Conversations Over Time</h2></div><span className="rounded-lg border border-line bg-black/10 px-2.5 py-1.5 text-[10px] font-semibold text-stone-400">{activeRange.label}</span></header><LineChart series={data.conversation_timeseries} /></article>
      <article className="dashboard-card p-4 sm:p-5"><header><p className="dashboard-section-label">Distribution</p><h2 className="mt-1 text-sm font-semibold text-ink">Top Channels</h2></header><Donut distribution={data.channel_distribution} /></article>
    </section>

    <section className="grid gap-4 xl:grid-cols-[1.18fr_.8fr_1fr]">
      <article className="dashboard-card overflow-hidden"><header className="flex items-center justify-between border-b border-line px-4 py-3"><div><p className="dashboard-section-label">Customer activity</p><h2 className="mt-1 text-sm font-semibold text-ink">Recent Conversations</h2></div><Link to={'/app/' + tenantId + '/conversations/whatsapp'} className="text-xs font-medium text-signal">View all →</Link></header><ul className="divide-y divide-line/80">{data.recent_conversations.length ? data.recent_conversations.map((item) => <li key={item.id} className="flex items-center gap-3 px-4 py-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elevated text-[10px] font-bold text-stone-300">{overviewConversationLabel(item.contact_name).slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-ink">{overviewConversationLabel(item.contact_name)}</p><p className="mt-0.5 truncate text-[11px] text-stone-400">{item.last_message_preview || 'No message preview'}</p></div><div className="shrink-0 text-right"><p className="text-[10px] text-stone-500">{relativeTime(item.last_activity_at)}</p><p className="mt-1 text-[10px]" style={{ color: channelColors[item.channel_type] ?? '#8391a7' }}>{channelName(item.channel_type)}</p></div></li>) : <li className="px-4 py-8 text-center text-xs text-stone-500">No conversations in this range.</li>}</ul></article>
      <article className="dashboard-card p-4"><p className="dashboard-section-label">Service quality</p><h2 className="mt-1 text-sm font-semibold text-ink">AI Performance</h2><div className="mt-5 grid grid-cols-2 gap-3">{[['Response Rate', data.ai_performance.response_rate, '%'], ['Avg Response Time', data.ai_performance.average_response_time_ms === null ? null : Number((data.ai_performance.average_response_time_ms / 1000).toFixed(1)), 's'], ['Resolution Rate', data.ai_performance.containment_rate, '%'], ['Customer Satisfaction', data.ai_performance.satisfaction_rate, '%']].map(([label, value, suffix]) => <div key={String(label)} className="border-b border-line/70 pb-3"><p className="text-[10px] text-stone-500">{label}</p><p className="mt-2 text-lg font-semibold text-ink">{formatOverviewValue(value as number | null, suffix as string)}</p><div className="mt-2 h-1 rounded-full bg-signal/20"><span className="block h-full w-2/3 rounded-full bg-signal/70" /></div></div>)}</div></article>
      <article className="dashboard-card p-4"><p className="dashboard-section-label">Demand signals</p><h2 className="mt-1 text-sm font-semibold text-ink">Top Intents</h2><div className="mt-5 space-y-3">{data.top_intents.length ? data.top_intents.map((item) => <div key={item.label}><div className="flex justify-between gap-3 text-xs"><span className="truncate text-stone-300" title={item.label}>{item.label}</span><span className="text-stone-500">{item.count}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.055]"><div className="h-full rounded-full bg-gradient-to-r from-signal to-[#ff4b55]" style={{ width: Math.max(8, (item.count / maxIntent) * 100) + '%' }} /></div></div>) : <p className="py-9 text-center text-xs text-stone-500">No intent data yet.</p>}</div></article>
    </section>

    <section className="dashboard-card relative overflow-hidden p-4 sm:p-5"><div className="pointer-events-none absolute inset-y-0 left-0 w-40 bg-[radial-gradient(circle_at_20%_50%,rgba(212,33,41,.16),transparent_72%)]" /><div className="relative grid gap-4 md:grid-cols-[1.45fr_repeat(4,1fr)]"><div className="flex items-center gap-3 border-b border-line/80 pb-4 md:border-b-0 md:border-r md:pb-0"><NeuralBrain /><div><p className="text-sm font-semibold text-ink">AI Insights</p><p className="mt-1 max-w-[15rem] text-xs text-stone-400">{data.insights.best_channel ? channelName(data.insights.best_channel) + ' is currently the highest-volume channel.' : 'More activity is needed to generate reliable insights.'}</p></div></div><div className="flex items-center gap-3 border-b border-line/80 pb-4 md:border-b-0 md:border-r md:pb-0"><span className="icon-orb h-9 w-9 text-stone-300"><Clock3 size={17} /></span><div className="min-w-0"><p className="text-[10px] uppercase tracking-[.14em] text-stone-500">Peak Time</p><p className="mt-1 truncate text-sm font-semibold text-ink">{peakTime || '—'}</p><p className="mt-0.5 text-[10px] text-stone-500">{peakTime ? 'Most active hour' : '—'}</p></div></div>
      <div className="flex items-center gap-3 border-b border-line/80 pb-4 md:border-b-0 md:border-r md:pb-0"><span className="icon-orb h-9 w-9 text-stone-300"><MessagesSquare size={17} /></span><div className="min-w-0"><p className="text-[10px] uppercase tracking-[.14em] text-stone-500">Best Channel</p><p className="mt-1 truncate text-sm font-semibold text-ink">{channelName(data.insights.best_channel)}</p><p className="mt-0.5 text-[10px] text-stone-500">{data.insights.best_channel ? 'Highest conversation volume' : '—'}</p></div></div>
      <div className="flex items-center gap-3 border-b border-line/80 pb-4 md:border-b-0 md:border-r md:pb-0"><span className="icon-orb h-9 w-9 text-stone-300"><Bot size={17} /></span><div className="min-w-0"><p className="text-[10px] uppercase tracking-[.14em] text-stone-500">Top Performing Bot</p><p className="mt-1 truncate text-sm font-semibold text-ink">{data.insights.top_assistant || '—'}</p><p className="mt-0.5 text-[10px] text-stone-500">{data.insights.top_assistant ? 'Activity volume' : '—'}</p></div></div>
      <div className="flex items-center gap-3 pb-0"><span className="icon-orb h-9 w-9 text-stone-300"><Sparkles size={17} /></span><div className="min-w-0"><p className="text-[10px] uppercase tracking-[.14em] text-stone-500">Growth</p><p className="mt-1 truncate text-sm font-semibold text-ink">{data.insights.growth === null ? '—' : data.insights.growth + '%'}</p><p className="mt-0.5 text-[10px] text-stone-500">vs previous period</p></div></div></div></section>
  </div>;
}
