import { useQuery } from '@tanstack/react-query';
import { UsersRound } from 'lucide-react';
import { EmptyState, QueryErrorState, SkeletonBlock } from '../../components/ui/async-state';
import { formatDate } from '../../lib/format';
import type { TeamMember } from '../../types/api';
import { tenantApi, tenantKeys } from '../dashboard/dashboard-api';
import { useTenant } from '../tenants/tenant-context';

export function TeamTable({ members }: { members: TeamMember[] }) {
  if (members.length === 0) return <EmptyState title="No team members" description="No tenant members are currently available." icon={<UsersRound aria-hidden="true" size={21} />} />;
  return <div className="panel overflow-x-auto"><table className="min-w-full text-left"><thead className="border-b border-line bg-stone-50 text-xs font-semibold uppercase tracking-wide text-stone-500"><tr><th className="px-5 py-3.5">Email</th><th className="px-5 py-3.5">Tenant role</th><th className="px-5 py-3.5">System role</th><th className="px-5 py-3.5">Joined</th></tr></thead><tbody className="divide-y divide-line">{members.map((member) => <tr key={member.id} className="text-sm"><td className="px-5 py-4 font-medium text-ink">{member.email}</td><td className="px-5 py-4"><span className="rounded-full bg-signal-soft px-2.5 py-1 text-xs font-semibold text-signal">{member.tenant_role}</span></td><td className="px-5 py-4 text-stone-700">{member.system_role}</td><td className="px-5 py-4 text-stone-600">{formatDate(member.created_at)}</td></tr>)}</tbody></table></div>;
}

export function TeamPage() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id ?? '';
  const teamQuery = useQuery({ queryKey: tenantKeys.team(tenantId), queryFn: () => tenantApi.listTeam(tenantId), enabled: Boolean(tenantId) });
  if (!tenantId) return <EmptyState title="No tenant selected" description="Choose a tenant to view its team." />;
  if (teamQuery.isLoading) return <div className="space-y-5"><SkeletonBlock className="h-16 w-72" /><SkeletonBlock className="h-80" /></div>;
  if (teamQuery.isError) return <QueryErrorState error={teamQuery.error} onRetry={() => void teamQuery.refetch()} resource="team members" />;
  return <div className="space-y-5"><section><p className="eyebrow">Tenant directory</p><h1 className="page-title mt-2">Team</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">Members and roles in the selected tenant. User management remains in the owner workflow.</p></section><TeamTable members={teamQuery.data ?? []} /></div>;
}

