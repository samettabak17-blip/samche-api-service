import { useRef } from 'react';
import { Modal } from './modal';

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
  return <Modal open={open} title={title} onClose={onCancel} initialFocusRef={cancelRef} closeOnEscape={!isPending} className="max-w-md">
      <p className="eyebrow">Confirmation required</p>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button ref={cancelRef} type="button" className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60" onClick={onCancel} disabled={isPending}>Cancel</button>
        <button type="button" className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60" onClick={onConfirm} disabled={isPending}>{isPending ? 'Working…' : confirmLabel}</button>
      </div>
    </Modal>;
}

