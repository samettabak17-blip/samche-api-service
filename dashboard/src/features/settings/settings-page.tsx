import { Building2, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EmptyState } from '../../components/ui/async-state';
import { DashboardButton, DashboardFormMessage, DashboardInput, DashboardPasswordInput } from '../../components/ui/dashboard-control';
import { useAuth } from '../auth/auth-context';
import { onboardingApi } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';

function DetailRow({ label, value }: { label: string; value: string | undefined }) {
  return <div className="flex items-center justify-between gap-4 border-b border-line py-4 last:border-b-0"><dt className="dashboard-field-label text-sm">{label}</dt><dd className="text-right text-sm font-medium text-ink">{value || 'Not available'}</dd></div>;
}

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [changing, setChanging] = useState(false);
  const { user } = useAuth();
  const { selectedTenant, tenantRole } = useTenant();
  if (!user || !selectedTenant) return <EmptyState title="No tenant selected" description="Choose a tenant to view account and workspace information." />;
  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setChanging(true); setPasswordStatus('');
    try { await onboardingApi.changePassword({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword }); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordStatus('Password updated.'); }
    catch { setPasswordStatus('Password could not be changed.'); } finally { setChanging(false); }
  };
  return <div className="space-y-5"><section><p className="eyebrow">Workspace information</p><h1 className="page-title mt-2">Settings</h1></section><div className="grid gap-5 xl:grid-cols-2"><section className="panel p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal"><UserRound aria-hidden="true" size={19} /></span><div><h2 className="font-semibold text-ink">Account</h2><p className="text-sm text-stone-500">Authenticated account information</p></div></div><dl className="mt-6"><DetailRow label="Email" value={user.email} /><DetailRow label="System role" value={user.system_role} /></dl></section><section className="panel p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal"><Building2 aria-hidden="true" size={19} /></span><div><h2 className="font-semibold text-ink">Selected tenant</h2></div></div><dl className="mt-6"><DetailRow label="Name" value={selectedTenant.name} /><DetailRow label="Status" value={selectedTenant.status} /><DetailRow label="Tenant role" value={user.system_role === 'OWNER' ? 'OWNER' : tenantRole} /></dl></section></div><section className="panel max-w-xl p-6"><h2 className="font-semibold text-ink">Security</h2><p className="mt-1 text-sm text-stone-500">Change password</p><form onSubmit={changePassword} className="mt-5 space-y-3"><label className="auth-label block">Current password<DashboardPasswordInput aria-label="Current password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Current password" /></label><label className="auth-label block">New password<DashboardPasswordInput aria-label="New password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password" /></label><label className="auth-label block">Confirm new password<DashboardPasswordInput aria-label="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm new password" /></label><DashboardButton variant="primary" type="submit" disabled={changing}>{changing ? 'Updating…' : 'Change password'}</DashboardButton>{passwordStatus && <DashboardFormMessage tone={passwordStatus === 'Password updated.' ? 'success' : 'error'}>{passwordStatus}</DashboardFormMessage>}</form></section></div>;
}
