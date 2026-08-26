import { useQueries } from '@tanstack/react-query';
import { ArrowRight, Bot, BookOpenText, Cable, ChartNoAxesCombined, MessagesSquare, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDate } from '../../lib/format';
import type { Conversation, CrmOverviewMetrics, CrmPipelineSummary } from '../../types/api';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';

interface OverviewSummaryProps { assistantCount: number; channelCount: number; documentCount: number; teamCount: number; recentConversations: Conversation[]; crmMetrics?: CrmOverviewMetrics; pipelineSummary?: CrmPipelineSummary[]; tenantId?: string; }
const metricCards = [{ label: 'AI assistants', icon: Bot }, { label: 'Channels', icon: Cable }, { label: 'Knowledge documents', icon: BookOpenText }, { label: 'Team members', icon: UsersRound }];
const displayNumber = (value: number | string) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));
const customerIdentifier = (conversation: Conversation) => conversation.customer_external_id || conversation.external_conversation_id || 'Customer conversation';

export function OverviewSummary({ assistantCount, channelCount, documentCount, teamCount, recentConversations, crmMetrics, pipelineSummary = [], tenantId }: OverviewSummaryProps) {
  const values = [assistantCount, channelCount, documentCount, teamCount];
  const base = tenantId ? '/app/' + tenantId : '';
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <section className="flex flex-wrap items-end justify-between gap-4 pt-1"><div><p className="eyebrow">SamChe AI Platform</p><h1 className="page-title mt-1">AI operations at a glance</h1><p className="mt-2 max-w-2xl text-sm text-stone-400">Live workspace health, customer activity, and CRM data from this tenant.</p></div><div className="flex gap-2"><Link to={base + '/conversations/whatsapp'} className="button-primary">Open conversations <ArrowRight size={15} /></Link><Link to={base + '/pipeline'} className="button-secondary">Open pipeline</Link></div></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metricCards.map(({ label, icon: Icon }, index) => <article key={label} className="dashboard-card p-4"><div className="flex items-center justify-between"><p className="text-xs font-medium text-stone-400">{label}</p><span className="grid h-9 w-9 place-items-center rounded-lg bg-signal-soft text-signal"><Icon aria-hidden="true" size={18} /></span></div><p className="mt-6 text-3xl font-semibold tracking-tight text-ink">{values[index]}</p><p className="mt-1 text-xs text-stone-500">Current tenant total</p></article>)}</section>
    {crmMetrics && <section className="grid gap-4 xl:grid-cols-[1.45fr_1fr]"><div className="dashboard-card p-5"><div className="flex items-start justify-between gap-4"><div><p className="dashboard-section-label">CRM overview</p><p className="mt-1 text-lg font-semibold text-ink">Pipeline and customer health</p></div><ChartNoAxesCombined className="text-signal" aria-hidden="true" size={20} /></div><div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">{[['Total contacts', crmMetrics.total_contacts], ['Open deals', crmMetrics.open_deals], ['Pipeline value', displayNumber(crmMetrics.pipeline_value)], ['Won deals', crmMetrics.won_deals], ['Won revenue', displayNumber(crmMetrics.won_revenue)]].map(([label, value]) => <div key={String(label)} className="bg-panel p-3.5"><p className="text-[11px] font-medium text-stone-500">{label}</p><p className="mt-2 text-xl font-semibold text-ink">{value}</p></div>)}</div>{pipelineSummary.length > 0 && <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{pipelineSummary.map((stage) => <div key={stage.id} className="rounded-lg border border-line bg-elevated/45 p-3"><p className="truncate text-[11px] uppercase tracking-wide text-stone-500">{stage.name}</p><div className="mt-2 flex items-end justify-between gap-3"><p className="text-lg font-semibold text-ink">{stage.deal_count}</p><p className="text-xs text-stone-400">{displayNumber(stage.total_value)} value</p></div></div>)}</div>}</div>
      <section className="dashboard-card overflow-hidden"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div><p className="dashboard-section-label">Conversations</p><p className="mt-1 text-base font-semibold text-ink">Recent activity</p></div><MessagesSquare aria-hidden="true" className="text-signal" size={19} /></div>{recentConversations.length === 0 ? <div className="p-6 text-sm text-stone-400">No conversations have been recorded for this tenant yet.</div> : <ul className="divide-y divide-line">{recentConversations.map((conversation) => <li key={conversation.id}><Link to={base + '/conversations/whatsapp/' + conversation.id} className="flex items-center justify-between gap-4 px-5 py-3.5 transition hover:bg-white/[0.025]"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{customerIdentifier(conversation)}</p><p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-stone-500">{conversation.status}</p></div><span className="shrink-0 text-xs text-stone-500">{formatDate(conversation.created_at)}</span></Link></li>)}</ul>}</section>
    </section>}
    {!crmMetrics && <section className="dashboard-card p-6"><p className="dashboard-section-label">CRM overview</p><p className="mt-2 text-sm text-stone-400">CRM metrics will appear here when this tenant has persisted CRM data.</p></section>}
  </div>;
}

export function OverviewPage() {
  const { selectedTenant } = useTenant(); const tenantId = selectedTenant?.id ?? '';
  const results = useQueries({ queries: [
    { queryKey: tenantKeys.assistants(tenantId), queryFn: () => tenantApi.listAssistants(tenantId), enabled: Boolean(tenantId) },
    { queryKey: tenantKeys.channels(tenantId), queryFn: () => tenantApi.listChannels(tenantId), enabled: Boolean(tenantId) },
    { queryKey: tenantKeys.knowledgeBase(tenantId), queryFn: () => tenantApi.listKnowledgeBase(tenantId), enabled: Boolean(tenantId) },
    { queryKey: tenantKeys.team(tenantId), queryFn: () => tenantApi.listTeam(tenantId), enabled: Boolean(tenantId) },
    { queryKey: tenantKeys.conversations(tenantId, 5, 0), queryFn: () => tenantApi.listConversations(tenantId, { limit: 5, offset: 0 }), enabled: Boolean(tenantId) },
    { queryKey: tenantKeys.crmOverview(tenantId), queryFn: () => tenantApi.getCrmOverview(tenantId), enabled: Boolean(tenantId) },
    { queryKey: tenantKeys.pipelineSummary(tenantId), queryFn: () => tenantApi.listPipelineSummary(tenantId), enabled: Boolean(tenantId) },
  ] });
  const [assistants, channels, documents, team, conversations, crmOverview, pipelineSummary] = results;
  const loading = results.some((result) => result.isLoading); const failed = results.find((result) => result.isError); const retry = () => results.forEach((result) => void result.refetch());
  if (loading) return <div className="space-y-5"><SkeletonBlock className="h-20 w-80" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-32" />)}</div><SkeletonBlock className="h-72" /></div>;
  if (failed) return <QueryErrorState error={failed.error} onRetry={retry} resource="overview data" />;
  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a tenant to view its workspace data." />;
  return <OverviewSummary assistantCount={assistants.data?.length ?? 0} channelCount={channels.data?.length ?? 0} documentCount={documents.data?.length ?? 0} teamCount={team.data?.length ?? 0} recentConversations={conversations.data ?? []} crmMetrics={crmOverview.data} pipelineSummary={pipelineSummary.data} tenantId={tenantId} />;
}
