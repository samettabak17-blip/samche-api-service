import { ArrowRight, LockKeyhole } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { useAuth } from './auth-context';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, status } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-signal font-bold">S</div><span className="font-semibold">SamChe AI Platform</span></div>
        <div className="max-w-lg"><p className="eyebrow text-emerald-300">Tenant workspace</p><h1 className="mt-4 text-5xl font-semibold leading-tight tracking-tight">A clearer command center for your AI operations.</h1><p className="mt-6 max-w-md text-base leading-7 text-stone-400">Manage assistants, channels, knowledge and conversations inside your own secure tenant workspace.</p></div>
        <p className="text-sm text-stone-500">Built for focused customer operations.</p>
      </section>
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden"><div className="mb-6 grid h-10 w-10 place-items-center rounded-xl bg-ink font-bold text-white">S</div><p className="eyebrow">SamChe AI Platform</p></div>
          <p className="eyebrow">Secure sign in</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Welcome back</h1><p className="mt-3 text-sm leading-6 text-stone-500">Use your SamChe account to access the tenants assigned to you.</p>
          <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
            <label className="block text-sm font-medium text-stone-700">Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-2 block w-full rounded-xl border border-line bg-white px-3.5 py-3 text-ink shadow-sm outline-none transition focus:border-signal" /></label>
            <label className="block text-sm font-medium text-stone-700">Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className="mt-2 block w-full rounded-xl border border-line bg-white px-3.5 py-3 text-ink shadow-sm outline-none transition focus:border-signal" /></label>
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">{error}</p>}
            <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"><LockKeyhole aria-hidden="true" size={16} />{submitting ? 'Signing in…' : 'Sign in'}<ArrowRight aria-hidden="true" size={16} /></button>
          </form>
        </div>
      </section>
    </main>
  );
}

