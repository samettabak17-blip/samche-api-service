import { useQueries } from '@tanstack/react-query';
import { Bot, BookOpenText, Cable, ChartNoAxesCombined, MessagesSquare, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDate } from '../../lib/format';
import type { Conversation, CrmOverviewMetrics, CrmPipelineSummary } from '../../types/api';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';

interface OverviewSummaryProps {
  assistantCount: number;
  channelCount: number;
  documentCount: number;
  teamCount: number;
  recentConversations: Conversation[];
  crmMetrics?: CrmOverviewMetrics;
  pipelineSummary?: CrmPipelineSummary[];
}

const metricCards = [
  { label: 'AI assistants', icon: Bot },
  { label: 'Channels', icon: Cable },
  { label: 'Knowledge documents', icon: BookOpenText },
  { label: 'Team members', icon: UsersRound },
];

const displayNumber = (value: number | string) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));

export function OverviewSummary({ assistantCount, channelCount, documentCount, teamCount, recentConversations, crmMetrics, pipelineSummary = [] }: OverviewSummaryProps) {
  const values = [assistantCount, channelCount, documentCount, teamCount];
  return <div className="space-y-7">
    <section><p className="eyebrow">Operational overview</p><h1 className="page-title mt-2">Welcome back</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-stone-500">Manage your AI operations from one secure workspace.</p></section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metricCards.map(({ label, icon: Icon }, index) => <article key={label} className="panel p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-stone-500">{label}</p><span className="grid h-10 w-10 place-items-center rounded-lg bg-signal-soft text-signal"><Icon aria-hidden="true" size={19} /></span></div><p className="mt-8 text-3xl font-semibold tracking-tight text-ink">{values[index]}</p></article>)}</section>
    {crmMetrics && <section className="space-y-4"><div className="flex items-center gap-2"><ChartNoAxesCombined className="text-signal" aria-hidden="true" size={19} /><div><p className="text-base font-semibold text-ink">CRM overview</p><p className="text-sm text-stone-500">Persisted contact and opportunity data for this tenant.</p></div></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[
      ['Total contacts', crmMetrics.total_contacts],
      ['Open deals', crmMetrics.open_deals],
      ['Pipeline value', displayNumber(crmMetrics.pipeline_value)],
      ['Won deals', crmMetrics.won_deals],
      ['Won revenue', displayNumber(crmMetrics.won_revenue)],
    ].map(([label, value]) => <article key={String(label)} className="panel p-5"><p className="text-sm font-medium text-stone-500">{label}</p><p className="mt-5 text-2xl font-semibold tracking-tight text-ink">{value}</p></article>)}</div>
    {pipelineSummary.length > 0 && <div className="panel overflow-hidden"><div className="border-b border-line px-5 py-4"><p className="text-sm font-semibold text-ink">Pipeline summary</p></div><ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-6">{pipelineSummary.map((stage) => <li key={stage.id} className="p-4"><p className="text-xs uppercase tracking-wide text-stone-500">{stage.name}</p><p className="mt-2 text-lg font-semibold text-ink">{stage.deal_count}</p><p className="mt-1 text-xs text-stone-500">{displayNumber(stage.total_value)} value</p></li>)}</ul></div>}</section>}
    <section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div><p className="text-base font-semibold text-ink">Recent conversations</p><p className="mt-1 text-sm text-stone-500">Actual conversations returned from this tenant workspace.</p></div><MessagesSquare aria-hidden="true" className="text-signal" size={20} /></div>{recentConversations.length === 0 ? <div className="p-8"><p className="text-sm text-stone-500">No conversations have been recorded for this tenant yet.</p></div> : <ul className="divide-y divide-line">{recentConversations.map((conversation) => <li key={conversation.id}><Link to={'/app/' + conversation.tenant_id + '/conversations/' + conversation.id} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-white/[0.025]"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{conversation.customer_external_id || conversation.external_conversation_id || 'Customer conversation'}</p><p className="mt-1 text-xs font-medium uppercase tracking-wide text-stone-500">{conversation.status}</p></div><span className="text-xs text-stone-500">{formatDate(conversation.created_at)}</span></Link></li>)}</ul>}</section>
  </div>;
}

export function OverviewPage() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? '';
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
  const loading = results.some((result) => result.isLoading);
  const failed = results.find((result) => result.isError);
  const retry = () => results.forEach((result) => void result.refetch());
  if (loading) return <div className="space-y-7"><SkeletonBlock className="h-20 w-80" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-36" />)}</div><SkeletonBlock className="h-72" /></div>;
  if (failed) return <QueryErrorState error={failed.error} onRetry={retry} resource="overview data" />;
  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a tenant to view its workspace data." />;
  return <OverviewSummary assistantCount={assistants.data?.length ?? 0} channelCount={channels.data?.length ?? 0} documentCount={documents.data?.length ?? 0} teamCount={team.data?.length ?? 0} recentConversations={conversations.data ?? []} crmMetrics={crmOverview.data} pipelineSummary={pipelineSummary.data} />;
}
