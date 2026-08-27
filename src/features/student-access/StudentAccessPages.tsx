import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';

const client = createBrowserApiClient();

type StudentAccess = {
  studentId: string;
  workspaceId: string;
  languageChoice: 'en-US' | 'es-US' | 'pt-BR' | 'fr-CA' | 'ht-HT';
  activeClassMemberships: { classId: string; name: string }[];
};

const languageChoices = [
  { value: 'en-US', label: 'English' },
  { value: 'es-US', label: 'Español' },
  { value: 'pt-BR', label: 'Português' },
  { value: 'fr-CA', label: 'Français' },
  { value: 'ht-HT', label: 'Kreyòl Ayisyen' },
] as const;

export function InvitationRedemptionPage() {
  const navigate = useNavigate();
  const [recipient, setRecipient] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { response } = await client.POST(
        '/api/v1/auth/student/invitations/redeem',
        { body: { recipient, code } },
      );
      if (response.status !== 200) {
        setError(
          'That email address and Invitation Code could not be accepted. Check both and try again.',
        );
        return;
      }
      navigate('/student');
    } catch {
      setError('Invitation redemption is temporarily unavailable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full bg-[#f3ecd9] px-5 py-12 text-[#17332d] sm:py-20">
      <section className="mx-auto max-w-lg overflow-hidden border border-[#17332d] bg-[#fffaf0] shadow-[10px_10px_0_#d86045]">
        <div className="border-b border-[#17332d] bg-[#17332d] px-7 py-4 text-[#fffaf0]">
          <p className="text-xs font-black uppercase tracking-[0.28em]">
            Preventive care literacy
          </p>
        </div>
        <div className="p-7 sm:p-10">
          <p className="font-mono text-sm font-bold text-[#b43c2c]">
            STEP 01 / JOIN
          </p>
          <h1 className="mt-3 text-4xl font-black leading-none tracking-tight sm:text-5xl">
            Join your class.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-[#38544d]">
            Enter the email address where your invitation arrived and the
            six-digit code from that message.
          </p>

          <form className="mt-8 space-y-6" onSubmit={submit}>
            <label className="block text-sm font-black uppercase tracking-wide">
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                className="mt-2 w-full border-2 border-[#17332d] bg-white px-4 py-3 text-base font-medium outline-none focus:shadow-[4px_4px_0_#e6af2e]"
              />
            </label>
            <label className="block text-sm font-black uppercase tracking-wide">
              Invitation Code
              <input
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ''))
                }
                className="mt-2 w-full border-2 border-[#17332d] bg-white px-4 py-3 font-mono text-2xl font-black tracking-[0.3em] outline-none focus:shadow-[4px_4px_0_#e6af2e]"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide shadow-[4px_4px_0_#17332d] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy ? 'Checking code...' : 'Join class'}
            </button>
          </form>

          {error ? (
            <p
              role="alert"
              className="mt-6 border-l-4 border-[#b43c2c] bg-[#f9ded5] p-4 text-sm font-bold leading-6"
            >
              {error}
            </p>
          ) : null}

          <p className="mt-8 text-sm font-bold text-[#49645c]">
            Already joined a class?{' '}
            <Link className="underline" to="/student/sign-in">
              Sign in with a Sign-In Code
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

export function StudentSignInPage() {
  const navigate = useNavigate();
  const [recipient, setRecipient] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'request' | 'verify'>();

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setBusy('request');
    setError(undefined);
    setNotice(undefined);
    try {
      const { response } = await client.POST('/api/v1/auth/student/sign-in', {
        body: { recipient },
      });
      if (response.status !== 200) {
        setError('Sign-in is temporarily unavailable. Try again.');
        return;
      }
      setNotice(
        'If that mailbox has school access, a Sign-In Code is on the way. It expires in 10 minutes.',
      );
    } catch {
      setError('Sign-in is temporarily unavailable. Try again.');
    } finally {
      setBusy(undefined);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy('verify');
    setError(undefined);
    try {
      const { response } = await client.POST(
        '/api/v1/auth/student/sign-in/verify',
        { body: { recipient, code } },
      );
      if (response.status !== 200) {
        setError(
          'That email address and Sign-In Code could not be accepted. Check both and try again.',
        );
        return;
      }
      navigate('/student');
    } catch {
      setError('Sign-in is temporarily unavailable. Try again.');
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <main className="min-h-full bg-[#f3ecd9] px-5 py-12 text-[#17332d] sm:py-20">
      <section className="mx-auto max-w-lg overflow-hidden border border-[#17332d] bg-[#fffaf0] shadow-[10px_10px_0_#d86045]">
        <div className="border-b border-[#17332d] bg-[#17332d] px-7 py-4 text-[#fffaf0]">
          <p className="text-xs font-black uppercase tracking-[0.28em]">
            Preventive care literacy
          </p>
        </div>
        <div className="p-7 sm:p-10">
          <p className="font-mono text-sm font-bold text-[#b43c2c]">
            RETURNING STUDENT
          </p>
          <h1 className="mt-3 text-4xl font-black leading-none tracking-tight sm:text-5xl">
            Sign in to restore your school access.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-[#38544d]">
            Use a Sign-In Code sent to your current school email. An Invitation
            Code only joins a class and cannot restore this browser.
          </p>

          <form className="mt-8 space-y-6" onSubmit={requestCode}>
            <label className="block text-sm font-black uppercase tracking-wide">
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                className="mt-2 w-full border-2 border-[#17332d] bg-white px-4 py-3 text-base font-medium outline-none focus:shadow-[4px_4px_0_#e6af2e]"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== undefined}
              className="w-full border-2 border-[#17332d] bg-white px-5 py-3 font-black uppercase tracking-wide shadow-[4px_4px_0_#17332d] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy === 'request' ? 'Sending code...' : 'Email a Sign-In Code'}
            </button>
          </form>

          <form className="mt-8 space-y-6" onSubmit={verify}>
            <label className="block text-sm font-black uppercase tracking-wide">
              Sign-In Code
              <input
                type="text"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ''))
                }
                className="mt-2 w-full border-2 border-[#17332d] bg-white px-4 py-3 font-mono text-2xl font-black tracking-[0.3em] outline-none focus:shadow-[4px_4px_0_#e6af2e]"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== undefined}
              className="w-full border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide shadow-[4px_4px_0_#17332d] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy === 'verify' ? 'Checking code...' : 'Sign in'}
            </button>
          </form>

          {notice ? (
            <p className="mt-6 border-l-4 border-[#17332d] bg-[#eef4ef] p-4 text-sm font-bold leading-6">
              {notice}
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-6 border-l-4 border-[#b43c2c] bg-[#f9ded5] p-4 text-sm font-bold leading-6"
            >
              {error}
            </p>
          ) : null}

          <p className="mt-8 text-sm font-bold text-[#49645c]">
            Joining a class for the first time?{' '}
            <Link className="underline" to="/student/invitation">
              Enter an Invitation Code
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

export function StudentHomePage() {
  const [access, setAccess] = useState<StudentAccess>();
  const [learningUnlocked, setLearningUnlocked] = useState<boolean>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void client
      .GET('/api/v1/student/session')
      .then(async ({ data, response }) => {
        if (!active) return;
        if (response.status !== 200 || !data) {
          setUnavailable(true);
          return;
        }
        setAccess(data);
        if (data.activeClassMemberships.length === 0) {
          setLearningUnlocked(false);
          return;
        }
        const intake = await client.GET('/api/v1/student/intake', {
          params: { query: { locale: data.languageChoice } },
        });
        if (!active) return;
        if (intake.response.status === 200 && intake.data) {
          setLearningUnlocked(intake.data.learningUnlocked);
        } else {
          setLearningUnlocked(false);
        }
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveLanguage(languageChoice: StudentAccess['languageChoice']) {
    if (!access) return;
    const previous = access.languageChoice;
    setAccess({ ...access, languageChoice });
    const saved = await client.PUT('/api/v1/student/language', {
      body: { languageChoice },
    });
    if (saved.response.status !== 200 || !saved.data) {
      setAccess({ ...access, languageChoice: previous });
    }
  }

  const hasClassAccess = (access?.activeClassMemberships.length ?? 0) > 0;

  return (
    <main className="min-h-full bg-[#17332d] px-5 py-12 text-[#fffaf0] sm:py-20">
      <section className="mx-auto max-w-3xl">
        <p className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-[#e6af2e]">
          Student access
        </p>
        <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">
          Your learning space
        </h1>

        {!access && !unavailable ? (
          <p className="mt-10 text-lg text-[#c8d7ce]">
            Restoring your school access...
          </p>
        ) : null}

        {unavailable ? (
          <div className="mt-10 border border-[#fffaf0] bg-[#24473f] p-7">
            <h2 className="text-2xl font-black">
              Your session is not available.
            </h2>
            <p className="mt-3 leading-7 text-[#c8d7ce]">
              Sign in with a Sign-In Code to restore this browser from your
              school record. Use an Invitation Code only when joining a class.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/student/sign-in"
                className="inline-block bg-[#e6af2e] px-5 py-3 font-black text-[#17332d]"
              >
                Sign in
              </Link>
              <Link
                to="/student/invitation"
                className="inline-block border border-[#fffaf0] px-5 py-3 font-black"
              >
                Enter an Invitation Code
              </Link>
            </div>
          </div>
        ) : null}

        {access ? (
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <label className="border border-[#fffaf0] bg-[#fffaf0] p-6 text-[#17332d] shadow-[6px_6px_0_#d86045]">
              <p className="font-mono text-xs font-bold text-[#b43c2c]">
                LANGUAGE
              </p>
              <h2 className="mt-3 text-2xl font-black">Saved language</h2>
              <select
                value={access.languageChoice}
                onChange={(event) =>
                  void saveLanguage(
                    event.target.value as StudentAccess['languageChoice'],
                  )
                }
                className="mt-5 w-full border-2 border-[#17332d] bg-white px-3 py-2 text-sm font-bold"
              >
                {languageChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            {!hasClassAccess ? (
              <article className="border border-[#fffaf0] bg-[#fffaf0] p-6 text-[#17332d] shadow-[6px_6px_0_#d86045]">
                <p className="font-mono text-xs font-bold text-[#b43c2c]">
                  ACCESS
                </p>
                <h2 className="mt-3 text-2xl font-black">
                  No Class access is active
                </h2>
                <p className="mt-5 text-sm font-bold text-[#49645c]">
                  You are signed in, but intake and learning stay closed until
                  a Class Membership is active. Your school records remain.
                </p>
              </article>
            ) : null}
            {hasClassAccess ? (
              <article className="border border-[#fffaf0] bg-[#fffaf0] p-6 text-[#17332d] shadow-[6px_6px_0_#d86045]">
                <p className="font-mono text-xs font-bold text-[#b43c2c]">
                  INTAKE
                </p>
                <h2 className="mt-3 text-2xl font-black">
                  {learningUnlocked
                    ? 'Intake Record Version accepted'
                    : 'Complete your intake'}
                </h2>
                <p className="mt-5 text-sm font-bold text-[#49645c]">
                  {learningUnlocked
                    ? 'Learning unlocked after server confirmation'
                    : 'Answers stay private until the school confirms your submission'}
                </p>
                {learningUnlocked ? (
                  <Link
                    id="update-intake"
                    to="/student/intake"
                    className="mt-6 inline-block bg-[#e6af2e] px-5 py-3 font-black text-[#17332d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Update intake
                  </Link>
                ) : (
                  <Link
                    id="open-intake"
                    to="/student/intake"
                    className="mt-6 inline-block bg-[#e6af2e] px-5 py-3 font-black text-[#17332d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Open intake
                  </Link>
                )}
              </article>
            ) : null}
            {hasClassAccess && learningUnlocked ? (
              <article className="border border-[#fffaf0] bg-[#fffaf0] p-6 text-[#17332d] shadow-[6px_6px_0_#d86045]">
                <p className="font-mono text-xs font-bold text-[#b43c2c]">
                  LEARNING
                </p>
                <h2 className="mt-3 text-2xl font-black">
                  Continue your Learning Modules
                </h2>
                <p className="mt-5 text-sm font-bold text-[#49645c]">
                  Learning Progress for Knowledge, Skills, and Application is
                  confirmed by the school
                </p>
                <Link
                  id="open-learning"
                  to="/student/learning"
                  className="mt-6 inline-block bg-[#e6af2e] px-5 py-3 font-black text-[#17332d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  Open learning
                </Link>
              </article>
            ) : null}
            {access.activeClassMemberships.map((membership, index) => (
              <article
                key={membership.classId}
                className="border border-[#fffaf0] bg-[#fffaf0] p-6 text-[#17332d] shadow-[6px_6px_0_#d86045]"
              >
                <p className="font-mono text-xs font-bold text-[#b43c2c]">
                  CLASS {String(index + 1).padStart(2, '0')}
                </p>
                <h2 className="mt-3 text-2xl font-black">{membership.name}</h2>
                <p className="mt-5 text-sm font-bold text-[#49645c]">
                  Access restored from your school record
                </p>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
