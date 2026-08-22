import { useEffect, useRef } from 'react';

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel(): void;
  onConfirm(): void;
  isPending?: boolean;
}

export function ConfirmationDialog({ open, title, description, confirmLabel, onCancel, onConfirm, isPending = false }: ConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (open && event.key === 'Escape' && !isPending) onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPending, onCancel, open]);

  if (!open) return null;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="confirmation-title" className="panel w-full max-w-md p-6 shadow-2xl">
      <p className="eyebrow">Confirmation required</p>
      <h2 id="confirmation-title" className="mt-2 text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button ref={cancelRef} type="button" className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60" onClick={onCancel} disabled={isPending}>Cancel</button>
        <button type="button" className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60" onClick={onConfirm} disabled={isPending}>{isPending ? 'Working…' : confirmLabel}</button>
      </div>
    </section>
  </div>;
}

