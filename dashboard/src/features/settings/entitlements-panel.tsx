import { CreditCard, History, Lock, ShieldCheck, Sliders, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DashboardButton,
  DashboardField,
  DashboardFormMessage,
  DashboardInput,
  DashboardSelect,
} from '../../components/ui/dashboard-control';
import { tenantApi } from '../dashboard/dashboard-api';
import type { TenantCapabilityState } from '../../types/api';

function capabilitySourceBadge(source: string) {
  switch (source) {
    case 'PLAN':
      return <span className="inline-flex items-center rounded-md bg-emerald-950/40 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-800/40">Included in Plan</span>;
    case 'OVERRIDE':
      return <span className="inline-flex items-center rounded-md bg-purple-950/40 px-2 py-0.5 text-xs font-semibold text-purple-300 border border-purple-800/40">Super Owner Override (Granted)</span>;
    case 'OVERRIDE_DENIED':
      return <span className="inline-flex items-center rounded-md bg-red-950/40 px-2 py-0.5 text-xs font-semibold text-red-400 border border-red-800/40">Super Owner Override (Denied)</span>;
    case 'CONFIG_PRESERVED':
      return <span className="inline-flex items-center rounded-md bg-sky-950/40 px-2 py-0.5 text-xs font-semibold text-sky-400 border border-sky-800/40">Preserved Configuration</span>;
    case 'LOCKED':
    default:
      return <span className="inline-flex items-center rounded-md bg-stone-900/60 px-2 py-0.5 text-xs font-semibold text-stone-400 border border-stone-700/50">Locked</span>;
  }
}

export function EntitlementsPanel({ tenantId, isPlatformOwner }: { tenantId: string; isPlatformOwner: boolean }) {
  const queryClient = useQueryClient();

  const [editingLimitKey, setEditingLimitKey] = useState<string | null>(null);
  const [limitInputValue, setLimitInputValue] = useState<string>('');
  const [limitStatus, setLimitStatus] = useState('');

  const [overrideModalCap, setOverrideModalCap] = useState<TenantCapabilityState | null>(null);
  const [overrideEffect, setOverrideEffect] = useState<'GRANT' | 'DENY'>('GRANT');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideStatus, setOverrideStatus] = useState('');

  const tenantSubscription = useQuery({
    queryKey: ['tenant', tenantId, 'subscription'],
    queryFn: () => tenantApi.getTenantSubscription(tenantId),
    enabled: Boolean(tenantId),
  });

  const entitlementAudit = useQuery({
    queryKey: ['tenant', tenantId, 'entitlements-audit'],
    queryFn: () => tenantApi.getEntitlementsAuditLog(tenantId),
    enabled: Boolean(tenantId && isPlatformOwner),
  });

  const saveLimitAllocation = useMutation({
    mutationFn: ({ metricKey, limit }: { metricKey: string; limit: number }) =>
      tenantApi.updateUsageAllocation(tenantId, metricKey, limit),
    onSuccess: async () => {
      setLimitStatus('Limit updated.');
      setEditingLimitKey(null);
      await Promise.all([
        tenantSubscription.refetch(),
        entitlementAudit.refetch(),
        queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'subscription'] }),
      ]);
    },
    onError: (error: Error) => setLimitStatus(error.message || 'Limit could not be updated.'),
  });

  const saveOverride = useMutation({
    mutationFn: ({ capabilityKey, effect, reason }: { capabilityKey: string; effect: 'GRANT' | 'DENY'; reason: string }) =>
      tenantApi.grantEntitlementOverride(tenantId, capabilityKey, effect, reason),
    onSuccess: async () => {
      setOverrideStatus('Override saved.');
      setOverrideModalCap(null);
      setOverrideReason('');
      await Promise.all([
        tenantSubscription.refetch(),
        entitlementAudit.refetch(),
        queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'subscription'] }),
      ]);
    },
    onError: (error: Error) => setOverrideStatus(error.message || 'Override could not be saved.'),
  });

  const revokeOverride = useMutation({
    mutationFn: (capabilityKey: string) => tenantApi.revokeEntitlementOverride(tenantId, capabilityKey),
    onSuccess: async () => {
      setOverrideStatus('Override revoked.');
      await Promise.all([
        tenantSubscription.refetch(),
        entitlementAudit.refetch(),
        queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'subscription'] }),
      ]);
    },
    onError: (error: Error) => setOverrideStatus(error.message || 'Override could not be revoked.'),
  });

  const sub = tenantSubscription.data?.subscription;
  if (!sub) return null;

  const capabilities = tenantSubscription.data?.capabilities ? Object.values(tenantSubscription.data.capabilities) : [];
  const limits = tenantSubscription.data?.limits ? Object.values(tenantSubscription.data.limits) : [];
  const lockedCapabilities = tenantSubscription.data?.locked_capabilities ?? [];

  return <section className="panel p-4 sm:p-6 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal">
          <CreditCard aria-hidden="true" size={19} />
        </span>
        <div>
          <h2 className="font-semibold text-ink">Subscription & Entitlements</h2>
          <p className="text-sm text-stone-400">Active plan, billing terms, and server-authoritative entitlements</p>
        </div>
      </div>
      {isPlatformOwner && (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-signal/30 bg-signal/10 px-3 py-1 text-xs font-semibold text-red-200">
          <ShieldCheck size={14} className="text-signal" /> Super Owner Governance
        </span>
      )}
    </div>

    {/* Pricing Cards */}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-line bg-surface-soft p-4">
        <p className="text-xs font-semibold text-stone-400">PLAN</p>
        <p className="mt-1 text-lg font-bold text-ink">{sub.display_name}</p>
        <p className="text-xs text-stone-400">{sub.customer_subtitle}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface-soft p-4">
        <p className="text-xs font-semibold text-stone-400">BILLING CYCLE</p>
        <p className="mt-1 text-lg font-bold text-ink">{sub.billing_cycle}</p>
        <p className="text-xs text-stone-400">{sub.currency} authoritative</p>
      </div>
      <div className="rounded-xl border border-line bg-surface-soft p-4">
        <p className="text-xs font-semibold text-stone-400">SUBSCRIPTION FEE</p>
        <p className="mt-1 text-lg font-bold text-ink">
          {sub.billing_cycle === 'ANNUAL'
            ? `AED ${Number(sub.annual_price_aed).toLocaleString()}/yr`
            : `AED ${Number(sub.monthly_price_aed).toLocaleString()}/mo`}
        </p>
        <p className="text-xs text-stone-400">Setup Fee: AED {Number(sub.setup_fee_aed).toLocaleString()}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface-soft p-4">
        <p className="text-xs font-semibold text-stone-400">STATUS</p>
        <p className="mt-1 text-lg font-bold text-emerald-400">{sub.status}</p>
        <p className="text-xs text-stone-400">Server-Authoritative</p>
      </div>
    </div>

    {/* Limits */}
    {limits.length > 0 && (
      <div className="border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">Usage Allocations & Limits</h3>
            <p className="text-xs text-stone-400">Enforced capacity quotas and live utilization</p>
          </div>
          {limitStatus && (
            <DashboardFormMessage tone={limitStatus === 'Limit updated.' ? 'success' : 'error'}>
              {limitStatus}
            </DashboardFormMessage>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {limits.map((lim) => (
            <div key={lim.metric_key} className="rounded-xl border border-line bg-elevated/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-stone-200">{lim.name}</span>
                <span className="text-xs font-medium text-stone-400 uppercase">{lim.reset_interval}</span>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-xl font-bold text-ink">
                  {lim.current.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-stone-400">
                    / {lim.limit > 0 ? lim.limit.toLocaleString() : 'Unlimited'}
                  </span>
                </span>
                {isPlatformOwner && (
                  <DashboardButton
                    type="button"
                    variant="ghost"
                    className="h-7 text-xs px-2"
                    onClick={() => {
                      setEditingLimitKey(lim.metric_key);
                      setLimitInputValue(String(lim.limit));
                      setLimitStatus('');
                    }}
                  >
                    <Sliders size={12} /> Adjust
                  </DashboardButton>
                )}
              </div>

              {isPlatformOwner && editingLimitKey === lim.metric_key && (
                <div className="mt-3 border-t border-line pt-3 space-y-2">
                  <label className="block text-xs font-semibold text-stone-300">
                    Set quota for {lim.name}:
                    <DashboardInput
                      type="number"
                      min="0"
                      value={limitInputValue}
                      onChange={(e) => setLimitInputValue(e.target.value)}
                      className="h-8 text-xs mt-1"
                    />
                  </label>
                  <div className="flex items-center gap-2">
                    <DashboardButton
                      type="button"
                      variant="primary"
                      className="h-7 text-xs px-2"
                      disabled={saveLimitAllocation.isPending || !limitInputValue}
                      onClick={() =>
                        saveLimitAllocation.mutate({
                          metricKey: lim.metric_key,
                          limit: Number(limitInputValue),
                        })
                      }
                    >
                      Save
                    </DashboardButton>
                    <DashboardButton
                      type="button"
                      variant="secondary"
                      className="h-7 text-xs px-2"
                      onClick={() => setEditingLimitKey(null)}
                    >
                      Cancel
                    </DashboardButton>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )}

    {/* Super Owner Platform Capabilities Matrix & Overrides */}
    {isPlatformOwner && capabilities.length > 0 && (
      <div className="border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">Platform Capabilities & Feature Overrides</h3>
            <p className="text-xs text-stone-400">
              Server-authoritative capabilities with Super Owner grant/deny overrides
            </p>
          </div>
          {overrideStatus && (
            <DashboardFormMessage tone={overrideStatus.includes('saved') || overrideStatus.includes('revoked') ? 'success' : 'error'}>
              {overrideStatus}
            </DashboardFormMessage>
          )}
        </div>

        {overrideModalCap && (
          <div className="mt-4 rounded-xl border border-signal/40 bg-elevated p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Sparkles size={16} className="text-signal" /> Configure Override: {overrideModalCap.name}
              </h4>
              <button
                type="button"
                onClick={() => setOverrideModalCap(null)}
                className="text-stone-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <DashboardField label="Override Effect">
                <DashboardSelect
                  value={overrideEffect}
                  onChange={(e) => setOverrideEffect(e.target.value as 'GRANT' | 'DENY')}
                >
                  <option value="GRANT">GRANT (Unlock for this tenant)</option>
                  <option value="DENY">DENY (Explicitly block for this tenant)</option>
                </DashboardSelect>
              </DashboardField>
              <DashboardField label="Reason / Business Justification">
                <DashboardInput
                  placeholder="e.g., VIP enterprise trial, custom SLA"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              </DashboardField>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <DashboardButton
                type="button"
                variant="primary"
                disabled={saveOverride.isPending}
                onClick={() =>
                  saveOverride.mutate({
                    capabilityKey: overrideModalCap.key,
                    effect: overrideEffect,
                    reason: overrideReason,
                  })
                }
              >
                {saveOverride.isPending ? 'Saving Override…' : 'Apply Override'}
              </DashboardButton>
              <DashboardButton type="button" variant="secondary" onClick={() => setOverrideModalCap(null)}>
                Cancel
              </DashboardButton>
            </div>
          </div>
        )}

        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-soft text-xs text-stone-300">
              <tr>
                <th className="px-4 py-3 font-semibold">Capability</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Min. Plan</th>
                <th className="px-4 py-3 font-semibold">Entitlement Source</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-canvas">
              {capabilities.map((cap) => (
                <tr key={cap.key} className="hover:bg-surface-soft/40 transition">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink flex items-center gap-2">
                      {cap.entitled ? (
                        <ShieldCheck size={15} className="text-emerald-400 shrink-0" />
                      ) : (
                        <Lock size={15} className="text-stone-500 shrink-0" />
                      )}
                      {cap.name}
                    </div>
                    {cap.reason && <p className="text-xs text-stone-400 mt-0.5">{cap.reason}</p>}
                  </td>
                  <td className="px-4 py-3 text-stone-300 text-xs">{cap.category}</td>
                  <td className="px-4 py-3 text-stone-300 text-xs font-medium">{cap.min_plan}</td>
                  <td className="px-4 py-3">{capabilitySourceBadge(cap.source)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {cap.source === 'OVERRIDE' || cap.source === 'OVERRIDE_DENIED' ? (
                        <DashboardButton
                          type="button"
                          variant="destructive"
                          className="h-7 text-xs px-2.5"
                          disabled={revokeOverride.isPending}
                          onClick={() => revokeOverride.mutate(cap.key)}
                        >
                          Revoke Override
                        </DashboardButton>
                      ) : (
                        <DashboardButton
                          type="button"
                          variant="outline"
                          className="h-7 text-xs px-2.5"
                          onClick={() => {
                            setOverrideModalCap(cap);
                            setOverrideEffect(cap.entitled ? 'DENY' : 'GRANT');
                            setOverrideReason('');
                            setOverrideStatus('');
                          }}
                        >
                          Set Override
                        </DashboardButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {/* Available Upgrades */}
    {lockedCapabilities.length > 0 && (
      <div className="border-t border-line pt-6">
        <h3 className="text-base font-semibold text-ink">Available Plan Upgrades</h3>
        <p className="text-xs text-stone-400 mt-0.5">
          Capabilities unlocked by upgrading to higher subscription tiers
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lockedCapabilities.map((l) => (
            <div key={l.key} className="rounded-xl border border-line bg-surface-soft/60 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm text-stone-200 flex items-center gap-1.5">
                  <Lock size={13} className="text-stone-500" /> {l.name}
                </span>
                <span className="rounded bg-signal-soft px-2 py-0.5 text-xs font-bold text-signal">
                  {l.min_plan}+
                </span>
              </div>
              {l.description && <p className="mt-1 text-xs text-stone-400">{l.description}</p>}
            </div>
          ))}
        </div>
      </div>
    )}

    {/* Entitlement Audit History for Super Owner */}
    {isPlatformOwner && (
      <div className="border-t border-line pt-6">
        <div className="flex items-center gap-2">
          <History size={16} className="text-stone-400" />
          <h3 className="text-base font-semibold text-ink">Entitlement Audit History</h3>
        </div>
        <p className="text-xs text-stone-400 mt-0.5">
          Immutable audit trail of plan changes, allocation updates, and Super Owner overrides
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-soft text-xs text-stone-300">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Action</th>
                <th className="px-4 py-2.5 font-semibold">Performed By</th>
                <th className="px-4 py-2.5 font-semibold">Details</th>
                <th className="px-4 py-2.5 font-semibold text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-canvas">
              {(entitlementAudit.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-stone-500">
                    No entitlement changes recorded for this workspace yet.
                  </td>
                </tr>
              ) : (
                (entitlementAudit.data ?? []).slice(0, 15).map((entry) => (
                  <tr key={entry.id} className="hover:bg-surface-soft/40 transition text-xs">
                    <td className="px-4 py-2.5 font-semibold text-ink">{entry.action_type}</td>
                    <td className="px-4 py-2.5 text-stone-300">{entry.performed_by_email || 'System / Owner'}</td>
                    <td className="px-4 py-2.5 text-stone-300">
                      {JSON.stringify(entry.details).replace(/[{}"]/g, ' ')}
                    </td>
                    <td className="px-4 py-2.5 text-stone-400 text-right">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    )}
  </section>;
}
