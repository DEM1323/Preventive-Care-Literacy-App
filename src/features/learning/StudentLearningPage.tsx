import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';
import type { paths } from '../../../packages/api-client/src/schema.ts';

const client = createBrowserApiClient();

type LearningSnapshot =
  paths['/api/v1/student/learning']['get']['responses']['200']['content']['application/json'];
type ProjectedItem =
  LearningSnapshot['modules'][number]['sections'][number]['items'][number];
type LearningLocale = LearningSnapshot['locale'];

const itemKindCopy = {
  knowledge: {
    section: 'Knowledge',
    action: 'Mark as reviewed',
    hint: 'Review this Knowledge key point.',
  },
  skill: {
    section: 'Skills',
    action: 'I can do this',
    hint: 'Self-attest that you can do this Skill.',
  },
  application: {
    section: 'Application',
    action: 'I did this',
    hint: 'Carry out this Application step.',
  },
} as const;

export function StudentLearningPage() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<LearningSnapshot>();
  const [locale, setLocale] = useState<LearningLocale>('en-US');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'load' | string | undefined>('load');
  const operationIds = useRef(new Map<string, string>());

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
        const languageChoice = access.languageChoice;
        setLocale(languageChoice);
        const { data, response } = await client.GET(
          '/api/v1/student/learning',
          { params: { query: { locale: languageChoice } } },
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

  function operationIdFor(itemId: string) {
    const existing = operationIds.current.get(itemId);
    if (existing) return existing;
    const created = crypto.randomUUID();
    operationIds.current.set(itemId, created);
    return created;
  }

  async function acknowledge(item: ProjectedItem) {
    if (!snapshot?.schoolConfigurationReleaseId) return;
    setBusy(item.itemId);
    setError(undefined);
    try {
      const { response } = await client.POST(
        '/api/v1/student/learning/acknowledgements',
        {
          body: {
            operationId: operationIdFor(item.itemId),
            expectedSchoolConfigurationReleaseId:
              snapshot.schoolConfigurationReleaseId,
            itemId: item.itemId,
            revisionNumber: item.revisionNumber,
          },
        },
      );
      if (response.status !== 201) {
        setError('This item could not be marked complete. Try again.');
        return;
      }
      const confirmed = await client.GET('/api/v1/student/learning', {
        params: { query: { locale } },
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

  const resumeItemId = snapshot?.item?.itemId;

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
            Your Learning Modules
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[#38544d]">
            Review Knowledge key points, self-attest Skills, and carry out
            Application steps. Completed appears only after the school confirms
            your acknowledgement.
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
                className="mt-4 inline-block border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Open intake
              </Link>
            </div>
          ) : null}

          {snapshot?.learningUnlocked && resumeItemId ? (
            <a
              href="#resume-item"
              className="mt-6 inline-block text-sm font-black uppercase tracking-wide underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Continue where you left off
            </a>
          ) : null}

          {snapshot?.modules.map((module) => (
            <article
              key={module.moduleId}
              className="mt-10 border-t-2 border-[#17332d] pt-8"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-3xl font-black tracking-tight">
                  {module.title}
                </h2>
                {module.badge ? (
                  <p
                    role={module.badge.earned ? 'status' : undefined}
                    className={
                      module.badge.earned
                        ? 'border-2 border-[#17332d] bg-[#e6af2e] px-4 py-2 font-black uppercase tracking-wide'
                        : 'border-2 border-dashed border-[#17332d] px-4 py-2 font-black uppercase tracking-wide text-[#49645c]'
                    }
                  >
                    {module.badge.earned
                      ? `Earned: ${module.badge.name}`
                      : `Badge: ${module.badge.name}`}
                  </p>
                ) : null}
              </div>
              {module.completed ? (
                <p role="status" className="mt-3 text-sm font-bold">
                  Module complete
                </p>
              ) : null}

              {module.sections.map((section) => (
                <section
                  key={`${module.moduleId}-${section.kind}`}
                  className="mt-6"
                  aria-labelledby={`${module.moduleId}-${section.kind}-heading`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3
                      id={`${module.moduleId}-${section.kind}-heading`}
                      className="text-xl font-black"
                    >
                      {itemKindCopy[section.kind].section}
                    </h3>
                    <p className="text-sm font-bold text-[#49645c]">
                      {section.completedCount} of {section.totalCount} complete
                      ({section.percentComplete}%)
                    </p>
                  </div>
                  <ol className="mt-4 space-y-4">
                    {section.items.map((item) => {
                      const isResume = item.itemId === resumeItemId;
                      const completed = item.completion !== null;
                      return (
                        <li
                          key={item.itemId}
                          id={isResume ? 'resume-item' : undefined}
                          aria-current={isResume ? 'true' : undefined}
                          className={
                            isResume
                              ? 'border-2 border-[#17332d] bg-white p-5'
                              : 'border border-[#17332d] bg-white p-5'
                          }
                        >
                          <p className="text-sm font-bold uppercase tracking-wide text-[#b43c2c]">
                            {itemKindCopy[item.kind].hint}
                          </p>
                          <p className="mt-3 text-lg leading-8">{item.text}</p>
                          {item.href ? (
                            <a
                              href={item.href}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-block text-sm font-black uppercase tracking-wide underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                            >
                              Open linked resource
                            </a>
                          ) : null}
                          {completed ? (
                            <p
                              role="status"
                              className="mt-4 border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide"
                            >
                              Completed
                            </p>
                          ) : (
                            <button
                              type="button"
                              disabled={busy !== undefined}
                              onClick={() => void acknowledge(item)}
                              className="mt-4 border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide shadow-[4px_4px_0_#17332d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                            >
                              {busy === item.itemId
                                ? 'Saving...'
                                : itemKindCopy[item.kind].action}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </article>
          ))}

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
