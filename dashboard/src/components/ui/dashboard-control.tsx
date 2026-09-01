import { forwardRef, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ChangeEvent, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'selected' | 'ghost' | 'outline';

const base = 'inline-flex h-10 min-h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:border-stone-700 disabled:bg-stone-900 disabled:text-stone-400 disabled:shadow-none disabled:hover:border-stone-700 disabled:hover:bg-stone-900 disabled:hover:text-stone-400';
const variants: Record<ButtonVariant, string> = {
  primary: 'border-signal bg-signal text-white shadow-signal hover:bg-red-700 hover:shadow-lg',
  secondary: 'border-line bg-elevated text-stone-300 hover:border-stone-400 hover:bg-stone-800 hover:text-white',
  destructive: 'border-red-500/60 bg-red-950/30 text-red-200 hover:border-red-400 hover:bg-red-900/50 hover:text-white',
  selected: 'border-signal bg-signal text-white shadow-signal hover:border-signal hover:bg-signal hover:text-white hover:shadow-signal',
  ghost: 'border-transparent bg-transparent text-stone-300 hover:border-line hover:bg-white/[.06] hover:text-white',
  outline: 'border-line bg-transparent text-stone-200 hover:border-stone-400 hover:bg-white/[.05] hover:text-white',
};

export const dashboardButtonClass = (variant: ButtonVariant = 'secondary') => `${base} ${variants[variant]}`;

export function DashboardButton({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`${dashboardButtonClass(variant)} ${className}`} {...props} />;
}

const fieldClass = 'dashboard-input mt-2 block h-11 w-full rounded-xl border border-line bg-elevated px-3 text-sm text-ink outline-none transition placeholder:text-stone-400 focus:border-signal focus:ring-2 focus:ring-signal/30 disabled:cursor-not-allowed disabled:border-line disabled:bg-canvas disabled:text-stone-400 disabled:placeholder:text-stone-500';

export function DashboardField({ label, helper, error, children }: { label: ReactNode; helper?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return <div className="space-y-1.5"><label className="dashboard-field-label block text-sm font-semibold">{label}{children}</label>{helper && !error && <p className="dashboard-helper text-xs">{helper}</p>}{error && <DashboardFormMessage tone="error">{error}</DashboardFormMessage>}</div>;
}

export const DashboardInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function DashboardInput({ className = '', ...props }, ref) {
  return <input ref={ref} className={`${fieldClass} ${className}`} {...props} />;
});

export function DashboardSelect({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldClass} dashboard-select`} {...props} />;
}

export function DashboardTextarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-28 resize-y py-3 ${className}`} {...props} />;
}

export function DashboardPasswordInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const inputId = useId();
  return <span className="relative block"><input {...props} id={props.id ?? inputId} type={visible ? 'text' : 'password'} className={`${fieldClass} pr-12 ${className}`} /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible((value) => !value)} className="absolute right-2 top-2 grid h-7 w-9 place-items-center rounded-lg text-stone-500 hover:bg-white/10 hover:text-ink focus-visible:ring-2 focus-visible:ring-signal">{visible ? 'Hide' : 'Show'}</button></span>;
}

export function DashboardFormMessage({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const classes = tone === 'success' ? 'dashboard-success border-emerald-400/40 bg-emerald-950/30 text-emerald-100' : tone === 'info' ? 'dashboard-info border-sky-400/40 bg-sky-950/30 text-sky-100' : 'dashboard-error border-red-400/45 bg-red-950/35 text-red-100';
  return <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2.5 text-sm ${classes}`}>{children}</p>;
}

export function DashboardTab({ to, active = false, disabled = false, children }: { to: string; active?: boolean; disabled?: boolean; children: ReactNode }) {
  const className = `${base} ${active ? variants.selected : variants.secondary}`;
  if (disabled) return <span aria-disabled="true" className={`${base} cursor-not-allowed border-stone-700 bg-stone-900 text-stone-500 shadow-none`}>{children}</span>;
  return <Link to={to} aria-current={active ? 'page' : undefined} className={className}>{children}</Link>;
}

export function DashboardCheckbox({ label, className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return <label className="inline-flex cursor-pointer items-start gap-3 text-sm text-stone-200 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-stone-400">
    <input type="checkbox" className={`mt-0.5 h-5 w-5 shrink-0 appearance-none rounded-md border border-stone-600 bg-[#0b1624] transition checked:border-signal checked:bg-signal checked:bg-[linear-gradient(135deg,transparent_42%,white_42%,white_52%,transparent_52%),linear-gradient(45deg,transparent_53%,white_53%,white_63%,transparent_63%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:border-stone-700 disabled:bg-stone-900 ${className}`} {...props} />
    <span>{label}</span>
  </label>;
}

type DashboardFileInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  className?: string;
  chooseLabel?: string;
  emptyLabel?: string;
  selectedFileName?: string | null;
  formatHint?: string;
  error?: string | null;
};

export function DashboardFileInput({ className = '', chooseLabel = 'Choose File', emptyLabel = 'No file selected', selectedFileName, formatHint, error, disabled, onChange, id, ...props }: DashboardFileInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalFileName, setInternalFileName] = useState<string | null>(null);
  const visibleFileName = selectedFileName === undefined ? internalFileName : selectedFileName;
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setInternalFileName(event.target.files?.[0]?.name ?? null);
    onChange?.(event);
  };

  return <div className={`space-y-2 ${className}`}>
    <input ref={inputRef} id={inputId} type="file" disabled={disabled} onChange={handleChange} className="sr-only" {...props} />
    <div className={`flex min-h-11 flex-wrap items-center gap-3 rounded-xl border bg-[#0b1624] p-2 ${error ? 'border-red-500/60' : 'border-line'} ${disabled ? 'text-stone-600' : ''}`}>
      <DashboardButton type="button" variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>{chooseLabel}</DashboardButton>
      <span className={`min-w-0 flex-1 truncate text-sm ${visibleFileName ? 'text-stone-200' : 'text-stone-500'}`}>{visibleFileName || emptyLabel}</span>
    </div>
    {formatHint && <p className="text-xs text-stone-500">{formatHint}</p>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}
