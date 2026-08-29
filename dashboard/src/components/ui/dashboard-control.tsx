import type { ButtonHTMLAttributes, ReactNode } from 'react';
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
