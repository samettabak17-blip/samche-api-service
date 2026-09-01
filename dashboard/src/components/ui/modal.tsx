import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose(): void;
  initialFocusRef?: RefObject<HTMLElement>;
  closeOnEscape?: boolean;
  className?: string;
}

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared portal dialog for dashboard mutations and onboarding flows. */
export function Modal({ open, title, children, onClose, initialFocusRef, closeOnEscape = true, className = '' }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    initialFocusRef?.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      openerRef.current?.focus();
    };
  }, [closeOnEscape, initialFocusRef, onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 p-4" role="presentation">
      <button type="button" tabIndex={-1} aria-label="Close dialog" className="absolute inset-0 cursor-default" onClick={onClose} />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={'relative z-10 max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-2xl border border-white/[.14] bg-[#09121f] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,.6)] sm:p-6 ' + className}>
        <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
        {children}
      </section>
    </div>,
    document.body,
  );
}
