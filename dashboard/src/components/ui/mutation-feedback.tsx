import { ApiError } from '../../lib/api-client';

export function MutationFeedback({ error, success }: { error?: unknown; success?: string }) {
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : undefined;
  if (!message && !success) return null;
  return <div aria-live="polite" className={`rounded-xl border px-4 py-3 text-sm ${message ? 'border-red-200 bg-red-50 text-red-800' : 'border-gold/40 bg-gold/10 text-ink'}`}>
    {message ?? success}
  </div>;
}