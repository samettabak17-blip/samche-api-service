import { Building2, ShieldCheck, UserRound } from 'lucide-react';
import { EmptyState } from '../../components/ui/async-state';
import { useAuth } from '../auth/auth-context';
import { useTenant } from '../tenants/tenant-context';

function DetailRow({ label, value }: { label: string; value: string | undefined }) {
  return <div className="flex items-center justify-between gap-4 border-b border-line py-4 last:border-b-0"><dt className="text-sm text-stone-600">{label}</dt><dd className="text-right text-sm font-medium text-ink">{value || 'Not available'}</dd></div>;
}

export function SettingsPage() {
  const { user } = useAuth();
  const { selectedTenant, tenantRole } = useTenant();
  if (!user || !selectedTenant) return <EmptyState title="No tenant selected" description="Choose a tenant to view account and workspace information." />;
  return <div className="space-y-5"><section><p className="eyebrow">Workspace information</p><h1 className="page-title mt-2">Settings</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">These details come from your authenticated account and selected tenant. No unsupported settings are shown.</p></section><div className="grid gap-5 xl:grid-cols-2"><section className="panel p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal"><UserRound aria-hidden="true" size={19} /></span><div><h2 className="font-semibold text-ink">Account</h2><p className="text-sm text-stone-500">Authenticated account information</p></div></div><dl className="mt-6"><DetailRow label="Email" value={user.email} /><DetailRow label="System role" value={user.system_role} /></dl></section><section className="panel p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal"><Building2 aria-hidden="true" size={19} /></span><div><h2 className="font-semibold text-ink">Selected tenant</h2><p className="text-sm text-stone-500">Current workspace context</p></div></div><dl className="mt-6"><DetailRow label="Name" value={selectedTenant.name} /><DetailRow label="Status" value={selectedTenant.status} /><DetailRow label="Tenant role" value={user.system_role === 'OWNER' ? 'OWNER' : tenantRole} /></dl></section></div><section className="panel flex gap-3 p-5"><ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-signal" size={20} /><p className="text-sm leading-6 text-stone-600">Changes are not shown because the current backend contract does not provide a tenant or account settings update endpoint.</p></section></div>;
}

