import { useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ChangeEvent, InputHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'selected';

const base = 'inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:border-stone-700 disabled:bg-stone-900 disabled:text-stone-500 disabled:shadow-none disabled:hover:border-stone-700 disabled:hover:bg-stone-900 disabled:hover:text-stone-500';
const variants: Record<ButtonVariant, string> = {
  primary: 'border-signal bg-signal text-white shadow-signal hover:bg-red-700 hover:shadow-lg',
  secondary: 'border-line bg-elevated text-stone-300 hover:border-stone-400 hover:bg-stone-800 hover:text-white',
  destructive: 'border-red-500/60 bg-red-950/30 text-red-200 hover:border-red-400 hover:bg-red-900/50 hover:text-white',
  selected: 'border-signal bg-signal text-white shadow-signal hover:border-signal hover:bg-signal hover:text-white hover:shadow-signal',
};

export const dashboardButtonClass = (variant: ButtonVariant = 'secondary') => `${base} ${variants[variant]}`;

export function DashboardButton({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={`${dashboardButtonClass(variant)} ${className}`} {...props} />;
}

export function DashboardTab({ to, active = false, disabled = false, children }: { to: string; active?: boolean; disabled?: boolean; children: ReactNode }) {
  const className = `${base} ${active ? variants.selected : variants.secondary}`;
  if (disabled) return <span aria-disabled="true" className={`${base} cursor-not-allowed border-stone-700 bg-stone-900 text-stone-500 shadow-none`}>{children}</span>;
  return <Link to={to} aria-current={active ? 'page' : undefined} className={className}>{children}</Link>;
}

export function DashboardCheckbox({ label, className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return <label className="inline-flex cursor-pointer items-start gap-3 text-sm text-stone-200 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-stone-500">
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
