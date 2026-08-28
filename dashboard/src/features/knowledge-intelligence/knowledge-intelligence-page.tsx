import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { MutationFeedback } from '../../components/ui/mutation-feedback';
import { assistantDisplayLabel } from '../../lib/channel-display';
import type { Assistant } from '../../types/api';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';

const tabs = [
  ['overview', 'Overview'], ['sources', 'Sources'], ['candidates', 'Candidates'], ['gaps', 'Knowledge Gaps'],
  ['profiles', 'Business Profile'], ['configurations', 'Configurations'], ['retrieval', 'Retrieval Test'],
] as const;

const inactiveTabClass = 'border-line bg-elevated text-stone-300 hover:border-stone-400 hover:bg-stone-100 hover:text-white';
const activeTabClass = 'border-signal bg-signal text-white shadow-signal';
const routeForTab: Record<string, string> = { overview: 'intelligence', sources: 'sources', candidates: 'candidates', gaps: 'gaps', profiles: 'profile', configurations: 'configurations', retrieval: 'retrieval' };
const tabForRoute: Record<string, string> = Object.fromEntries(Object.entries(routeForTab).map(([tab, route]) => [route, tab]));
const actionClass = 'rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs font-semibold text-stone-200 hover:border-stone-400 hover:text-white disabled:opacity-50';

function Cards({ items }: { items: Array<{ label: string; value: string | number; detail: string }> }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{items.map((item) => <article key={item.label} className="panel p-5"><p className="dashboard-section-label">{item.label}</p><p className="mt-3 text-3xl font-semibold text-ink">{item.value}</p><p className="mt-2 text-xs text-stone-500">{item.detail}</p></article>)}</div>;
}

function DataList({ rows, empty }: { rows: Array<{ id: string; title: string; status: string; detail?: string }>; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} description="No records match this tenant-scoped view." />;
  return <div className="panel divide-y divide-line">{rows.map((row) => <article key={row.id} className="p-5"><div className="flex items-start justify-between gap-4"><strong className="text-sm text-ink">{row.title}</strong><span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-semibold uppercase text-stone-600">{row.status}</span></div>{row.detail && <p className="mt-2 line-clamp-3 text-sm text-stone-600">{row.detail}</p>}</article>)}</div>;
}

export function KnowledgeIntelligencePage() {
  const { tenantId = '' } = useParams();
  const { canManage } = useTenant();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const routeParts = location.pathname.split('/').filter(Boolean);
  const routeSegment = routeParts[routeParts.length - 1] ?? '';
  const tab = searchParams.get('tab') ?? tabForRoute[routeSegment] ?? 'overview';
  const [assistantId, setAssistantId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [previewQuery, setPreviewQuery] = useState('');
  const [editor, setEditor] = useState<{ kind: 'profile' | 'configuration'; id: string; value: string } | null>(null);
  const queryClient = useQueryClient();
  const assistants = useQuery({ queryKey: tenantKeys.assistants(tenantId), queryFn: () => tenantApi.listAssistants(tenantId), enabled: Boolean(tenantId) });
  const channels = useQuery({ queryKey: tenantKeys.channels(tenantId), queryFn: () => tenantApi.listChannels(tenantId), enabled: Boolean(tenantId) });
  const overview = useQuery({ queryKey: tenantKeys.knowledgeOverview(tenantId), queryFn: () => tenantApi.getKnowledgeOverview(tenantId), enabled: Boolean(tenantId && tab === 'overview') });
  const sources = useQuery({ queryKey: tenantKeys.knowledgeSources(tenantId), queryFn: () => tenantApi.listKnowledgeSources(tenantId), enabled: Boolean(tenantId && tab === 'sources') });
  const candidates = useQuery({ queryKey: tenantKeys.knowledgeCandidates(tenantId), queryFn: () => tenantApi.listKnowledgeCandidates(tenantId), enabled: Boolean(tenantId && tab === 'candidates') });
  const gaps = useQuery({ queryKey: tenantKeys.knowledgeGaps(tenantId), queryFn: () => tenantApi.listKnowledgeGaps(tenantId), enabled: Boolean(tenantId && tab === 'gaps') });
  const profiles = useQuery({ queryKey: tenantKeys.businessProfiles(tenantId), queryFn: () => tenantApi.listBusinessProfiles(tenantId), enabled: Boolean(tenantId && tab === 'profiles') });
  const recommendations = useQuery({ queryKey: tenantKeys.knowledgeRecommendations(tenantId, assistantId), queryFn: () => tenantApi.listKnowledgeRecommendations(tenantId, assistantId), enabled: Boolean(tenantId && assistantId && tab === 'configurations') });
  const configurations = useQuery({ queryKey: tenantKeys.assistantConfigurations(tenantId, assistantId), queryFn: () => tenantApi.listAssistantConfigurations(tenantId, assistantId), enabled: Boolean(tenantId && assistantId && tab === 'configurations') });
  const generateProfile = useMutation({ mutationFn: () => tenantApi.generateBusinessProfile(tenantId), onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKeys.businessProfiles(tenantId) }) });
  const preview = useMutation({ mutationFn: () => tenantApi.previewKnowledgeRetrieval(tenantId, assistantId, previewQuery.trim()) });
  const assignSource = useMutation({
    mutationFn: () => tenantApi.assignKnowledgeSource(tenantId, sourceId, assistantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKeys.knowledgeSources(tenantId) }),
  });
  const refreshProfiles = () => queryClient.invalidateQueries({ queryKey: tenantKeys.businessProfiles(tenantId) });
  const refreshConfigurations = () => queryClient.invalidateQueries({ queryKey: tenantKeys.assistantConfigurations(tenantId, assistantId) });
  const profileAction = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'activate' | 'rollback' }) => action === 'approve' || action === 'reject' ? tenantApi.reviewBusinessProfile(tenantId, id, action) : action === 'activate' ? tenantApi.activateBusinessProfile(tenantId, id) : tenantApi.rollbackBusinessProfile(tenantId, id), onSuccess: refreshProfiles });
  const saveProfile = useMutation({ mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => tenantApi.updateBusinessProfile(tenantId, id, data), onSuccess: () => { setEditor(null); refreshProfiles(); } });
  const recommendationAction = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => tenantApi.reviewRecommendation(tenantId, assistantId, id, action), onSuccess: () => queryClient.invalidateQueries({ queryKey: tenantKeys.knowledgeRecommendations(tenantId, assistantId) }) });
  const generateConfiguration = useMutation({ mutationFn: (recommendationId: string) => tenantApi.generateAssistantConfiguration(tenantId, assistantId, recommendationId), onSuccess: refreshConfigurations });
  const configurationAction = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'activate' | 'rollback' }) => action === 'approve' || action === 'reject' ? tenantApi.reviewAssistantConfiguration(tenantId, assistantId, id, action) : action === 'activate' ? tenantApi.activateAssistantConfiguration(tenantId, assistantId, id) : tenantApi.rollbackAssistantConfiguration(tenantId, assistantId, id), onSuccess: refreshConfigurations });
  const saveConfiguration = useMutation({ mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => tenantApi.updateAssistantConfiguration(tenantId, assistantId, id, data), onSuccess: () => { setEditor(null); refreshConfigurations(); } });

  const saveEditor = () => {
    if (!editor) return;
    let data: Record<string, unknown>;
    try { data = JSON.parse(editor.value) as Record<string, unknown>; } catch { return; }
    if (editor.kind === 'profile') saveProfile.mutate({ id: editor.id, data });
    else saveConfiguration.mutate({ id: editor.id, data });
  };

  const assistantSelect = <label className="block text-sm font-medium text-ink">Assistant<select aria-label="Assistant" value={assistantId} onChange={(event) => setAssistantId(event.target.value)} className="mt-2 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-ink"><option value="">Select an assistant</option>{(assistants.data ?? []).map((assistant: Assistant) => <option key={assistant.id} value={assistant.id}>{assistantDisplayLabel(assistant, channels.data ?? [])}</option>)}</select></label>;

  return <section className="space-y-6">
    <header><p className="eyebrow">Grounding operations</p><h1 className="page-title mt-2">Knowledge Intelligence</h1><p className="mt-2 text-sm text-stone-600">Review sources, generated artifacts and retrieval behavior before runtime activation.</p></header>
    <nav aria-label="Knowledge Intelligence sections" className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <Link key={key} to={`/app/${tenantId}/knowledge-base/${routeForTab[key]}`} aria-current={tab === key ? 'page' : undefined} className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none ${tab === key ? activeTabClass : inactiveTabClass}`}>{label}</Link>)}<Link to={`/app/${tenantId}/knowledge-base`} className={`rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-none ${inactiveTabClass}`}>Legacy Knowledge Base</Link></nav>

    {tab === 'overview' && (overview.isLoading ? <SkeletonBlock className="h-40" /> : overview.error ? <QueryErrorState error={overview.error} onRetry={() => overview.refetch()} /> : overview.data && <Cards items={[
      { label: 'Sources', value: overview.data.sources.ready, detail: `${overview.data.sources.ready} ready sources` },
      { label: 'Review queue', value: Object.values(overview.data.reviewQueue).reduce((sum, value) => sum + value, 0), detail: 'Candidates, profiles and configurations' },
      { label: 'Knowledge gaps', value: overview.data.gaps.open, detail: 'Open verified gaps' },
      { label: 'Runtime coverage', value: `${overview.data.runtime.activeConfigurations}/${overview.data.runtime.assistants}`, detail: overview.data.runtime.activeProfile ? 'Active Business Profile' : 'No active Business Profile' },
    ]} />)}
    {tab === 'sources' && <div className="space-y-5">{canManage && (sources.data ?? []).length > 0 && <form onSubmit={(event: FormEvent) => { event.preventDefault(); if (sourceId && assistantId) assignSource.mutate(); }} className="panel grid gap-4 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end"><label className="block text-sm font-medium text-ink">Knowledge source<select aria-label="Knowledge source" value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="mt-2 w-full rounded-lg border border-line bg-elevated px-3 py-2 text-ink"><option value="">Select a source</option>{(sources.data ?? []).map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label>{assistantSelect}<button type="submit" disabled={!sourceId || !assistantId || assignSource.isPending} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{assignSource.isPending ? 'Assigning…' : 'Assign source'}</button></form>}<MutationFeedback error={assignSource.error} /><DataList empty="No sources" rows={(sources.data ?? []).map((row) => ({ id: row.id, title: row.title, status: row.processing_status, detail: `${row.source_type} · Index ${row.indexing_status}` }))} /></div>}
    {tab === 'candidates' && <DataList empty="No candidates" rows={(candidates.data ?? []).map((row) => ({ id: row.id, title: row.proposed_title, status: row.status, detail: row.proposed_content }))} />}
    {tab === 'gaps' && <DataList empty="No knowledge gaps" rows={(gaps.data ?? []).map((row) => ({ id: row.id, title: row.normalized_question, status: row.status, detail: `${row.occurrence_count} verified occurrence${row.occurrence_count === 1 ? '' : 's'}` }))} />}
    {tab === 'profiles' && <div className="space-y-4"><MutationFeedback error={generateProfile.error ?? profileAction.error ?? saveProfile.error} />{canManage && <button type="button" onClick={() => generateProfile.mutate()} disabled={generateProfile.isPending} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">{generateProfile.isPending ? 'Generating…' : 'Generate Business Profile'}</button>}<div className="panel divide-y divide-line">{(profiles.data ?? []).map((row) => <article key={row.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong className="text-sm text-ink">Business Profile {row.id.slice(0, 8)}</strong><p className="mt-1 text-xs text-stone-400">{row.status}{row.active_version_id === row.id ? ' · ACTIVE' : ''}</p></div>{canManage && <div className="flex flex-wrap gap-2">{row.status === 'NEEDS_REVIEW' && <><button className={actionClass} onClick={() => setEditor({ kind: 'profile', id: row.id, value: JSON.stringify(row.profile_data, null, 2) })}>Edit</button><button className={actionClass} onClick={() => profileAction.mutate({ id: row.id, action: 'approve' })}>Approve</button><button className={actionClass} onClick={() => profileAction.mutate({ id: row.id, action: 'reject' })}>Reject</button></>}{row.status === 'APPROVED' && row.active_version_id !== row.id && <button className={actionClass} onClick={() => profileAction.mutate({ id: row.id, action: row.superseded_by_version_id ? 'rollback' : 'activate' })}>{row.superseded_by_version_id ? 'Rollback' : 'Activate'}</button>}</div>}</div></article>)}</div></div>}
    {tab === 'configurations' && <div className="space-y-5"><div className="panel max-w-xl p-5">{assistantSelect}</div>{assistantId && <div className="grid gap-5 lg:grid-cols-2"><div><h2 className="mb-3 font-semibold">Recommendations</h2><div className="panel divide-y divide-line">{(recommendations.data ?? []).map((row) => <article key={row.id} className="p-4"><strong className="text-sm">Recommendation {row.id.slice(0, 8)}</strong><p className="mt-1 text-xs text-stone-400">{row.status}</p>{canManage && <div className="mt-3 flex flex-wrap gap-2">{row.status === 'NEEDS_REVIEW' && <><button className={actionClass} onClick={() => recommendationAction.mutate({ id: row.id, action: 'approve' })}>Approve</button><button className={actionClass} onClick={() => recommendationAction.mutate({ id: row.id, action: 'reject' })}>Reject</button></>}{row.status === 'APPROVED' && <button className={actionClass} onClick={() => generateConfiguration.mutate(row.id)}>Generate configuration</button>}</div>}</article>)}</div></div><div><h2 className="mb-3 font-semibold">Configurations</h2><div className="panel divide-y divide-line">{(configurations.data ?? []).map((row) => <article key={row.id} className="p-4"><strong className="text-sm">Configuration {row.id.slice(0, 8)}</strong><p className="mt-1 text-xs text-stone-400">{row.status}</p>{canManage && <div className="mt-3 flex flex-wrap gap-2">{row.status === 'NEEDS_REVIEW' && <><button className={actionClass} onClick={() => setEditor({ kind: 'configuration', id: row.id, value: JSON.stringify(row.configuration_data, null, 2) })}>Edit</button><button className={actionClass} onClick={() => configurationAction.mutate({ id: row.id, action: 'approve' })}>Approve</button><button className={actionClass} onClick={() => configurationAction.mutate({ id: row.id, action: 'reject' })}>Reject</button></>}{row.status === 'APPROVED' && <button className={actionClass} onClick={() => configurationAction.mutate({ id: row.id, action: 'activate' })}>Activate</button>}{row.status === 'SUPERSEDED' && <button className={actionClass} onClick={() => configurationAction.mutate({ id: row.id, action: 'rollback' })}>Rollback</button>}</div>}</article>)}</div></div></div>}</div>}
    {editor && <div role="dialog" aria-modal="true" aria-label={`Edit ${editor.kind}`} className="panel max-w-2xl p-5"><label className="block text-sm font-medium text-ink">Review JSON<textarea aria-label="Review JSON" rows={10} value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value })} className="mt-2 w-full rounded-lg border border-line bg-elevated p-3 font-mono text-xs text-ink" /></label><div className="mt-3 flex gap-2"><button className={actionClass} onClick={saveEditor}>Save review</button><button className={actionClass} onClick={() => setEditor(null)}>Cancel</button></div></div>}
    {tab === 'retrieval' && <div className="space-y-5"><form onSubmit={(event: FormEvent) => { event.preventDefault(); if (canManage && assistantId && previewQuery.trim()) preview.mutate(); }} className="panel max-w-2xl space-y-4 p-5">{assistantSelect}<label className="block text-sm font-medium">Test question<textarea aria-label="Test question" value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-line px-3 py-2" /></label>{canManage && <button type="submit" disabled={!assistantId || !previewQuery.trim() || preview.isPending} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">{preview.isPending ? 'Running…' : 'Run retrieval'}</button>}</form><MutationFeedback error={preview.error} />{preview.data && <DataList empty="No matches" rows={preview.data.matches.map((match) => ({ id: match.chunkId, title: match.sourceTitle, status: `${Math.round(match.similarity * 100)}%`, detail: match.excerpt }))} />}</div>}
  </section>;
}
