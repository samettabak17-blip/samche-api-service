import { ArrowRight, LockKeyhole, ShieldCheck, UserRoundCheck } from 'lucide-react';
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
          <div className="auth-badge"><LockKeyhole aria-hidden="true" size={13} className="text-red-500" /><span>SECURE SIGN IN</span></div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">Welcome back</h1>
          <p className="mt-1.5 text-sm text-stone-400">Sign in to access your SamChe AI Platform workspace.</p>
          <form className="mt-7 space-y-4" onSubmit={submit} noValidate>
            <DashboardField label="Email"><DashboardInput type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="admin@samchecompany.com" aria-label="Email" /></DashboardField>
            <DashboardField label="Password"><DashboardPasswordInput autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="••••••••••••" aria-label="Password" /></DashboardField>
            <div className="flex items-center justify-between pt-0.5 text-xs"><label className="flex items-center gap-2 text-stone-300 cursor-pointer select-none"><input type="checkbox" className="h-4 w-4 rounded border-white/20 bg-black/40 text-red-600 accent-red-600" />Remember me</label><button type="button" onClick={() => { setForgotOpen(true); setForgotStatus(''); }} className="text-[#f59e0b] hover:text-amber-400 font-medium transition">Forgot password?</button></div>

            {error && <p role="alert" className="rounded-xl border border-red-400/35 bg-red-950/35 px-3.5 py-3 text-sm text-red-100">{error}</p>}
            <DashboardButton type="submit" variant="primary" disabled={submitting} className="auth-button-primary mt-6 text-sm"><LockKeyhole aria-hidden="true" size={15} /><span>{submitting ? 'Signing in…' : 'Sign in'}</span><ArrowRight aria-hidden="true" size={16} /></DashboardButton>
          </form>
          {forgotOpen && <form onSubmit={async (event) => { event.preventDefault(); await onboardingApi.requestPasswordReset(email); setForgotStatus('If an active account matches this email, a reset link will be sent.'); }} className="mt-5 rounded-xl border border-white/10 bg-black/10 p-4"><DashboardField label="Email"><DashboardInput aria-label="Reset email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></DashboardField><div className="mt-3 flex gap-3"><DashboardButton type="submit" variant="primary">Send reset link</DashboardButton><DashboardButton type="button" variant="ghost" onClick={() => setForgotOpen(false)}>Cancel</DashboardButton></div>{forgotStatus && <p role="status" className="mt-3 text-sm text-stone-300">{forgotStatus}</p>}</form>}
          <div className="auth-assurance-row"><p>Secure and trusted</p><div><span className="auth-assurance-item"><ShieldCheck aria-hidden="true" size={15} className="text-stone-400" />Secure access</span><span className="auth-assurance-item"><LockKeyhole aria-hidden="true" size={15} className="text-stone-400" />Protected credentials</span><span className="auth-assurance-item"><UserRoundCheck aria-hidden="true" size={15} className="text-stone-400" />Role-based workspace</span></div></div>
        </AuthVisualLayout>;
}
