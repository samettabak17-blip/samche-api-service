import { useQueries } from '@tanstack/react-query';
import { Bot, BookOpenText, Cable, MessagesSquare, UsersRound } from 'lucide-react';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDate } from '../../lib/format';
import type { Conversation } from '../../types/api';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';

interface OverviewSummaryProps {
  assistantCount: number;
  channelCount: number;
  documentCount: number;
  teamCount: number;
  recentConversations: Conversation[];
}

const metricCards = [
  { label: 'AI assistants', icon: Bot },
  { label: 'Channels', icon: Cable },
  { label: 'Knowledge documents', icon: BookOpenText },
  { label: 'Team members', icon: UsersRound },
];

export function OverviewSummary({ assistantCount, channelCount, documentCount, teamCount, recentConversations }: OverviewSummaryProps) {
  const values = [assistantCount, channelCount, documentCount, teamCount];

  return <div className="space-y-7"><section><p className="eyebrow">Tenant overview</p><h1 className="page-title mt-2">Your AI workspace, at a glance.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">A live snapshot of the resources currently available in this tenant.</p></section><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metricCards.map(({ label, icon: Icon }, index) => <article key={label} className="panel p-5"><div className="flex items-center justify-between"><p className="text-sm font-medium text-stone-600">{label}</p><span className="grid h-9 w-9 place-items-center rounded-xl bg-signal-soft text-signal"><Icon aria-hidden="true" size={18} /></span></div><p className="mt-7 text-3xl font-semibold tracking-tight text-ink">{values[index]}</p></article>)}</section><section className="panel overflow-hidden"><div className="flex items-center justify-between border-b border-line px-5 py-4"><div><p className="text-base font-semibold text-ink">Recent conversations</p><p className="mt-1 text-sm text-stone-500">The latest conversations returned by your tenant workspace.</p></div><MessagesSquare aria-hidden="true" className="text-stone-400" size={20} /></div>{recentConversations.length === 0 ? <div className="p-5"><p className="text-sm text-stone-600">No conversations have been recorded for this tenant yet.</p></div> : <ul className="divide-y divide-line">{recentConversations.map((conversation) => <li key={conversation.id} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{conversation.customer_external_id || conversation.external_conversation_id || 'Customer conversation'}</p><p className="mt-1 text-xs font-medium uppercase tracking-wide text-stone-500">{conversation.status}</p></div><span className="text-xs text-stone-500">{formatDate(conversation.created_at)}</span></li>)}</ul>}</section></div>;
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
  ] });
  const [assistants, channels, documents, team, conversations] = results;
  const loading = results.some((result) => result.isLoading);
  const failed = results.find((result) => result.isError);
  const retry = () => results.forEach((result) => void result.refetch());

  if (loading) return <div className="space-y-7"><SkeletonBlock className="h-20 w-80" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <SkeletonBlock key={index} className="h-36" />)}</div><SkeletonBlock className="h-72" /></div>;
  if (failed) return <QueryErrorState error={failed.error} onRetry={retry} resource="overview data" />;
  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a tenant to view its workspace data." />;

  return <OverviewSummary assistantCount={assistants.data?.length ?? 0} channelCount={channels.data?.length ?? 0} documentCount={documents.data?.length ?? 0} teamCount={team.data?.length ?? 0} recentConversations={conversations.data ?? []} />;
}

