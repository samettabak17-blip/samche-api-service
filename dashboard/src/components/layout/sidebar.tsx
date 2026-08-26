import { BadgeDollarSign, BookOpenText, Bot, Cable, ChevronDown, KanbanSquare, LayoutDashboard, MessageCircle, MessagesSquare, Settings, UsersRound } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import samcheLogo from '../../assets/branding/samche-company-llc-logo.png';
import { useEffect, useState } from 'react';
import type { TenantRole } from '../../types/api';

interface SidebarProps { tenantId: string; tenantName: string; tenantRole: TenantRole | 'OWNER' | undefined; email: string; onLogout(): void; onNavigate(): void; }
const navigation = [
  { label: 'Overview', suffix: '/overview', icon: LayoutDashboard },
  { label: 'AI Assistants', suffix: '/assistants', icon: Bot },
  { label: 'Conversations', suffix: '/conversations', icon: MessagesSquare },
  { label: 'Leads', suffix: '/leads', icon: BadgeDollarSign },
  { label: 'Pipeline', suffix: '/pipeline', icon: KanbanSquare },
  { label: 'Channels', suffix: '/channels', icon: Cable },
  { label: 'Knowledge Base', suffix: '/knowledge-base', icon: BookOpenText },
  { label: 'Team', suffix: '/team', icon: UsersRound },
  { label: 'Settings', suffix: '/settings', icon: Settings },
];
export function workspaceAccessCopy(tenantRole: TenantRole | 'OWNER' | undefined) {
  if (tenantRole === 'OWNER' || tenantRole === 'ADMIN') return { label: 'ADMIN', detail: 'FULL ACCESS' };
  // Subscription data is not currently projected into the authenticated tenant payload.
  // Keep the fallback honest instead of inventing a paid plan.
  return { label: tenantRole === 'AGENT' ? 'TEAM ACCESS' : 'WORKSPACE ACCESS', detail: tenantRole === 'AGENT' ? 'ASSIGNED ROLE' : 'PLAN NOT AVAILABLE' };
}

export function Sidebar({ tenantId, tenantName, tenantRole, email, onLogout, onNavigate }: SidebarProps) {
  const location = useLocation();
  const conversationBase = `/app/${tenantId}/conversations`;
  const conversationRouteActive = location.pathname.startsWith(conversationBase);
  const [conversationsOpen, setConversationsOpen] = useState(conversationRouteActive);
  useEffect(() => { if (conversationRouteActive) setConversationsOpen(true); }, [conversationRouteActive]);
  const isAgent = tenantRole === 'AGENT';
  const access = workspaceAccessCopy(tenantRole);
  return <aside className="flex h-full w-72 flex-col border-r border-white/[0.07] bg-[#0C0C0E] px-4 py-6 text-white">
    <div className="mb-10 px-3"><img src={samcheLogo} alt="SamChe Company LLC" className="h-16 w-40 object-contain object-left" /><p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-gold">AI Platform</p></div>
    <div className="mb-7 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3"><p className="truncate text-sm font-medium" title={tenantName}>{tenantName}</p><p className="mt-1 text-xs text-stone-400">{isAgent ? 'Read-only access' : tenantRole ?? 'Workspace access'}</p></div>
    <nav aria-label="Dashboard navigation" className="space-y-5">
      {[
        { title: 'MAIN', labels: ['Overview'] },
        { title: 'AI SOLUTIONS', labels: ['AI Assistants', 'Channels', 'Knowledge Base'] },
        { title: 'DATA & INSIGHTS', labels: ['Leads', 'Pipeline', 'Team'] },
        { title: 'SETTINGS', labels: ['Settings'] },
      ].map((group) => <section key={group.title}><p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-stone-500">{group.title}</p>{navigation.filter((item) => group.labels.includes(item.label)).map(({ label, suffix, icon: Icon }) => <NavLink key={suffix} to={`/app/${tenantId}${suffix}`} onClick={onNavigate} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><Icon aria-hidden="true" size={18} strokeWidth={1.8} />{label}</NavLink>)}</section>)}
      <section><p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-stone-500">CUSTOMER ENGAGEMENT</p><button type="button" onClick={() => setConversationsOpen((value) => !value)} className={'nav-link w-full justify-between ' + (conversationRouteActive ? 'nav-link-active' : '')}><span className="inline-flex items-center gap-3"><MessagesSquare aria-hidden="true" size={18} strokeWidth={1.8} />Conversations</span><ChevronDown aria-hidden="true" size={16} className={'transition-transform ' + (conversationsOpen ? 'rotate-0' : '-rotate-90')} /></button>{conversationsOpen && <div className="ml-5 mt-1 space-y-1 border-l border-white/10 pl-3">{[
        { label: 'WhatsApp', route: 'whatsapp', icon: MessageCircle },
        { label: 'Web Chatbot', route: 'web-chat', icon: MessageCircle },
        { label: 'AI Guide', route: 'guide', icon: Bot },
      ].map(({ label, route, icon: Icon }) => <NavLink key={route} to={conversationBase + '/' + route} onClick={onNavigate} className={({ isActive }) => 'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ' + (isActive ? 'bg-red-500/15 text-red-100' : 'text-stone-400 hover:bg-white/[0.04] hover:text-white')}><Icon aria-hidden="true" size={15} />{label}</NavLink>)}</div>}</section>
    </nav>
    <div className="mt-auto border-t border-white/10 pt-5"><div className="rounded-lg border border-gold/20 bg-gold/10 px-3 py-3"><p className="text-[10px] font-semibold tracking-[0.16em] text-gold">{access.label}</p><p className="mt-1 text-sm font-semibold text-white">{access.detail}</p></div><p className="mt-4 truncate text-sm font-medium text-stone-300" title={email}>{email}</p><span className="mt-2 inline-flex rounded-md border border-gold/25 bg-gold/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gold">{tenantRole ?? 'Workspace'}</span><button type="button" onClick={onLogout} className="mt-4 w-full rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-stone-400 transition hover:border-signal/30 hover:bg-signal/10 hover:text-white">Sign out</button></div>
  </aside>;
}
