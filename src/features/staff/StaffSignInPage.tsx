import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';

const client = createBrowserApiClient();

type Challenge = {
  flowHandle: string;
  stage: 'enroll' | 'totp';
  otpauthUri?: string;
};

export function StaffSignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<Challenge | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { data, response } = await client.POST(
        '/api/v1/auth/staff/sign-in',
        { body: { email, password } },
      );
      if (response.status !== 200 || !data) {
        setError('Sign-in failed. Check your email address and password.');
        return;
      }
      setChallenge({
        flowHandle: data.flowHandle,
        stage: data.stage,
        otpauthUri: data.otpauthUri,
      });
    } catch {
      setError('Sign-in is temporarily unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(undefined);
    try {
      const { response } = await client.POST('/api/v1/auth/staff/totp', {
        body: { flowHandle: challenge.flowHandle, code },
      });
      if (response.status !== 200) {
        setError('That authenticator code was not accepted. Try again.');
        return;
      }
      navigate('/staff');
    } catch {
      setError('Verification is temporarily unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full bg-slate-950 px-6 py-20 text-slate-100">
      <section className="mx-auto max-w-md border-l-4 border-sky-400 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-sky-300">
          School staff
        </p>
        <h1 className="mt-4 text-3xl font-black tracking-tight">Sign in</h1>

        {!challenge ? (
          <form className="mt-6 space-y-5" onSubmit={submitCredentials}>
            <label className="block text-sm font-bold text-slate-300">
              Work email address
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              />
            </label>
            <label className="block text-sm font-bold text-slate-300">
              Password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-sky-400 px-4 py-2 font-black text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50"
            >
              Continue
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-5" onSubmit={submitCode}>
            {challenge.stage === 'enroll' && challenge.otpauthUri ? (
              <div className="rounded border border-amber-400 bg-slate-950 p-4">
                <p className="text-sm font-bold text-amber-300">
                  First sign-in: add this account to your authenticator app,
                  then enter the 6-digit code it shows.
                </p>
                <p className="mt-2 break-all font-mono text-xs text-slate-400">
                  {challenge.otpauthUri}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-300">
                Enter the 6-digit code from your authenticator app.
              </p>
            )}
            <label className="block text-sm font-bold text-slate-300">
              Authenticator code
              <input
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-sky-400 px-4 py-2 font-black text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 disabled:opacity-50"
            >
              Verify and sign in
            </button>
          </form>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-sm font-bold text-rose-300">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
