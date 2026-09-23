import { Building2, CreditCard, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../../components/ui/async-state';
import { DashboardButton, DashboardField, DashboardFormMessage, DashboardPasswordInput, DashboardSelect } from '../../components/ui/dashboard-control';
import { useAuth } from '../auth/auth-context';
import { onboardingApi, tenantApi } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';
import { PushNotificationControl } from './push-notification-control';

type PlanCode = 'STARTER' | 'GROWTH' | 'BUSINESS' | 'ENTERPRISE';

function DetailRow({ label, value }: { label: string; value: string | undefined }) {
  return <div className="flex items-center justify-between gap-4 border-b border-line py-4 last:border-b-0"><dt className="dashboard-field-label text-sm">{label}</dt><dd className="text-right text-sm font-medium text-ink">{value || 'Not available'}</dd></div>;
}

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState('');
  const [changing, setChanging] = useState(false);
  const [selectedPlanCode, setSelectedPlanCode] = useState<PlanCode | ''>('');
  const [planStatus, setPlanStatus] = useState('');
  const { user } = useAuth();
  const { selectedTenant, tenantRole } = useTenant();
  const queryClient = useQueryClient();
  const isPlatformOwner = user?.system_role === 'OWNER';
  const tenantPlan = useQuery({ queryKey: ['tenant', selectedTenant?.id, 'plan'], queryFn: () => tenantApi.getTenantPlan(selectedTenant!.id), enabled: Boolean(selectedTenant?.id && isPlatformOwner) });
  const planCatalog = useQuery({ queryKey: ['platform-plans'], queryFn: () => tenantApi.listPlans(), enabled: isPlatformOwner });
  const tenantSubscription = useQuery({ queryKey: ['tenant', selectedTenant?.id, 'subscription'], queryFn: () => tenantApi.getTenantSubscription(selectedTenant!.id), enabled: Boolean(selectedTenant?.id) });

  useEffect(() => {
    setSelectedPlanCode((tenantPlan.data?.plan_code ?? '') as PlanCode | '');
    setPlanStatus('');
  }, [selectedTenant?.id, tenantPlan.data?.plan_code]);

  const savePlan = useMutation({
    mutationFn: () => tenantApi.changeTenantPlanAsOwner(selectedTenant!.id, selectedPlanCode as PlanCode),
    onSuccess: async () => {
      setPlanStatus('Plan saved.');
      await Promise.all([
        tenantPlan.refetch(),
        queryClient.invalidateQueries({ queryKey: ['tenants'] }),
        queryClient.invalidateQueries({ queryKey: ['tenant', selectedTenant!.id, 'plan'] }),
      ]);
    },
    onError: (error: Error) => setPlanStatus(error.message || 'Plan could not be saved.'),
  });

  if (!user || !selectedTenant) return <EmptyState title="No tenant selected" description="Choose a tenant to view account and workspace information." />;

  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setChanging(true); setPasswordStatus('');
    try { await onboardingApi.changePassword({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword }); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordStatus('Password updated.'); }
    catch { setPasswordStatus('Password could not be changed.'); } finally { setChanging(false); }
  };
  const planChanged = Boolean(selectedPlanCode && selectedPlanCode !== tenantPlan.data?.plan_code);

  return <div className="space-y-5">
    <section><p className="eyebrow">Workspace information</p><h1 className="page-title mt-2">Settings</h1></section>
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="panel p-4 sm:p-6"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal"><UserRound aria-hidden="true" size={19} /></span><div><h2 className="font-semibold text-ink">Account</h2><p className="text-sm text-stone-500">Authenticated account information</p></div></div><dl className="mt-6"><DetailRow label="Email" value={user.email} /><DetailRow label="System role" value={user.system_role} /></dl></section>
      <section className="panel p-4 sm:p-6">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal"><Building2 aria-hidden="true" size={19} /></span><div><h2 className="font-semibold text-ink">Selected tenant</h2></div></div>
        <dl className="mt-6"><DetailRow label="Name" value={selectedTenant.name} /><DetailRow label="Status" value={selectedTenant.status} /><DetailRow label="Tenant role" value={user.system_role === 'OWNER' ? 'OWNER' : tenantRole} />{isPlatformOwner && <DetailRow label="Current plan" value={tenantPlan.data?.display_name ?? (tenantPlan.isLoading ? 'Loading…' : undefined)} />}</dl>
        {isPlatformOwner && <div className="mt-5 space-y-3 border-t border-line pt-5"><DashboardField label="Manage plan"><DashboardSelect aria-label="Manage plan" value={selectedPlanCode} onChange={(event) => setSelectedPlanCode(event.target.value as PlanCode)} disabled={tenantPlan.isLoading || planCatalog.isLoading || Boolean(tenantPlan.data?.pending_request)}>{(planCatalog.data ?? []).map((plan) => <option key={plan.code} value={plan.code}>{plan.display_name}</option>)}</DashboardSelect></DashboardField>{tenantPlan.data?.pending_request && <DashboardFormMessage tone="info">This tenant has a pending upgrade request. Resolve it before changing this tenant plan.</DashboardFormMessage>}<DashboardButton type="button" variant="primary" onClick={() => savePlan.mutate()} disabled={!planChanged || savePlan.isPending || Boolean(tenantPlan.data?.pending_request)}>{savePlan.isPending ? 'Saving plan…' : 'Save plan'}</DashboardButton>{planStatus && <DashboardFormMessage tone={planStatus === 'Plan saved.' ? 'success' : 'error'}>{planStatus}</DashboardFormMessage>}</div>}
      </section>
    </div>
    {tenantSubscription.data?.subscription && (
      <section className="panel p-4 sm:p-6">
        <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal"><CreditCard aria-hidden="true" size={19} /></span><div><h2 className="font-semibold text-ink">Subscription & Entitlements</h2><p className="text-sm text-stone-500">Active plan, billing terms and platform capabilities</p></div></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface-soft p-4"><p className="text-xs font-semibold text-stone-500">PLAN</p><p className="mt-1 text-base font-bold text-ink">{tenantSubscription.data.subscription.display_name}</p><p className="text-xs text-stone-500">{tenantSubscription.data.subscription.customer_subtitle}</p></div>
          <div className="rounded-xl border border-line bg-surface-soft p-4"><p className="text-xs font-semibold text-stone-500">BILLING CYCLE</p><p className="mt-1 text-base font-bold text-ink">{tenantSubscription.data.subscription.billing_cycle || 'MONTHLY'}</p><p className="text-xs text-stone-500">{tenantSubscription.data.subscription.billing_cycle === 'ANNUAL' ? '15% Annual Discount' : 'Standard Monthly'}</p></div>
          <div className="rounded-xl border border-line bg-surface-soft p-4"><p className="text-xs font-semibold text-stone-500">SUBSCRIPTION FEE</p><p className="mt-1 text-base font-bold text-ink">{tenantSubscription.data.subscription.billing_cycle === 'ANNUAL' ? `AED ${Number(tenantSubscription.data.subscription.annual_price_aed).toLocaleString()}/yr` : `AED ${Number(tenantSubscription.data.subscription.monthly_price_aed).toLocaleString()}/mo`}</p><p className="text-xs text-stone-500">Setup Fee: AED {Number(tenantSubscription.data.subscription.setup_fee_aed).toLocaleString()}</p></div>
          <div className="rounded-xl border border-line bg-surface-soft p-4"><p className="text-xs font-semibold text-stone-500">STATUS</p><p className="mt-1 text-base font-bold text-emerald-600">{tenantSubscription.data.subscription.status}</p><p className="text-xs text-stone-500">Server-Authoritative</p></div>
        </div>
        {tenantSubscription.data.limits && Object.keys(tenantSubscription.data.limits).length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Usage Allocations & Limits</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.values(tenantSubscription.data.limits).map((lim) => (
                <div key={lim.metric_key} className="flex items-center justify-between rounded-lg border border-line p-3 text-sm">
                  <span className="text-stone-600">{lim.name}</span>
                  <span className="font-semibold text-ink">{lim.limit > 0 ? `${lim.current} / ${lim.limit.toLocaleString()}` : `${lim.current}`}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tenantSubscription.data.locked_capabilities && tenantSubscription.data.locked_capabilities.length > 0 && (
          <div className="mt-6 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-stone-700">Available Upgrades</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {tenantSubscription.data.locked_capabilities.slice(0, 6).map((l) => (
                <span key={l.key} className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
                  <ShieldCheck size={12} className="text-stone-400" /> {l.name} <span className="font-medium text-signal">({l.min_plan}+)</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    )}

    <PushNotificationControl tenantId={selectedTenant.id} />
    <section className="panel max-w-xl p-4 sm:p-6"><h2 className="font-semibold text-ink">Security</h2><p className="mt-1 text-sm text-stone-500">Change password</p><form onSubmit={changePassword} className="mt-5 space-y-3"><label className="auth-label block">Current password<DashboardPasswordInput aria-label="Current password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Current password" /></label><label className="auth-label block">New password<DashboardPasswordInput aria-label="New password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password" /></label><label className="auth-label block">Confirm new password<DashboardPasswordInput aria-label="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="New password" /></label><DashboardButton variant="primary" type="submit" disabled={changing}>{changing ? 'Updating…' : 'Change password'}</DashboardButton>{passwordStatus && <DashboardFormMessage tone={passwordStatus === 'Password updated.' ? 'success' : 'error'}>{passwordStatus}</DashboardFormMessage>}</form></section>
  </div>;
}
