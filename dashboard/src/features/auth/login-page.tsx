import { ArrowRight, LockKeyhole } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { useAuth } from './auth-context';
import { onboardingApi } from '../dashboard/dashboard-api';
import { AuthVisualLayout } from './auth-visual-layout';
import { DashboardButton, DashboardField, DashboardInput, DashboardPasswordInput } from '../../components/ui/dashboard-control';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, status } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStatus, setForgotStatus] = useState('');

  if (status === 'authenticated') return <Navigate to="/app" replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
      navigate('/app', { replace: true });
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return <AuthVisualLayout>
          <p className="eyebrow flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-signal/15 text-signal"><LockKeyhole aria-hidden="true" size={17} /></span>Secure sign in</p>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">Welcome back</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-stone-300 sm:text-base">Sign in to access your SamChe AI Platform workspace.</p>
          <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
            <DashboardField label="Email"><DashboardInput type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" aria-label="Email" /></DashboardField>
            <DashboardField label="Password"><DashboardPasswordInput autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Enter your password" aria-label="Password" /></DashboardField>
            <label className="flex items-center gap-2.5 text-sm text-stone-300"><input type="checkbox" className="h-4 w-4 rounded border-white/25 bg-black/20 text-signal accent-signal" />Remember me</label>
            <button type="button" onClick={() => { setForgotOpen(true); setForgotStatus(''); }} className="text-sm text-gold underline decoration-signal underline-offset-4 hover:text-white">Forgot password?</button>
            {error && <p role="alert" className="rounded-xl border border-red-400/35 bg-red-950/35 px-3.5 py-3 text-sm text-red-100">{error}</p>}
            <DashboardButton type="submit" variant="primary" disabled={submitting} className="h-12 w-full text-base"><LockKeyhole aria-hidden="true" size={17} />{submitting ? 'Signing in…' : 'Sign in'}<ArrowRight aria-hidden="true" size={18} /></DashboardButton>
          </form>
          {forgotOpen && <form onSubmit={async (event) => { event.preventDefault(); await onboardingApi.requestPasswordReset(email); setForgotStatus('If an active account matches this email, a reset link will be sent.'); }} className="mt-5 rounded-xl border border-white/10 bg-black/10 p-4"><DashboardField label="Email"><DashboardInput aria-label="Reset email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></DashboardField><div className="mt-3 flex gap-3"><DashboardButton type="submit" variant="primary">Send reset link</DashboardButton><DashboardButton type="button" variant="ghost" onClick={() => setForgotOpen(false)}>Cancel</DashboardButton></div>{forgotStatus && <p role="status" className="mt-3 text-sm text-stone-300">{forgotStatus}</p>}</form>}
          <div className="mt-9 border-t border-white/10 pt-6"><p className="text-center text-sm text-stone-300">Secure and trusted access</p></div>
        </AuthVisualLayout>;
}
