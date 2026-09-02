import { BadgeDollarSign, BookOpenText, Bot, Cable, ChevronDown, KanbanSquare, LayoutDashboard, MessageCircle, MessagesSquare, Palette, Settings, UsersRound } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import samcheLogo from '../../assets/branding/samche-company-llc-logo.png';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { TenantRole } from '../../types/api';
import { tenantApi } from '../../features/dashboard/dashboard-api';
import { DashboardButton, DashboardField, DashboardFormMessage, DashboardSelect } from '../ui/dashboard-control';
import { Modal } from '../ui/modal';

interface SidebarProps { tenantId: string; tenantName: string; tenantRole: TenantRole | 'OWNER' | undefined; email: string; onLogout(): void; onNavigate(): void; }

const navigation = [
  { label: 'Overview', suffix: '/overview', icon: LayoutDashboard },
  { label: 'AI Assistants', suffix: '/assistants', icon: Bot },
  { label: 'Channels', suffix: '/channels', icon: Cable },
  { label: 'Guide Experience', suffix: '/guide-experience', icon: Palette },
  { label: 'Knowledge Base', suffix: '/knowledge-base', icon: BookOpenText },
  { label: 'Knowledge Intelligence', suffix: '/knowledge', icon: BookOpenText },
  { label: 'Leads', suffix: '/leads', icon: BadgeDollarSign },
  { label: 'Pipeline', suffix: '/pipeline', icon: KanbanSquare },
  { label: 'Team', suffix: '/team', icon: UsersRound },
  { label: 'Settings', suffix: '/settings', icon: Settings },
];

const groups = [
  { title: 'MAIN', labels: ['Overview'] },
  { title: 'AI SOLUTIONS', labels: ['AI Assistants', 'Channels', 'Guide Experience', 'Knowledge Intelligence', 'Knowledge Base'] },
  { title: 'CUSTOMER ENGAGEMENT', labels: ['Leads', 'Pipeline'] },
  { title: 'OPERATIONS', labels: ['Team'] },
  { title: 'SETTINGS', labels: ['Settings'] },
];

export function workspaceAccessCopy(tenantRole: TenantRole | 'OWNER' | undefined) {
  if (tenantRole === 'OWNER') return { label: 'ADMIN', detail: 'FULL ACCESS' };
  if (tenantRole === 'ADMIN') return { label: 'WORKSPACE ADMIN', detail: 'TENANT ADMINISTRATION' };
  return { label: tenantRole === 'AGENT' ? 'TEAM ACCESS' : 'WORKSPACE ACCESS', detail: tenantRole === 'AGENT' ? 'ASSIGNED ROLE' : 'PLAN NOT AVAILABLE' };
}

function ConversationNavigation({ tenantId, active, open, onToggle, onNavigate }: { tenantId: string; active: boolean; open: boolean; onToggle(): void; onNavigate(): void }) {
  const base = '/app/' + tenantId + '/conversations';
  return <div className="space-y-1">
    <button type="button" onClick={onToggle} className={'nav-link w-full justify-between ' + (active ? 'nav-link-active' : '')}>
      <span className="inline-flex items-center gap-3"><MessagesSquare aria-hidden="true" size={18} strokeWidth={1.8} />Conversations</span>
      <ChevronDown aria-hidden="true" size={16} className={'transition-transform ' + (open ? 'rotate-0' : '-rotate-90')} />
    </button>
    {open && <div className="ml-5 space-y-1 border-l border-line pl-3">{
      [
        { label: 'WhatsApp', route: 'whatsapp', icon: MessageCircle },
        { label: 'Web Chatbot', route: 'web-chat', icon: MessageCircle },
        { label: 'AI Guide', route: 'guide', icon: Bot },
      ].map(({ label, route, icon: Icon }) => <NavLink key={route} to={base + '/' + route} onClick={onNavigate} className={({ isActive }) => 'flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition ' + (isActive ? 'bg-signal/15 text-red-100' : 'text-stone-400 hover:bg-white/[0.04] hover:text-white')}><Icon aria-hidden="true" size={15} />{label}</NavLink>)
    }</div>}
  </div>;
}

export function Sidebar({ tenantId, tenantName, tenantRole, email, onLogout, onNavigate }: SidebarProps) {
  const location = useLocation();
  const conversationBase = '/app/' + tenantId + '/conversations';
  const conversationRouteActive = location.pathname.startsWith(conversationBase);
  const [conversationsOpen, setConversationsOpen] = useState(conversationRouteActive);
  useEffect(() => { if (conversationRouteActive) setConversationsOpen(true); }, [conversationRouteActive]);
  const isAgent = tenantRole === 'AGENT';
  const access = workspaceAccessCopy(tenantRole);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [requestedPlan, setRequestedPlan] = useState('');
  const plan = useQuery({ queryKey: ['tenant', tenantId, 'plan'], queryFn: () => tenantApi.getTenantPlan(tenantId), enabled: Boolean(tenantId) && tenantRole !== 'OWNER' });
  const catalog = useQuery({ queryKey: ['platform-plans'], queryFn: () => tenantApi.listPlans(), enabled: Boolean(tenantId) && tenantRole === 'ADMIN' });
  const upgrade = useMutation({ mutationFn: () => tenantApi.requestPlanUpgrade(tenantId, requestedPlan), onSuccess: () => { void plan.refetch(); setUpgradeOpen(true); } });
  const availableUpgrades = (catalog.data ?? []).filter((item) => item.rank > (plan.data?.rank ?? Number.MAX_SAFE_INTEGER));

  return <aside className="flex h-full w-full flex-col border-r border-line/80 bg-shell/95 px-2.5 py-5 text-white">
    <div className="mb-6 px-2.5"><img src={samcheLogo} alt="SamChe Company LLC" className="mx-auto h-32 w-full max-w-full object-contain object-center" /><p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-gold">AI Platform</p></div>
    <div className="glass-surface mb-6 rounded-xl px-3 py-3"><p className="truncate text-sm font-medium" title={tenantName}>{tenantName}</p><p className="mt-1 text-xs text-stone-400">{isAgent ? 'Read-only access' : tenantRole ?? 'Workspace access'}</p></div>
    <nav aria-label="Dashboard navigation" className="space-y-4">
      {groups.map((group) => <section key={group.title}>
        <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-stone-500">{group.title}</p>
        {group.title === 'CUSTOMER ENGAGEMENT' && <ConversationNavigation tenantId={tenantId} active={conversationRouteActive} open={conversationsOpen} onToggle={() => setConversationsOpen((value) => !value)} onNavigate={onNavigate} />}
        {navigation.filter((item) => group.labels.includes(item.label)).map(({ label, suffix, icon: Icon }) => <NavLink key={suffix} to={'/app/' + tenantId + suffix} onClick={onNavigate} className={({ isActive }) => 'nav-link ' + (isActive ? 'nav-link-active' : '')}><Icon aria-hidden="true" size={18} strokeWidth={1.8} />{label}</NavLink>)}
      </section>)}
    </nav>
    <div className="mt-auto border-t border-line/80 pt-4">
      {tenantRole !== 'OWNER' && plan.data && <div className="mb-3 rounded-xl border border-gold/25 bg-[linear-gradient(145deg,rgba(23,28,38,.94),rgba(10,14,21,.94))] px-3 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold">Current plan</p>
        <p className="mt-1 text-sm font-semibold text-white">{plan.data.display_name}</p>
        <p className="mt-1 text-xs text-stone-300">{plan.data.customer_subtitle}</p>
        {tenantRole === 'ADMIN' && availableUpgrades.length > 0 && <DashboardButton type="button" variant="outline" className="mt-3 w-full text-xs" onClick={() => { setRequestedPlan(availableUpgrades[0]?.code ?? ''); setUpgradeOpen(true); }}>Upgrade Plan</DashboardButton>}
      </div>}
      <div className="rounded-xl border border-signal/30 bg-[radial-gradient(circle_at_16%_18%,rgba(212,33,41,.2),transparent_8rem),rgba(48,16,24,.58)] px-3 py-3 shadow-[0_12px_28px_rgba(0,0,0,.18)]">
        <p className="text-[10px] font-semibold tracking-[0.18em] text-signal">{access.label}</p>
        <p className="mt-1 text-sm font-semibold text-white">{access.detail}</p>
        {tenantRole === 'OWNER' && <Link to={'/app/' + tenantId + '/settings'} onClick={onNavigate} className="mt-3 flex w-full items-center justify-center rounded-lg border border-signal/35 bg-black/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-signal hover:shadow-signal">Manage Plan</Link>}
      </div>
      <p className="mt-3 truncate text-xs text-stone-400" title={email}>{email}</p>
      <button type="button" onClick={onLogout} className="mt-3 w-full rounded-lg border border-line bg-elevated/50 px-3 py-2 text-left text-sm text-stone-400 transition hover:border-signal/30 hover:bg-signal/10 hover:text-white">Sign out</button>
      <Modal open={upgradeOpen} title="Request plan upgrade" onClose={() => { if (!upgrade.isPending) setUpgradeOpen(false); }} className="max-w-md">
        {plan.data?.pending_request ? <div className="mt-5 space-y-4"><p className="text-sm text-stone-300">Your plan will not change until a Platform Super Admin approves this request.</p><dl className="rounded-xl border border-gold/25 bg-elevated/70 p-4 text-sm"><div><dt className="dashboard-helper text-xs">Requested plan</dt><dd className="mt-1 font-semibold text-white">{catalog.data?.find((item) => item.code === plan.data?.pending_request?.requested_plan_code)?.display_name ?? plan.data.pending_request.requested_plan_code}</dd></div><div className="mt-3"><dt className="dashboard-helper text-xs">Status</dt><dd className="mt-1 font-semibold text-gold">Pending approval</dd></div></dl><div className="flex justify-end"><DashboardButton type="button" variant="ghost" onClick={() => setUpgradeOpen(false)}>Close</DashboardButton></div></div> : <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); if (requestedPlan) upgrade.mutate(); }}>
          <p className="text-sm text-stone-300">Your plan will not change until a Platform Super Admin approves this request.</p>
          <DashboardField label="Requested plan"><DashboardSelect aria-label="Requested plan" value={requestedPlan} onChange={(event) => setRequestedPlan(event.target.value)}>{availableUpgrades.map((item) => <option key={item.code} value={item.code}>{item.display_name}</option>)}</DashboardSelect></DashboardField>
          {upgrade.isError && <DashboardFormMessage>Could not submit the upgrade request. Please try again.</DashboardFormMessage>}
          <div className="flex justify-end gap-3"><DashboardButton type="button" variant="ghost" disabled={upgrade.isPending} onClick={() => setUpgradeOpen(false)}>Cancel</DashboardButton><DashboardButton type="submit" variant="primary" disabled={upgrade.isPending || !requestedPlan}>{upgrade.isPending ? 'Submitting…' : 'Submit upgrade request'}</DashboardButton></div>
        </form>}
      </Modal>
    </div>
  </aside>;
}
