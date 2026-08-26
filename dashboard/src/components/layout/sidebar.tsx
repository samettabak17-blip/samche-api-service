import { BadgeDollarSign, BookOpenText, Bot, Cable, ChevronDown, KanbanSquare, LayoutDashboard, MessageCircle, MessagesSquare, Settings, UsersRound } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import samcheLogo from '../../assets/branding/samche-company-llc-logo.png';
import { useEffect, useState } from 'react';
import type { TenantRole } from '../../types/api';

interface SidebarProps { tenantId: string; tenantName: string; tenantRole: TenantRole | 'OWNER' | undefined; email: string; onLogout(): void; onNavigate(): void; }

const navigation = [
  { label: 'Overview', suffix: '/overview', icon: LayoutDashboard },
  { label: 'AI Assistants', suffix: '/assistants', icon: Bot },
  { label: 'Channels', suffix: '/channels', icon: Cable },
  { label: 'Knowledge Base', suffix: '/knowledge-base', icon: BookOpenText },
  { label: 'Leads', suffix: '/leads', icon: BadgeDollarSign },
  { label: 'Pipeline', suffix: '/pipeline', icon: KanbanSquare },
  { label: 'Team', suffix: '/team', icon: UsersRound },
  { label: 'Settings', suffix: '/settings', icon: Settings },
];

const groups = [
  { title: 'MAIN', labels: ['Overview'] },
  { title: 'AI SOLUTIONS', labels: ['AI Assistants', 'Channels', 'Knowledge Base'] },
  { title: 'CUSTOMER ENGAGEMENT', labels: ['Leads', 'Pipeline'] },
  { title: 'OPERATIONS', labels: ['Team'] },
  { title: 'SETTINGS', labels: ['Settings'] },
];

export function workspaceAccessCopy(tenantRole: TenantRole | 'OWNER' | undefined) {
  if (tenantRole === 'OWNER' || tenantRole === 'ADMIN') return { label: 'ADMIN', detail: 'FULL ACCESS' };
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

  return <aside className="flex h-full w-full flex-col border-r border-line/80 bg-shell/95 px-2.5 py-5 text-white">
    <div className="mb-6 px-2.5"><img src={samcheLogo} alt="SamChe Company LLC" className="h-12 w-32 object-contain object-left" /><p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.24em] text-stone-400">AI Platform</p></div>
    <div className="glass-surface mb-6 rounded-xl px-3 py-3"><p className="truncate text-sm font-medium" title={tenantName}>{tenantName}</p><p className="mt-1 text-xs text-stone-400">{isAgent ? 'Read-only access' : tenantRole ?? 'Workspace access'}</p></div>
    <nav aria-label="Dashboard navigation" className="space-y-4">
      {groups.map((group) => <section key={group.title}>
        <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-stone-500">{group.title}</p>
        {group.title === 'CUSTOMER ENGAGEMENT' && <ConversationNavigation tenantId={tenantId} active={conversationRouteActive} open={conversationsOpen} onToggle={() => setConversationsOpen((value) => !value)} onNavigate={onNavigate} />}
        {navigation.filter((item) => group.labels.includes(item.label)).map(({ label, suffix, icon: Icon }) => <NavLink key={suffix} to={'/app/' + tenantId + suffix} onClick={onNavigate} className={({ isActive }) => 'nav-link ' + (isActive ? 'nav-link-active' : '')}><Icon aria-hidden="true" size={18} strokeWidth={1.8} />{label}</NavLink>)}
      </section>)}
    </nav>
    <div className="mt-auto border-t border-line/80 pt-4">
      <div className="rounded-xl border border-signal/30 bg-[radial-gradient(circle_at_16%_18%,rgba(212,33,41,.2),transparent_8rem),rgba(48,16,24,.58)] px-3 py-3 shadow-[0_12px_28px_rgba(0,0,0,.18)]">
        <p className="text-[10px] font-semibold tracking-[0.18em] text-signal">{access.label}</p>
        <p className="mt-1 text-sm font-semibold text-white">{access.detail}</p>
        <Link to={'/app/' + tenantId + '/settings'} onClick={onNavigate} className="mt-3 flex w-full items-center justify-center rounded-lg border border-signal/35 bg-black/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-signal hover:shadow-signal">Manage Plan</Link>
      </div>
      <p className="mt-3 truncate text-xs text-stone-400" title={email}>{email}</p>
      <button type="button" onClick={onLogout} className="mt-3 w-full rounded-lg border border-line bg-elevated/50 px-3 py-2 text-left text-sm text-stone-400 transition hover:border-signal/30 hover:bg-signal/10 hover:text-white">Sign out</button>
    </div>
  </aside>;
}
