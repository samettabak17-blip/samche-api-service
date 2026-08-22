import {
  Bot,
  BookOpenText,
  Cable,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  UsersRound,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import samcheLogo from '../../assets/branding/samche-company-llc-logo.png';
import type { TenantRole } from '../../types/api';

interface SidebarProps {
  tenantId: string;
  tenantName: string;
  tenantRole: TenantRole | 'OWNER' | undefined;
  onNavigate(): void;
}

const navigation = [
  { label: 'Overview', suffix: '/overview', icon: LayoutDashboard },
  { label: 'AI Assistants', suffix: '/assistants', icon: Bot },
  { label: 'Conversations', suffix: '/conversations', icon: MessagesSquare },
  { label: 'Channels', suffix: '/channels', icon: Cable },
  { label: 'Knowledge Base', suffix: '/knowledge-base', icon: BookOpenText },
  { label: 'Team', suffix: '/team', icon: UsersRound },
  { label: 'Settings', suffix: '/settings', icon: Settings },
];

export function Sidebar({ tenantId, tenantName, tenantRole, onNavigate }: SidebarProps) {
  const isAgent = tenantRole === 'AGENT';

  return (
    <aside className="flex h-full w-72 flex-col bg-ink px-4 py-5 text-white">
      <div className="mb-10 px-3">
        <img src={samcheLogo} alt="SamChe Company LLC" className="h-16 w-40 object-contain object-left" />
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-gold">AI Platform</p>
      </div>

      <div className="mb-7 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
        <p className="truncate text-sm font-medium" title={tenantName}>{tenantName}</p>
        <p className="mt-1 text-xs text-stone-400">{isAgent ? 'Read-only access' : tenantRole ?? 'Workspace access'}</p>
      </div>

      <nav aria-label="Dashboard navigation" className="space-y-1">
        {navigation.map(({ label, suffix, icon: Icon }) => (
          <NavLink
            key={suffix}
            to={`/app/${tenantId}${suffix}`}
            onClick={onNavigate}
            className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto rounded-xl border border-white/10 px-3 py-3 text-xs leading-5 text-stone-400">
        {isAgent ? 'You can review your workspace. Management actions are available to tenant admins.' : 'Your workspace data is isolated to this tenant.'}
      </div>
    </aside>
  );
}