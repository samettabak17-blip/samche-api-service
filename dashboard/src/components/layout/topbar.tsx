import { LogOut, Menu } from 'lucide-react';
import type { Tenant } from '../../types/api';

interface TopbarProps {
  tenants: Tenant[];
  selectedTenantId: string;
  email: string;
  onSelectTenant(tenantId: string): void;
  onOpenNavigation(): void;
  onLogout(): void;
}

export function Topbar({ tenants, selectedTenantId, email, onSelectTenant, onOpenNavigation, onLogout }: TopbarProps) {
  return (
    <header className="flex min-h-20 items-center justify-between border-b border-line bg-canvas px-4 sm:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onOpenNavigation} className="grid h-10 w-10 place-items-center rounded-lg text-stone-600 lg:hidden" aria-label="Open navigation">
          <Menu aria-hidden="true" size={21} />
        </button>
        <div className="min-w-0">
          <p className="eyebrow hidden sm:block">Workspace</p>
          <label className="sr-only" htmlFor="tenant-select">Selected tenant</label>
          <select id="tenant-select" value={selectedTenantId} onChange={(event) => onSelectTenant(event.target.value)} className="max-w-56 truncate bg-transparent text-sm font-semibold text-ink outline-none sm:text-base">
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden max-w-48 truncate text-sm text-stone-500 sm:block" title={email}>{email}</span>
        <button type="button" onClick={onLogout} className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-white text-stone-600 transition hover:border-stone-300 hover:text-ink" aria-label="Sign out">
          <LogOut aria-hidden="true" size={18} />
        </button>
      </div>
    </header>
  );
}

