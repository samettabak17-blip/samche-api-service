import { Activity, ArrowRight, Bot, BookOpenText, Cable, Eye, EyeOff, KanbanSquare, LockKeyhole, Mail, ShieldCheck, Zap } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import samcheLogo from '../../assets/branding/samche-company-llc-logo.png';
import { ApiError } from '../../lib/api-client';
import { useAuth } from './auth-context';
import { onboardingApi } from '../dashboard/dashboard-api';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, status } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

  return (
    <main className="min-h-screen bg-[#0B0B0D] text-white lg:grid lg:grid-cols-[1.28fr_0.92fr]">
      <section className="relative isolate hidden overflow-hidden border-r border-white/10 px-10 py-9 lg:flex lg:min-h-screen lg:flex-col xl:px-16 xl:py-12">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_78%_48%,rgba(212,33,41,0.24),transparent_24%),radial-gradient(circle_at_78%_48%,rgba(200,155,69,0.1),transparent_42%),linear-gradient(135deg,#09090A_0%,#101012_60%,#160D0E_100%)]" />
        <div aria-hidden="true" className="absolute -right-56 top-[-32rem] -z-10 h-[58rem] w-[58rem] rounded-full border border-signal/60 shadow-[0_0_72px_rgba(212,33,41,0.24)]" />
        <div aria-hidden="true" className="absolute right-[18%] top-[28%] -z-10 h-72 w-72 rounded-full border border-signal/30 bg-[radial-gradient(circle,rgba(212,33,41,0.22),transparent_58%)] shadow-[0_0_80px_rgba(212,33,41,0.22)]" />
        <div aria-hidden="true" className="absolute bottom-36 right-[18%] -z-10 h-52 w-52 rounded-full border border-gold/30 bg-[radial-gradient(circle,rgba(200,155,69,0.15),transparent_62%)]" />

        <div className="flex items-center justify-center"><img src={samcheLogo} alt="SamChe Company LLC" className="mx-auto h-36 w-80 object-contain object-center" /></div>

        <div className="mx-auto my-auto max-w-xl py-12 text-center xl:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-signal">SamChe AI Platform</p>
          <div className="mt-6 space-y-1 text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl xl:text-7xl">
            <h1>AI OPERATIONS.</h1>
            <h1>SMARTER.</h1>
            <h1 className="text-signal">STRONGER.</h1>
          </div>
          <div className="mx-auto mt-10 h-px w-16 bg-signal" />
          <p className="mt-8 max-w-md text-base leading-7 text-stone-300 xl:text-lg">Manage your AI assistants, channels, knowledge and conversations from a single, powerful command center.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3 2xl:grid-cols-6">
          <FeatureCard icon={Bot} title="AI Assistants" description="Create and manage intelligent assistants" />
          <FeatureCard icon={BookOpenText} title="Knowledge Intelligence" description="Turn approved knowledge into useful answers" />
          <FeatureCard icon={Cable} title="Omnichannel" description="Connect conversations across every channel" />
          <FeatureCard icon={KanbanSquare} title="CRM & Pipeline" description="Move leads and deals forward with clarity" />
          <FeatureCard icon={Zap} title="Automation / Agentic" description="Automate work with capable AI agents" />
          <FeatureCard icon={Activity} title="Analytics" description="Turn conversations into clear decisions" />
        </div>
        <p className="mt-8 text-xs text-stone-500">© {new Date().getFullYear()} SamChe Company LLC. All rights reserved.</p>
      </section>

      <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.07),transparent_35%),linear-gradient(145deg,#18181A,#101012)]" />
        <div className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-[#161618]/90 p-6 shadow-[0_22px_70px_rgba(0,0,0,0.36)] backdrop-blur sm:p-8 xl:p-9">
          <div className="mb-9 text-center lg:hidden"><img src={samcheLogo} alt="SamChe Company LLC" className="mx-auto h-24 w-60 object-contain object-center" /><p className="mt-3 text-xs font-semibold uppercase tracking-[0.22em] text-gold">AI Platform</p></div>
          <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-signal"><span className="grid h-9 w-9 place-items-center rounded-lg bg-signal/15 text-signal"><LockKeyhole aria-hidden="true" size={17} /></span>Secure sign in</p>
          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">Welcome back</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-stone-300 sm:text-base">Use your SamChe account to access the tenants assigned to you.</p>
          <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
            <label className="dashboard-field-label block text-sm font-semibold">Email
              <span className="relative mt-2 block"><Mail aria-hidden="true" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-500" /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="block w-full rounded-xl border border-white/20 bg-black/15 py-3.5 pl-11 pr-4 text-white shadow-sm outline-none transition placeholder:text-stone-500 focus:border-signal" placeholder="Enter your email" /></span>
            </label>
            <label className="dashboard-field-label block text-sm font-semibold">Password
              <span className="relative mt-2 block"><LockKeyhole aria-hidden="true" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone-500" /><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className="block w-full rounded-xl border border-white/20 bg-black/15 py-3.5 pl-11 pr-12 text-white shadow-sm outline-none transition placeholder:text-stone-500 focus:border-signal" placeholder="Enter your password" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-stone-400 transition hover:bg-white/10 hover:text-white">{showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}</button></span>
            </label>
            <label className="flex items-center gap-2.5 text-sm text-stone-300"><input type="checkbox" className="h-4 w-4 rounded border-white/25 bg-black/20 text-signal accent-signal" />Remember me</label>
            <button type="button" onClick={() => { setForgotOpen(true); setForgotStatus(''); }} className="text-sm text-stone-300 underline decoration-signal underline-offset-4 hover:text-white">Forgot password?</button>
            {error && <p role="alert" className="rounded-xl border border-red-400/35 bg-red-950/35 px-3.5 py-3 text-sm text-red-100">{error}</p>}
            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-signal px-4 py-3.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(212,33,41,0.22)] transition hover:bg-[#B81920] disabled:cursor-not-allowed disabled:opacity-60"><LockKeyhole aria-hidden="true" size={17} />{submitting ? 'Signing in…' : 'Sign in'}<ArrowRight aria-hidden="true" size={18} /></button>
          </form>
          {forgotOpen && <form onSubmit={async (event) => { event.preventDefault(); await onboardingApi.requestPasswordReset(email); setForgotStatus('If an active account matches this email, a reset link will be sent.'); }} className="mt-5 rounded-xl border border-white/10 bg-black/10 p-4"><label className="block text-sm text-stone-200">Email<input aria-label="Reset email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-white/20 bg-black/20 px-3 py-2.5 text-white" /></label><div className="mt-3 flex gap-3"><button className="rounded-xl bg-signal px-3 py-2 text-sm font-semibold">Send reset link</button><button type="button" onClick={() => setForgotOpen(false)} className="text-sm text-stone-300">Cancel</button></div>{forgotStatus && <p role="status" className="mt-3 text-sm text-stone-300">{forgotStatus}</p>}</form>}
          <div className="mt-9 border-t border-white/10 pt-6"><p className="text-center text-sm text-stone-400">Secure access to your workspace</p><p className="mt-5 flex gap-3 text-sm leading-6 text-stone-300"><ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-signal" size={19} />Your security is our priority. All connections are encrypted and your data is never shared.</p></div>
        </div>
      </section>
    </main>
  );
}

function FeatureCard({ icon: Icon, title, description }: { icon: typeof Bot; title: string; description: string }) {
  return <article className="rounded-xl border border-white/15 bg-black/15 p-4 backdrop-blur-sm"><Icon aria-hidden="true" className="text-signal" size={23} strokeWidth={1.8} /><h2 className="mt-6 text-sm font-semibold text-white">{title}</h2><p className="mt-2 text-xs leading-5 text-stone-400">{description}</p></article>;
}
