import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  intakeFieldIsVisible,
  selectedIntakeOptionCodes,
} from '../../../modules/intake-answers/index.ts';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';
import type { paths } from '../../../packages/api-client/src/schema.ts';

const client = createBrowserApiClient();

type IntakeSnapshot =
  paths['/api/v1/student/intake']['get']['responses']['200']['content']['application/json'];

export function StudentIntakePage() {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<IntakeSnapshot>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'load' | 'save' | 'submit' | undefined>(
    'load',
  );
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
          setError('Intake is not available yet.');
          setBusy(undefined);
          return;
        }
        const { data, response } = await client.GET('/api/v1/student/intake', {
          params: { query: { locale: access.languageChoice } },
        });
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
          setError('Intake is not available yet.');
          setBusy(undefined);
          return;
        }
        setSnapshot(data);
        setAnswers(data.draft?.answers ?? {});
        setBusy(undefined);
      })
      .catch(() => {
        if (active) {
          setError('Intake is temporarily unavailable. Try again.');
          setBusy(undefined);
        }
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const visibleFields = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.form.intakeForm.fields.filter((field) =>
      intakeFieldIsVisible(field, answers),
    );
  }, [answers, snapshot]);

  function setAnswer(fieldId: string, value: string) {
    setAnswers((current) => {
      const next = { ...current, [fieldId]: value };
      if (snapshot) {
        for (const field of snapshot.form.intakeForm.fields) {
          if (field.visibility && !intakeFieldIsVisible(field, next)) {
            delete next[field.id];
          }
        }
      }
      return next;
    });
  }

  async function saveDraft() {
    if (!snapshot) return;
    setBusy('save');
    setError(undefined);
    try {
      const { response } = await client.PUT('/api/v1/student/intake/draft', {
        body: {
          expectedSchoolConfigurationReleaseId:
            snapshot.form.schoolConfigurationReleaseId,
          expectedIntakeForm: {
            resourceId: snapshot.form.intakeForm.resourceId,
            revisionNumber: snapshot.form.intakeForm.revisionNumber,
          },
          locale: 'en-US',
          answers,
        },
      });
      if (response.status !== 200) {
        setError('Your draft could not be saved. Try again.');
      }
    } catch {
      setError('Your draft could not be saved. Try again.');
    } finally {
      setBusy(undefined);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !attested) return;
    setBusy('submit');
    setError(undefined);
    try {
      const { response } = await client.POST(
        '/api/v1/student/intake/submissions',
        {
          body: {
            operationId: operationId.current,
            expectedSchoolConfigurationReleaseId:
              snapshot.form.schoolConfigurationReleaseId,
            expectedIntakeForm: {
              resourceId: snapshot.form.intakeForm.resourceId,
              revisionNumber: snapshot.form.intakeForm.revisionNumber,
            },
            expectedSubmissionAttestation: {
              resourceId: snapshot.form.submissionAttestation.resourceId,
              revisionNumber: snapshot.form.submissionAttestation.revisionNumber,
            },
            locale: 'en-US',
            answers,
            attestation: {
              locale: 'en-US',
              notice: {
                resourceId: snapshot.form.submissionAttestation.resourceId,
                revisionNumber:
                  snapshot.form.submissionAttestation.revisionNumber,
              },
            },
          },
        },
      );
      if (response.status !== 201) {
        setError('Your intake could not be accepted. Check your answers and try again.');
        return;
      }
      const confirmed = await client.GET('/api/v1/student/intake', {
        params: { query: { locale: 'en-US' } },
      });
      if (confirmed.response.status === 200 && confirmed.data) {
        setSnapshot(confirmed.data);
        setAnswers({});
      }
    } catch {
      setError('Your intake could not be accepted. Try again.');
    } finally {
      setBusy(undefined);
    }
  }

  if (snapshot?.learningUnlocked) {
    return (
      <main className="min-h-full bg-[#17332d] px-5 py-12 text-[#fffaf0] sm:py-20">
        <section className="mx-auto max-w-2xl">
          <p className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-[#e6af2e]">
            Intake accepted
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
            Learning is unlocked.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-[#c8d7ce]">
            The school confirmed your Intake Record Version. You can continue to
            your learning space.
          </p>
          <Link
            id="back-to-learning-space"
            to="/student"
            className="mt-8 inline-block border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide text-[#17332d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Back to learning space
          </Link>
        </section>
      </main>
    );
  }

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
            STEP 02 / INTAKE
          </p>
          <h1 className="mt-3 text-4xl font-black leading-none tracking-tight sm:text-5xl">
            {snapshot?.form.intakeForm.title ?? 'School health intake'}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[#38544d]">
            Answer every visible question. Your draft stays private until you
            submit and the school confirms it.
          </p>

          {busy === 'load' ? (
            <p className="mt-8 text-lg text-[#38544d]">Loading your form...</p>
          ) : null}

          {snapshot ? (
            <form className="mt-8 space-y-10" onSubmit={submit}>
              {snapshot.form.intakeForm.sections
                .slice()
                .sort((left, right) => left.order - right.order)
                .map((section) => {
                  const fields = visibleFields
                    .filter((field) => field.sectionId === section.id)
                    .sort((left, right) => left.order - right.order);
                  if (fields.length === 0) return null;
                  return (
                    <fieldset key={section.id} className="space-y-5">
                      <legend className="text-2xl font-black">
                        {section.title}
                      </legend>
                      {fields.map((field) => (
                        <label
                          key={field.id}
                          className="block text-sm font-black uppercase tracking-wide"
                        >
                          {field.label}
                          {field.type === 'textarea' ? (
                            <textarea
                              required={
                                field.required || field.requiredWhenVisible
                              }
                              value={answers[field.id] ?? ''}
                              onChange={(event) =>
                                setAnswer(field.id, event.target.value)
                              }
                              className="mt-2 min-h-28 w-full border-2 border-[#17332d] bg-white px-4 py-3 text-base font-medium outline-none focus:shadow-[4px_4px_0_#e6af2e]"
                            />
                          ) : field.type === 'yes-no' ||
                            field.type === 'single-choice' ? (
                            <select
                              required={
                                field.required || field.requiredWhenVisible
                              }
                              value={answers[field.id] ?? ''}
                              onChange={(event) =>
                                setAnswer(field.id, event.target.value)
                              }
                              className="mt-2 w-full border-2 border-[#17332d] bg-white px-4 py-3 text-base font-medium outline-none focus:shadow-[4px_4px_0_#e6af2e]"
                            >
                              <option value="">Select</option>
                              {field.options.map((option) => (
                                <option key={option.code} value={option.code}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : field.type === 'multiple-choice' ? (
                            <div className="mt-2 grid gap-2 font-medium normal-case tracking-normal">
                              {field.options.map((option) => {
                                const selected = selectedIntakeOptionCodes(
                                  answers[field.id],
                                ).includes(option.code);
                                return (
                                  <label
                                    key={option.code}
                                    className="flex items-center gap-2 text-sm"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      onChange={() => {
                                        const codes = selectedIntakeOptionCodes(
                                          answers[field.id],
                                        );
                                        const next = selected
                                          ? codes.filter(
                                              (code) => code !== option.code,
                                            )
                                          : [...codes, option.code];
                                        setAnswer(field.id, next.join(','));
                                      }}
                                    />
                                    {option.label}
                                  </label>
                                );
                              })}
                            </div>
                          ) : field.type === 'acknowledgement' ? (
                            <input
                              type="checkbox"
                              required={
                                field.required || field.requiredWhenVisible
                              }
                              checked={answers[field.id] === 'yes'}
                              onChange={(event) =>
                                setAnswer(
                                  field.id,
                                  event.target.checked ? 'yes' : '',
                                )
                              }
                              className="mt-2 h-5 w-5"
                            />
                          ) : (
                            <input
                              type={
                                field.type === 'tel'
                                  ? 'tel'
                                  : field.type === 'date'
                                    ? 'date'
                                    : field.type === 'email'
                                      ? 'email'
                                      : 'text'
                              }
                              required={
                                field.required || field.requiredWhenVisible
                              }
                              value={answers[field.id] ?? ''}
                              onChange={(event) =>
                                setAnswer(field.id, event.target.value)
                              }
                              className="mt-2 w-full border-2 border-[#17332d] bg-white px-4 py-3 text-base font-medium outline-none focus:shadow-[4px_4px_0_#e6af2e]"
                            />
                          )}
                        </label>
                      ))}
                    </fieldset>
                  );
                })}

              <label className="flex items-start gap-3 text-base font-medium leading-7">
                <input
                  type="checkbox"
                  required
                  checked={attested}
                  onChange={(event) => setAttested(event.target.checked)}
                  className="mt-1 h-5 w-5"
                />
                <span>{snapshot.form.submissionAttestation.text}</span>
              </label>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  id="save-draft"
                  type="button"
                  disabled={busy !== undefined}
                  onClick={() => void saveDraft()}
                  className="border-2 border-[#17332d] bg-white px-5 py-3 font-black uppercase tracking-wide shadow-[4px_4px_0_#17332d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                >
                  {busy === 'save' ? 'Saving draft...' : 'Save draft'}
                </button>
                <button
                  id="submit-intake"
                  type="submit"
                  disabled={busy !== undefined || !attested}
                  className="border-2 border-[#17332d] bg-[#e6af2e] px-5 py-3 font-black uppercase tracking-wide shadow-[4px_4px_0_#17332d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                >
                  {busy === 'submit' ? 'Submitting...' : 'Submit intake'}
                </button>
              </div>
            </form>
          ) : null}

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
