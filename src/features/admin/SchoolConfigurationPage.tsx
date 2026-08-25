import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';

const client = createBrowserApiClient();
const locales = ['en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'] as const;
type Locale = (typeof locales)[number];

type LocalizedValue = Record<Locale, { value: string }>;
type Candidate = {
  workspace: {
    branding: {
      displayName: LocalizedValue;
      shortName: LocalizedValue;
      generatedTextMark: string;
      primaryColor: string;
      accentColor: string;
    };
  };
  release: {
    modules: Array<{
      id: string;
      title: LocalizedValue;
      description: LocalizedValue;
      knowledgeItems: Array<{ id: string; text: LocalizedValue }>;
      skillItems: Array<{ id: string; text: LocalizedValue }>;
      applicationItems: Array<{ id: string; text: LocalizedValue }>;
    }>;
    intakeForm: {
      title: LocalizedValue;
      sections: unknown[];
      fields: Array<{
        id: string;
        label: LocalizedValue;
        visibility: { equalsOptionCode: string } | null;
      }>;
    };
    submissionAttestation: { text: LocalizedValue };
  };
};

type Draft = {
  workspaceId: string;
  draftVersion: number;
  activeReleaseId: string | null;
  candidateFingerprint: string;
  candidate: Candidate;
};

type Problem = { code?: string };

function localized(value: LocalizedValue, locale: Locale): string {
  return value[locale]?.value ?? value['en-US'].value;
}

export function SchoolConfigurationPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>();
  const [locale, setLocale] = useState<Locale>('en-US');
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [surface, setSurface] = useState<'module' | 'intake'>('module');
  const [moduleIndex, setModuleIndex] = useState(0);
  const [syntheticYes, setSyntheticYes] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeDescription, setChangeDescription] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [status, setStatus] = useState('Loading the shared draft...');
  const operationId = useRef(crypto.randomUUID());

  async function loadDraft() {
    let response;
    try {
      response = await client.GET(
        '/api/v1/administration/school-configuration',
      );
    } catch {
      setStatus(
        'The shared draft could not be loaded. Retry when the service is available.',
      );
      return;
    }
    if (response.response.status === 401) {
      navigate('/staff/sign-in');
      return;
    }
    if (response.response.status === 403) {
      setStatus(
        'Administrative Permission is required to manage configuration.',
      );
      return;
    }
    if (response.response.status === 404) {
      setStatus('No shared School Configuration Draft has been assembled yet.');
      return;
    }
    if (!response.data) {
      setStatus(
        'The shared draft could not be loaded. Retry when the service is available.',
      );
      return;
    }
    setDraft(response.data as Draft);
    setStatus('');
  }

  useEffect(() => {
    void loadDraft();
  }, []);

  async function publish() {
    if (!draft) return;
    setStatus('Confirming both authentication factors...');
    let stepUp;
    try {
      stepUp = await client.POST('/api/v1/auth/staff/step-up', {
        body: { password, totp },
      });
    } catch {
      setStatus(
        'Authentication could not be checked. Retry without losing this review.',
      );
      return;
    } finally {
      setPassword('');
      setTotp('');
    }
    if (stepUp.response.status !== 200) {
      const problem = stepUp.error as Problem | undefined;
      if (problem?.code === 'STEP_UP_REJECTED') {
        setStatus(
          'Password or authenticator code was not accepted. Try both factors again.',
        );
      } else if (problem?.code === 'STEP_UP_INCOMPLETE') {
        setStatus('Enter a password and six-digit authenticator code.');
      } else if (
        stepUp.response.status === 401 ||
        stepUp.response.status === 403
      ) {
        setPublishOpen(false);
        setChangeDescription('');
        setStatus(
          'Your session or Administrative Permission changed. Sign in and review again.',
        );
      } else {
        setStatus('Authentication could not be refreshed. Retry this review.');
      }
      return;
    }

    setStatus('Packaging and atomically activating the exact candidate...');
    let result;
    try {
      result = await client.POST(
        '/api/v1/administration/school-configuration/releases',
        {
          body: {
            operationId: operationId.current,
            expectedActiveReleaseId: draft.activeReleaseId,
            expectedDraftVersion: draft.draftVersion,
            candidateFingerprint: draft.candidateFingerprint,
            changeDescription,
          },
        },
      );
    } catch {
      setStatus(
        'Publication failed without activation. Retry with the same operation when the service recovers.',
      );
      return;
    }
    if (result.response.status === 201 && result.data) {
      setPublishOpen(false);
      setChangeDescription('');
      operationId.current = crypto.randomUUID();
      setStatus(
        `Release ${result.data.releaseNumber} is active with one immutable package.`,
      );
      await loadDraft();
      return;
    }
    const problem = result.error as Problem | undefined;
    if (problem?.code === 'AUTHENTICATION_FRESHNESS_REQUIRED') {
      setStatus(
        'Authentication freshness expired. Confirm both factors again; this review is preserved.',
      );
    } else if (problem?.code?.endsWith('_CONFLICT')) {
      setPublishOpen(false);
      operationId.current = crypto.randomUUID();
      setStatus(
        'The draft or active release changed. Reload and compare before publishing.',
      );
      await loadDraft();
    } else if (
      result.response.status === 401 ||
      result.response.status === 403
    ) {
      setPublishOpen(false);
      setChangeDescription('');
      setStatus(
        'Your session or Administrative Permission changed. Sign in and review again.',
      );
    } else {
      setStatus(
        'Publication failed without activation. Retry with the same operation when the service recovers.',
      );
    }
  }

  if (!draft) {
    return (
      <main className="min-h-full bg-slate-950 px-6 py-20 text-slate-100">
        <p className="mx-auto max-w-2xl">{status}</p>
      </main>
    );
  }

  const candidate = draft.candidate;
  const branding = candidate.workspace.branding;
  const module = candidate.release.modules[moduleIndex];
  return (
    <main className="min-h-full bg-slate-100 text-slate-900">
      <header className="bg-emerald-800 px-4 py-4 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">
              Shared School Configuration Draft
            </p>
            <h1 className="text-xl font-black">
              {localized(branding.displayName, locale)}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setPublishOpen(true)}
            className="rounded-xl bg-white px-4 py-2 font-bold text-emerald-800"
          >
            Review to publish
          </button>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 p-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:p-8">
        <aside className="rounded-2xl bg-slate-900 p-4 text-white">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Exact candidate
          </p>
          <p className="mt-2 break-all text-xs text-slate-300">
            {draft.candidateFingerprint}
          </p>
          <div className="mt-6 grid gap-2">
            <button
              type="button"
              onClick={() => setSurface('module')}
              className={`rounded-lg px-3 py-2 text-left font-bold ${surface === 'module' ? 'bg-emerald-600' : 'bg-slate-800'}`}
            >
              Learning Module
            </button>
            <button
              type="button"
              onClick={() => setSurface('intake')}
              className={`rounded-lg px-3 py-2 text-left font-bold ${surface === 'intake' ? 'bg-emerald-600' : 'bg-slate-800'}`}
            >
              Intake Form
            </button>
          </div>
          {surface === 'module' ? (
            <div className="mt-5 grid gap-1">
              {candidate.release.modules.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setModuleIndex(index)}
                  className={`rounded px-2 py-1 text-left text-xs ${moduleIndex === index ? 'bg-slate-700 text-white' : 'text-slate-400'}`}
                >
                  {index + 1}. {localized(item.title, locale)}
                </button>
              ))}
            </div>
          ) : null}
          <p className="mt-6 text-xs leading-5 text-slate-400">
            All five locale slots are reviewed for this synthetic test-workspace
            candidate. This is not real-world approval.
          </p>
        </aside>
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black">Student experience preview</h2>
              <p className="text-sm text-slate-500">
                Synthetic data only. No Student route or record is loaded.
              </p>
            </div>
            <div className="flex gap-2">
              <select
                id="preview-locale"
                value={locale}
                onChange={(event) => setLocale(event.target.value as Locale)}
                className="rounded-lg border bg-white px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {locales.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <button
                id="preview-width"
                type="button"
                onClick={() =>
                  setWidth(width === 'desktop' ? 'mobile' : 'desktop')
                }
                className="rounded-lg border bg-white px-3 py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {width}
              </button>
            </div>
          </div>
          <div
            className={`mx-auto overflow-hidden rounded-[1.75rem] border-[6px] border-slate-900 bg-white shadow-xl ${width === 'mobile' ? 'max-w-[375px]' : 'max-w-4xl'}`}
          >
            <div
              className="flex items-center gap-3 px-5 py-4 text-white"
              style={{ backgroundColor: branding.primaryColor }}
            >
              <span
                className="rounded-lg bg-white px-2 py-1 font-black"
                style={{ color: branding.primaryColor }}
              >
                {branding.generatedTextMark}
              </span>
              <strong>{localized(branding.shortName, locale)}</strong>
            </div>
            <div className="p-6 sm:p-8">
              {surface === 'module' && module ? (
                <>
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
                    Knowledge · Skills · Application
                  </p>
                  <h3 className="mt-2 text-3xl font-black">
                    {localized(module.title, locale)}
                  </h3>
                  <p className="mt-3 leading-7 text-slate-600">
                    {localized(module.description, locale)}
                  </p>
                  <div
                    className={`mt-6 grid gap-3 ${width === 'desktop' ? 'sm:grid-cols-3' : ''}`}
                  >
                    {[
                      ['Knowledge', module.knowledgeItems],
                      ['Skills', module.skillItems],
                      ['Application', module.applicationItems],
                    ].map(([label, items]) => (
                      <article
                        key={label as string}
                        className="rounded-xl border p-4"
                      >
                        <strong>{label as string}</strong>
                        <div className="mt-2 grid gap-2">
                          {(
                            items as Array<{ id: string; text: LocalizedValue }>
                          ).map((item) => (
                            <p key={item.id} className="text-sm text-slate-600">
                              {localized(item.text, locale).replaceAll(
                                /<\/?strong>/g,
                                '',
                              )}
                            </p>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
                    Synthetic Intake preview
                  </p>
                  <h3 className="mt-2 text-3xl font-black">
                    {localized(candidate.release.intakeForm.title, locale)}
                  </h3>
                  <p className="mt-4 text-slate-600">
                    Visibility rules use synthetic answers. The exact form
                    contains {candidate.release.intakeForm.sections.length}{' '}
                    ordered sections.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSyntheticYes(false)}
                      className={`rounded-full px-4 py-2 text-sm font-bold ${!syntheticYes ? 'bg-emerald-700 text-white' : 'bg-slate-100'}`}
                    >
                      Synthetic No
                    </button>
                    <button
                      type="button"
                      onClick={() => setSyntheticYes(true)}
                      className={`rounded-full px-4 py-2 text-sm font-bold ${syntheticYes ? 'bg-emerald-700 text-white' : 'bg-slate-100'}`}
                    >
                      Synthetic Yes
                    </button>
                  </div>
                  <div className="mt-5 grid gap-2">
                    {candidate.release.intakeForm.fields
                      .filter(
                        (field) =>
                          !field.visibility ||
                          (syntheticYes &&
                            field.visibility.equalsOptionCode === 'yes'),
                      )
                      .map((field) => (
                        <p
                          key={field.id}
                          className="rounded-lg border bg-white p-3 text-sm font-bold"
                        >
                          {localized(field.label, locale)}
                        </p>
                      ))}
                  </div>
                  <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                    {localized(
                      candidate.release.submissionAttestation.text,
                      locale,
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <p
            aria-live="polite"
            className="mt-4 min-h-6 text-sm font-bold text-slate-700"
          >
            {status}
          </p>
        </section>
      </div>
      {publishOpen && (
        <div className="fixed inset-0 flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Publish School Configuration Release"
            className="w-full max-w-xl rounded-t-3xl bg-white p-6 sm:rounded-3xl"
          >
            <h2 className="text-2xl font-black">
              Authorize atomic publication
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Describe this immutable release, then confirm fresh
              password-plus-TOTP authentication.
            </p>
            <textarea
              aria-label="Change description"
              value={changeDescription}
              onChange={(event) => setChangeDescription(event.target.value)}
              rows={3}
              placeholder="Required change description"
              className="mt-5 w-full rounded-xl border px-3 py-2"
            />
            <input
              aria-label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              className="mt-3 w-full rounded-xl border px-3 py-2"
            />
            <input
              aria-label="Authenticator code"
              inputMode="numeric"
              value={totp}
              onChange={(event) => setTotp(event.target.value)}
              placeholder="6-digit authenticator code"
              className="mt-3 w-full rounded-xl border px-3 py-2"
            />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setPublishOpen(false);
                  setPassword('');
                  setTotp('');
                }}
                className="flex-1 rounded-xl border px-4 py-3 font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !changeDescription.trim() ||
                  !password ||
                  !/^[0-9]{6}$/.test(totp)
                }
                onClick={() => void publish()}
                className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50"
              >
                Publish atomically
              </button>
            </div>
            <p aria-live="polite" className="mt-3 text-sm text-slate-600">
              {status}
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
