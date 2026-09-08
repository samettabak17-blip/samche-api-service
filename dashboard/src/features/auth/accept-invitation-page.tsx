import { ArrowRight, CheckCircle2, LockKeyhole, Mail, ShieldCheck, Users } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { DashboardField, DashboardInput, DashboardPasswordInput } from '../../components/ui/dashboard-control';
import { onboardingApi, type InvitationValidation } from '../dashboard/dashboard-api';
import { AuthVisualLayout } from './auth-visual-layout';
import { DashboardButton } from '../../components/ui/dashboard-control';

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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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
    return <PageFrame><ShieldCheck className="text-signal" size={34} /><h1 className="mt-5 text-3xl font-semibold text-white">{copy.title}</h1><p className="mt-3 text-sm leading-6 text-stone-300">{copy.detail}</p><DashboardButton type="button" variant="secondary" className="mt-7" onClick={() => navigate('/login')}>Go to sign in</DashboardButton></PageFrame>;
  }

  return <PageFrame>
    <div className="auth-badge"><LockKeyhole aria-hidden="true" size={13} className="text-red-500" /><span>CUSTOMER INVITATION</span></div>
    <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">Set up your account</h1>
    <p className="mt-1.5 text-sm text-stone-400">{invitation?.company_name ? <>You were invited to join <span className="font-semibold text-[#f59e0b]">{invitation.company_name}</span>.</> : 'Choose a password to finish joining your workspace.'}</p>
    {invitation?.email && (
      <div className="mx-auto my-3 flex items-center justify-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-stone-200 w-fit">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-500/25 text-[#f59e0b]"><Mail aria-hidden="true" size={12} /></span>
        <span className="font-semibold text-white">{invitation.email}</span>
      </div>
    )}
    <form className="mt-5 space-y-3.5" onSubmit={submit} noValidate>
      <DashboardField label="First name"><DashboardInput aria-label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Enter your first name" /></DashboardField>
      <DashboardField label="Last name"><DashboardInput aria-label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Enter your last name" /></DashboardField>
      <DashboardField label="Password"><DashboardPasswordInput aria-label="Password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required placeholder="Create a strong password" /></DashboardField>
      <DashboardField label="Confirm password"><DashboardPasswordInput aria-label="Confirm password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required placeholder="Confirm your password" /></DashboardField>
      {error && <p role="alert" className="rounded-xl border border-red-400/35 bg-red-950/35 px-3.5 py-3 text-sm text-red-100">{error}</p>}
      <DashboardButton type="submit" variant="primary" disabled={submitting} className="auth-button-primary w-full mt-6 text-sm"><span>{submitting ? 'Setting up…' : 'Set up account'}</span><ArrowRight aria-hidden="true" size={16} /></DashboardButton>
      <DashboardButton type="button" variant="ghost" className="w-full" onClick={() => navigate('/login')}>Back to sign in</DashboardButton>
    </form>
    <div className="auth-invitation-assurance"><span><ShieldCheck aria-hidden="true" size={14} className="text-[#f59e0b]" />Secure invitation link</span><span><LockKeyhole aria-hidden="true" size={14} className="text-[#f59e0b]" />Encrypted access</span><span><Users aria-hidden="true" size={14} className="text-[#f59e0b]" />Role-based workspace access</span></div>
  </PageFrame>;
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return <AuthVisualLayout heroEyebrow="SAMCHE AI PLATFORM" heroHeading="Join your workspace." heroDescription="You’re one step away from a smarter way to work. Set up your account securely and get access to your SamChe AI Platform and your workspace." capabilityCount={6} showCardLogo>{children}</AuthVisualLayout>;
}
