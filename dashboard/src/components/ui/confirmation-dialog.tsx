import { useRef } from 'react';
import { Modal } from './modal';

import { DashboardButton } from './dashboard-control';

export type ConfirmationDialogVariant = 'primary' | 'secondary' | 'destructive';

export interface ConfirmationDialogProps {
  confirmVariant?: ConfirmationDialogVariant;
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel(): void;
  onConfirm(): void;
  isPending?: boolean;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'destructive',
  onCancel,
  onConfirm,
  isPending = false,
}: ConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return <Modal open={open} title={title} onClose={onCancel} initialFocusRef={cancelRef} closeOnEscape={!isPending} className="max-w-md">
      <p className="eyebrow">Confirmation required</p>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button ref={cancelRef} type="button" className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-stone-300 hover:bg-[#16283a] hover:text-white disabled:opacity-60" onClick={onCancel} disabled={isPending}>Cancel</button>
        <DashboardButton type="button" variant={confirmVariant} onClick={onConfirm} disabled={isPending}>{isPending ? 'Working…' : confirmLabel}</DashboardButton>
      </div>
    </Modal>;
}

