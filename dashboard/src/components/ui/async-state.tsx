import type { ReactNode } from 'react';
import { AlertCircle, FileQuestion, LockKeyhole, RefreshCw } from 'lucide-react';
import { ApiError } from '../../lib/api-client';

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-busy="true" aria-label="Loading" className={`animate-pulse rounded-xl bg-stone-200 ${className}`} />;
}

export function EmptyState({ title, description, icon }: { title: string; description: string; icon?: ReactNode }) {
  return <section className="panel grid min-h-56 place-items-center p-8 text-center"><div><div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-signal-soft text-signal">{icon ?? <FileQuestion aria-hidden="true" size={21} />}</div><h2 className="text-base font-semibold text-ink">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-stone-600">{description}</p></div></section>;
}

export function QueryErrorState({ error, onRetry, resource = 'workspace data' }: { error: unknown; onRetry: () => void; resource?: string }) {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status === 403) return <EmptyState title="Access restricted" description="You do not have permission to view this tenant resource." icon={<LockKeyhole aria-hidden="true" size={21} />} />;
  if (status === 404) return <EmptyState title="Not found" description="This tenant resource is unavailable or no longer exists." />;
  return <section className="panel flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><AlertCircle aria-hidden="true" className="mt-0.5 shrink-0 text-red-600" size={20} /><div><h2 className="font-semibold text-ink">Unable to load {resource}</h2><p className="mt-1 text-sm text-stone-600">{error instanceof Error ? error.message : 'Please try again.'}</p></div></div><button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:border-stone-300"><RefreshCw aria-hidden="true" size={15} />Retry</button></section>;
}

