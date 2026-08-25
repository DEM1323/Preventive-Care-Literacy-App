import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';

const client = createBrowserApiClient();

type StudentAccess = {
  studentId: string;
  workspaceId: string;
  activeClassMemberships: { classId: string; name: string }[];
};

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
        const intake = await client.GET('/api/v1/student/intake', {
          params: { query: { locale: 'en-US' } },
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
              Use a current Invitation Code to authenticate in this browser.
            </p>
            <Link
              to="/student/invitation"
              className="mt-6 inline-block bg-[#e6af2e] px-5 py-3 font-black text-[#17332d]"
            >
              Enter an Invitation Code
            </Link>
          </div>
        ) : null}

        {access ? (
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
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
              {learningUnlocked ? null : (
                <Link
                  to="/student/intake"
                  className="mt-6 inline-block bg-[#e6af2e] px-5 py-3 font-black text-[#17332d]"
                >
                  Open intake
                </Link>
              )}
            </article>
            {learningUnlocked ? (
              <article className="border border-[#fffaf0] bg-[#fffaf0] p-6 text-[#17332d] shadow-[6px_6px_0_#d86045]">
                <p className="font-mono text-xs font-bold text-[#b43c2c]">
                  LEARNING
                </p>
                <h2 className="mt-3 text-2xl font-black">
                  Review one Learning Module item
                </h2>
                <p className="mt-5 text-sm font-bold text-[#49645c]">
                  Completed appears only after the school confirms it
                </p>
                <Link
                  to="/student/learning"
                  className="mt-6 inline-block bg-[#e6af2e] px-5 py-3 font-black text-[#17332d]"
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
