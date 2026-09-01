import { CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { DashboardPasswordInput } from '../../components/ui/dashboard-control';
import { onboardingApi, type InvitationValidation } from '../dashboard/dashboard-api';
import samcheLogo from '../../assets/branding/samche-company-llc-logo.png';

type InvitationView = 'loading' | 'valid' | 'invalid' | 'expired' | 'used' | 'revoked' | 'error' | 'success';

function invitationView(status: string): InvitationView {
  switch (status.toUpperCase()) {
    case 'VALID': return 'valid';
    case 'EXPIRED': return 'expired';
    case 'USED':
    case 'CONSUMED': return 'used';
    case 'REVOKED': return 'revoked';
    default: return 'invalid';
  }
}

function statusCopy(view: Exclude<InvitationView, 'loading' | 'valid' | 'success'>): { title: string; detail: string } {
  return {
    invalid: { title: 'This invitation is not available', detail: 'The invitation link is invalid or no longer available.' },
    expired: { title: 'This invitation has expired', detail: 'Ask your SamChe workspace owner to send a new invitation.' },
    used: { title: 'This invitation has already been used', detail: 'Sign in with your existing account, or ask your workspace owner for help.' },
    revoked: { title: 'This invitation was revoked', detail: 'Ask your SamChe workspace owner to send a new invitation.' },
    error: { title: 'We could not verify this invitation', detail: 'Please try again in a moment. If the problem continues, contact your workspace owner.' },
  }[view];
}

export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState(() => searchParams.get('token')?.trim() ?? '');
  const [view, setView] = useState<InvitationView>('loading');
  const [invitation, setInvitation] = useState<InvitationValidation | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    if (!token) { setView('invalid'); return; }
    let active = true;
    void onboardingApi.validateInvitation(token).then((result) => {
      if (!active) return;
      setInvitation(result);
      setView(invitationView(result.status));
    }).catch(() => { if (active) setView('error'); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (view !== 'success') return;
    const timeout = window.setTimeout(() => navigate('/login', { replace: true }), 1800);
    return () => window.clearTimeout(timeout);
  }, [navigate, view]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8 || password.length > 256) { setError('Password must be between 8 and 256 characters.'); return; }
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      await onboardingApi.acceptInvitation({ token, password, confirm_password: confirmation });
      setPassword('');
      setConfirmation('');
      setView('success');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 410) setView('used');
      else setError(reason instanceof ApiError ? reason.message : 'We could not set up your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (view === 'loading') return <PageFrame><p className="text-sm text-stone-300">Checking your invitation…</p></PageFrame>;
  if (view === 'success') return <PageFrame><CheckCircle2 className="text-emerald-300" size={34} /><h1 className="mt-5 text-3xl font-semibold text-white">Your account is ready.</h1><p className="mt-3 text-sm leading-6 text-stone-300">Taking you to secure sign in…</p></PageFrame>;
  if (view !== 'valid') {
    const copy = statusCopy(view);
    return <PageFrame><ShieldCheck className="text-signal" size={34} /><h1 className="mt-5 text-3xl font-semibold text-white">{copy.title}</h1><p className="mt-3 text-sm leading-6 text-stone-300">{copy.detail}</p><button type="button" onClick={() => navigate('/login')} className="mt-7 rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Go to sign in</button></PageFrame>;
  }

  return <PageFrame>
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-signal">SamChe workspace</p>
    <h1 className="mt-4 text-3xl font-semibold text-white">Set up your account</h1>
    <p className="mt-3 text-sm leading-6 text-stone-300">{invitation?.company_name ? <>You were invited to join <span className="font-semibold text-white">{invitation.company_name}</span>.</> : 'Choose a password to finish joining your workspace.'}</p>
    {invitation?.email && <p className="mt-2 text-sm text-stone-400">{invitation.email}</p>}
    <form className="mt-7 space-y-5" onSubmit={submit} noValidate>
      <label className="auth-label block">Password<DashboardPasswordInput aria-label="Password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className="auth-label block">Confirm password<DashboardPasswordInput aria-label="Confirm password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {error && <p role="alert" className="rounded-xl border border-red-400/35 bg-red-950/35 px-3.5 py-3 text-sm text-red-100">{error}</p>}
      <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-signal px-4 py-3.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(212,33,41,0.22)] transition hover:bg-[#B81920] disabled:cursor-not-allowed disabled:opacity-60"><LockKeyhole aria-hidden="true" size={17} />{submitting ? 'Setting up…' : 'Set up account'}</button>
    </form>
  </PageFrame>;
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-[#0B0B0D] px-5 py-8 text-white"><section className="auth-surface w-full max-w-md rounded-2xl p-6 sm:p-8"><img src={samcheLogo} alt="SamChe Company LLC" className="mx-auto mb-5 h-24 w-60 object-contain object-center" />{children}</section></main>;
}
