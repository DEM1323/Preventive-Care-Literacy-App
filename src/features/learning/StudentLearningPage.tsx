import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';
import type { paths } from '../../../packages/api-client/src/schema.ts';

const client = createBrowserApiClient();

type LearningSnapshot =
  paths['/api/v1/student/learning']['get']['responses']['200']['content']['application/json'];

export function StudentLearningPage() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<LearningSnapshot>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'load' | 'save' | undefined>('load');
  const operationId = useRef(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    void client
      .GET('/api/v1/student/session')
      .then(async ({ data: access, response: sessionResponse }) => {
        if (!active) return;
        if (sessionResponse.status === 401) {
          navigate('/student/sign-in');
          return;
        }
        if (sessionResponse.status !== 200 || !access) {
          setError('Learning is not available yet.');
          setBusy(undefined);
          return;
        }
        const { data, response } = await client.GET(
          '/api/v1/student/learning',
          { params: { query: { locale: access.languageChoice } } },
        );
        if (!active) return;
        if (response.status === 401) {
          navigate('/student/sign-in');
          return;
        }
        if (response.status === 403) {
          navigate('/student');
          return;
        }
        if (response.status !== 200 || !data) {
          setError('Learning is not available yet.');
          setBusy(undefined);
          return;
        }
        setSnapshot(data);
        setBusy(undefined);
      })
      .catch(() => {
        if (active) {
          setError('Learning is temporarily unavailable. Try again.');
          setBusy(undefined);
        }
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  async function acknowledge() {
    if (!snapshot?.item || !snapshot.schoolConfigurationReleaseId) return;
    setBusy('save');
    setError(undefined);
    try {
      const { response, data } = await client.POST(
        '/api/v1/student/learning/acknowledgements',
        {
          body: {
            operationId: operationId.current,
            expectedSchoolConfigurationReleaseId:
              snapshot.schoolConfigurationReleaseId,
            itemId: snapshot.item.itemId,
            revisionNumber: snapshot.item.revisionNumber,
          },
        },
      );
      if (response.status !== 201 || !data) {
        setError('This item could not be marked complete. Try again.');
        return;
      }
      setSnapshot({
        ...snapshot,
        completion: {
          itemCompletionId: data.itemCompletionId,
          itemId: data.itemId,
          revisionNumber: data.revisionNumber,
          schoolConfigurationReleaseId: data.schoolConfigurationReleaseId,
          completedAt: data.completedAt,
        },
      });
      const confirmed = await client.GET('/api/v1/student/learning', {
        params: { query: { locale: 'en-US' } },
      });
      if (confirmed.response.status === 200 && confirmed.data) {
        setSnapshot(confirmed.data);
      }
    } catch {
      setError('This item could not be marked complete. Try again.');
    } finally {
      setBusy(undefined);
    }
  }

  const completed = snapshot?.completion !== null && snapshot?.completion !== undefined;

  return (
    <main className="min-h-full bg-[#f3ecd9] px-5 py-12 text-[#17332d] sm:py-20">
      <section className="mx-auto max-w-3xl overflow-hidden border border-[#17332d] bg-[#fffaf0] shadow-[10px_10px_0_#d86045]">
        <div className="border-b border-[#17332d] bg-[#17332d] px-7 py-4 text-[#fffaf0]">
          <p className="text-xs font-black uppercase tracking-[0.28em]">
            Preventive care literacy
          </p>
        </div>
        <div className="p-7 sm:p-10">
          <p className="font-mono text-sm font-bold text-[#b43c2c]">
            STEP 03 / LEARNING
          </p>
          <h1 className="mt-3 text-4xl font-black leading-none tracking-tight sm:text-5xl">
            {snapshot?.item?.moduleTitle ?? 'Your learning item'}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[#38544d]">
            Review this Knowledge key point. Completed appears only after the
            school confirms your acknowledgement.
          </p>

          {busy === 'load' ? (
            <p className="mt-8 text-lg text-[#38544d]">
              Restoring your learning progress...
            </p>
          ) : null}

          {snapshot && !snapshot.learningUnlocked ? (
            <div className="mt-8 border-l-4 border-[#b43c2c] bg-[#f9ded5] p-4">
              <p className="text-sm font-bold leading-6">
                Complete your intake before this Learning Module item unlocks.
              </p>
              <Link
                to="/student/intake"
                className="mt-4 inline-block border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide"
              >
                Open intake
              </Link>
            </div>
          ) : null}

          {snapshot?.item ? (
            <article className="mt-8 space-y-6">
              <p className="text-lg leading-8">{snapshot.item.text}</p>
              {completed ? (
                <p
                  role="status"
                  className="border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide"
                >
                  Completed
                </p>
              ) : (
                <button
                  type="button"
                  disabled={busy !== undefined}
                  onClick={() => void acknowledge()}
                  className="border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide shadow-[4px_4px_0_#17332d] disabled:opacity-50"
                >
                  {busy === 'save' ? 'Saving...' : 'Mark as reviewed'}
                </button>
              )}
            </article>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-6 border-l-4 border-[#b43c2c] bg-[#f9ded5] p-4 text-sm font-bold leading-6"
            >
              {error}
            </p>
          ) : null}

          <Link
            id="back-to-student"
            to="/student"
            className="mt-8 inline-block text-sm font-black uppercase tracking-wide underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Back to learning space
          </Link>
        </div>
      </section>
    </main>
  );
}
