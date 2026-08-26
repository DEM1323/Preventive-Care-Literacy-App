import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';
import type { paths } from '../../../packages/api-client/src/schema.ts';

const client = createBrowserApiClient();
const locales = ['en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'] as const;
type Locale = (typeof locales)[number];
type ResourceKey = 'branding' | 'modules' | 'intake' | 'translations';
type Collection = 'knowledgeItems' | 'skillItems' | 'applicationItems';
type DraftEditBody =
  paths['/api/v1/administration/school-configuration/draft-edits']['post']['requestBody']['content']['application/json'];
type DraftResponse =
  paths['/api/v1/administration/school-configuration']['get']['responses']['200']['content']['application/json'];

type LocalizedValue = Record<Locale, { value: string }>;
type ModuleItem = {
  id: string;
  revision: number;
  text: LocalizedValue;
  href?: string | null;
};
type LearningModule = {
  id: string;
  revision: number;
  title: LocalizedValue;
  description: LocalizedValue;
  knowledgeIntroduction?: LocalizedValue;
  knowledgeItems: ModuleItem[];
  skillItems: ModuleItem[];
  applicationItems: ModuleItem[];
};
type Candidate = {
  workspace: {
    branding: {
      id: string;
      revision: number;
      displayName: LocalizedValue;
      shortName: LocalizedValue;
      generatedTextMark: string;
      primaryColor: string;
      accentColor: string;
    };
  };
  release: {
    modules: LearningModule[];
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
type Draft = Omit<DraftResponse, 'candidate'> & { candidate: Candidate };
type Problem = { code?: string; affectedValue?: string; draftVersion?: number };
type BrandingFields = {
  displayName: string;
  shortName: string;
  generatedTextMark: string;
  primaryColor: string;
  accentColor: string;
};
type ModuleFields = {
  title: string;
  description: string;
  knowledgeIntroduction: string;
};
type ItemFields = { text: string; href?: string | null };

function localized(value: LocalizedValue | undefined, locale: Locale): string {
  return value?.[locale]?.value ?? value?.['en-US']?.value ?? '';
}

function brandingFieldsFrom(
  branding: Candidate['workspace']['branding'],
): BrandingFields {
  return {
    displayName: localized(branding.displayName, 'en-US'),
    shortName: localized(branding.shortName, 'en-US'),
    generatedTextMark: branding.generatedTextMark,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
  };
}

function moduleFieldsFrom(module: LearningModule): ModuleFields {
  return {
    title: localized(module.title, 'en-US'),
    description: localized(module.description, 'en-US'),
    knowledgeIntroduction: localized(module.knowledgeIntroduction, 'en-US'),
  };
}

function sameBranding(left: BrandingFields, right: BrandingFields): boolean {
  return (
    left.displayName === right.displayName &&
    left.shortName === right.shortName &&
    left.generatedTextMark === right.generatedTextMark &&
    left.primaryColor === right.primaryColor &&
    left.accentColor === right.accentColor
  );
}

function sameModule(left: ModuleFields, right: ModuleFields): boolean {
  return (
    left.title === right.title &&
    left.description === right.description &&
    left.knowledgeIntroduction === right.knowledgeIntroduction
  );
}

function sameItem(left: ItemFields, right: ItemFields): boolean {
  return left.text === right.text && left.href === right.href;
}

function asDraft(value: DraftResponse): Draft {
  return value as Draft;
}

export function SchoolConfigurationPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [locale, setLocale] = useState<Locale>('en-US');
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [resource, setResource] = useState<ResourceKey>('branding');
  const [moduleId, setModuleId] = useState<string>();
  const [inspectorTab, setInspectorTab] = useState<'edit' | 'readiness'>('edit');
  const [mobileSurface, setMobileSurface] = useState<
    'edit' | 'preview' | 'readiness'
  >('preview');
  const [syntheticYes, setSyntheticYes] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeDescription, setChangeDescription] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [status, setStatus] = useState('Loading the shared draft...');
  const [saveState, setSaveState] = useState('Saved to the shared draft.');
  const [conflict, setConflict] = useState(false);
  const operationId = useRef(crypto.randomUUID());
  const initializationOperationId = useRef(crypto.randomUUID());
  const saveOperationId = useRef(crypto.randomUUID());
  const saveTimer = useRef<number | undefined>(undefined);
  const saveInFlight = useRef(false);
  const saveAgain = useRef(false);
  const brandingEdits = useRef<BrandingFields | undefined>(undefined);
  const moduleEdits = useRef(new Map<string, ModuleFields>());
  const itemEdits = useRef(new Map<string, ItemFields>());
  const [editorEpoch, setEditorEpoch] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function resetEditorBuffers() {
    brandingEdits.current = undefined;
    moduleEdits.current = new Map();
    itemEdits.current = new Map();
    setEditorEpoch((value) => value + 1);
  }

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
      try {
        const session = await client.GET('/api/v1/staff/session');
        if (session.response.status === 401) {
          navigate('/staff/sign-in');
          return;
        }
        if (session.response.status === 200 && session.data) {
          setWorkspaceId(session.data.workspaceId);
        }
      } catch {
        setStatus(
          'No configuration draft exists, but workspace access could not be confirmed. Reload to retry.',
        );
      }
      return;
    }
    if (!response.data) {
      setStatus(
        'The shared draft could not be loaded. Retry when the service is available.',
      );
      return;
    }
    const next = asDraft(response.data);
    setDraft(next);
    setWorkspaceId(next.workspaceId);
    setModuleId((current) => current ?? next.candidate.release.modules[0]?.id);
    setConflict(false);
    setSaveState('Saved to the shared draft.');
    setStatus('');
    resetEditorBuffers();
  }

  async function installDemoDraft() {
    if (!workspaceId) return;
    setStatus(
      'Installing the synthetic demo configuration as a shared draft...',
    );
    try {
      const { default: demoConfigurationText } =
        await import('../../../docs/fixtures/umb-demo-school-configuration-release-1.json?raw');
      const fixture = JSON.parse(demoConfigurationText) as Record<
        string,
        unknown
      >;
      const fixtureWorkspace = fixture.workspace;
      if (!fixtureWorkspace || typeof fixtureWorkspace !== 'object') {
        setStatus('The bundled demo configuration is malformed.');
        return;
      }
      const candidate = {
        ...fixture,
        workspace: { ...fixtureWorkspace, id: workspaceId },
      };
      const result = await client.POST(
        '/api/v1/administration/school-configuration/draft-imports',
        {
          body: {
            operationId: initializationOperationId.current,
            expectedDraftVersion: 0,
            candidate,
          },
        },
      );
      if (result.response.status !== 201) {
        const problem = result.error as Problem | undefined;
        setStatus(
          problem?.code === 'DRAFT_VERSION_CONFLICT'
            ? 'A configuration draft now exists. Reloading it...'
            : 'The demo configuration could not be installed.',
        );
        if (problem?.code === 'DRAFT_VERSION_CONFLICT') await loadDraft();
        return;
      }
      initializationOperationId.current = crypto.randomUUID();
      await loadDraft();
    } catch {
      setStatus(
        'Demo configuration installation failed. Retry preserves this operation.',
      );
    }
  }

  async function editDraft(
    body: Omit<
      DraftEditBody,
      'operationId' | 'expectedDraftVersion' | 'expectedResourceRevisions'
    > & {
      expectedResourceRevisions?: DraftEditBody['expectedResourceRevisions'];
    },
  ): Promise<boolean> {
    const current = draftRef.current;
    if (!current) return false;
    setSaveState('Saving to the shared draft...');
    setConflict(false);
    try {
      const result = await client.POST(
        '/api/v1/administration/school-configuration/draft-edits',
        {
          body: {
            ...body,
            operationId: saveOperationId.current,
            expectedDraftVersion: current.draftVersion,
            expectedResourceRevisions: body.expectedResourceRevisions ?? [],
          },
        },
      );
      if (result.response.status === 200 && result.data) {
        saveOperationId.current = crypto.randomUUID();
        const next = asDraft(result.data);
        draftRef.current = next;
        setDraft(next);
        setSaveState('Saved to the shared draft.');
        if (!body.type.startsWith('save-')) {
          resetEditorBuffers();
        }
        return true;
      }
      const problem = result.error as Problem | undefined;
      if (
        problem?.code === 'RESOURCE_REVISION_CONFLICT' ||
        problem?.code === 'DRAFT_VERSION_CONFLICT'
      ) {
        setConflict(true);
        setSaveState(
          'Another Administrator changed this resource. Compare or reload before saving again.',
        );
        return false;
      }
      setSaveState(
        problem?.affectedValue
          ? `This edit was rejected: ${problem.affectedValue}.`
          : 'This edit could not be saved. Retry without losing your work.',
      );
      return false;
    } catch {
      setSaveState(
        'Saving failed. Retry keeps this operation until the service recovers.',
      );
      return false;
    }
  }

  async function flushPendingEdits() {
    if (saveInFlight.current) {
      saveAgain.current = true;
      return;
    }
    saveInFlight.current = true;
    try {
      do {
        saveAgain.current = false;
        const current = draftRef.current;
        if (!current) return;
        if (brandingEdits.current) {
          const sent = { ...brandingEdits.current };
          const branding = current.candidate.workspace.branding;
          const saved = await editDraft({
            type: 'save-workspace-branding',
            resourceId: branding.id,
            expectedResourceRevisions: [
              {
                resourceId: branding.id,
                revisionNumber: branding.revision,
              },
            ],
            ...sent,
          });
          if (!saved) return;
          if (
            brandingEdits.current &&
            sameBranding(brandingEdits.current, sent)
          ) {
            brandingEdits.current = undefined;
          }
        }
        for (const [resourceId, fields] of [...moduleEdits.current.entries()]) {
          const latest = draftRef.current;
          const module = latest?.candidate.release.modules.find(
            (item) => item.id === resourceId,
          );
          if (!latest || !module) {
            moduleEdits.current.delete(resourceId);
            continue;
          }
          const sent = { ...fields };
          const saved = await editDraft({
            type: 'save-learning-module',
            resourceId,
            expectedResourceRevisions: [
              {
                resourceId,
                revisionNumber: module.revision,
              },
            ],
            ...sent,
          });
          if (!saved) return;
          const pending = moduleEdits.current.get(resourceId);
          if (pending && sameModule(pending, sent)) {
            moduleEdits.current.delete(resourceId);
          }
        }
        for (const [resourceId, fields] of [...itemEdits.current.entries()]) {
          const latest = draftRef.current;
          const item = latest
            ? latest.candidate.release.modules
                .flatMap((module) => [
                  ...module.knowledgeItems,
                  ...module.skillItems,
                  ...module.applicationItems,
                ])
                .find((entry) => entry.id === resourceId)
            : undefined;
          if (!latest || !item) {
            itemEdits.current.delete(resourceId);
            continue;
          }
          const sent = { ...fields };
          const saved = await editDraft({
            type: 'save-learning-module-item',
            resourceId,
            expectedResourceRevisions: [
              {
                resourceId,
                revisionNumber: item.revision,
              },
            ],
            ...sent,
          });
          if (!saved) return;
          const pending = itemEdits.current.get(resourceId);
          if (pending && sameItem(pending, sent)) {
            itemEdits.current.delete(resourceId);
          }
        }
      } while (
        saveAgain.current ||
        brandingEdits.current ||
        moduleEdits.current.size > 0 ||
        itemEdits.current.size > 0
      );
    } finally {
      saveInFlight.current = false;
    }
    if (saveAgain.current) {
      saveAgain.current = false;
      await flushPendingEdits();
    }
  }

  function queueSave() {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void flushPendingEdits();
    }, 400);
  }

  function patchBranding(patch: Partial<BrandingFields>) {
    const current = draftRef.current;
    if (!current) return;
    brandingEdits.current = {
      ...(brandingEdits.current ??
        brandingFieldsFrom(current.candidate.workspace.branding)),
      ...patch,
    };
    queueSave();
  }

  function patchModule(module: LearningModule, patch: Partial<ModuleFields>) {
    moduleEdits.current.set(module.id, {
      ...(moduleEdits.current.get(module.id) ?? moduleFieldsFrom(module)),
      ...patch,
    });
    queueSave();
  }

  function patchItem(item: ModuleItem, patch: Partial<ItemFields>) {
    itemEdits.current.set(item.id, {
      ...(itemEdits.current.get(item.id) ?? {
        text: localized(item.text, 'en-US'),
        href: item.href,
      }),
      ...patch,
    });
    queueSave();
  }

  useEffect(() => {
    void loadDraft();
    return () => window.clearTimeout(saveTimer.current);
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
      await loadDraft();
      setStatus(
        `Release ${result.data.releaseNumber} is active with one immutable package.`,
      );
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
        <section className="mx-auto max-w-2xl border-l-4 border-emerald-400 bg-slate-900 p-8">
          <p>{status}</p>
          {workspaceId &&
          status ===
            'No shared School Configuration Draft has been assembled yet.' ? (
            <>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Install the bundled synthetic configuration to validate this
                workspace end to end. It is test content, not real-world
                publication approval.
              </p>
              <button
                type="button"
                onClick={() => void installDemoDraft()}
                className="mt-6 rounded bg-emerald-400 px-4 py-3 font-black text-slate-950"
              >
                Install synthetic demo draft
              </button>
            </>
          ) : null}
        </section>
      </main>
    );
  }

  const candidate = draft.candidate;
  const branding = candidate.workspace.branding;
  const selectedModule =
    candidate.release.modules.find((item) => item.id === moduleId) ??
    candidate.release.modules[0];
  const blockers = draft.validation.blockers;
  const publishDisabled = blockers.length > 0 || !draft.unpublishedChanges;
  const selectedComparison = draft.comparisons.find((comparison) =>
    resource === 'branding'
      ? comparison.resourceId === branding.id
      : comparison.resourceId === selectedModule?.id,
  );
  const previewScreen =
    resource === 'branding' ? 'home' : resource === 'intake' ? 'intake' : 'module';

  function chooseResource(next: ResourceKey) {
    setResource(next);
    setInspectorTab('edit');
    setMobileSurface('edit');
  }

  function chooseSurface(surface: 'edit' | 'preview' | 'readiness') {
    setMobileSurface(surface);
    if (surface !== 'preview') setInspectorTab(surface);
  }

  return (
    <main className="min-h-full bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-40 bg-emerald-700 px-4 py-3 text-white shadow-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100">
              Shared School Configuration Draft
            </p>
            <h1 className="text-lg font-bold">
              {localized(branding.displayName, locale)}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-2 text-xs font-bold ${
                blockers.length
                  ? 'border-amber-300 bg-amber-100 text-amber-900'
                  : draft.unpublishedChanges
                    ? 'border-emerald-200 bg-emerald-800 text-emerald-100'
                    : 'border-emerald-500 bg-emerald-800 text-emerald-100'
              }`}
            >
              {blockers.length
                ? `${blockers.length} publication blockers`
                : draft.unpublishedChanges
                  ? 'Ready for review'
                  : 'No unpublished changes'}
            </span>
            <button
              type="button"
              disabled={publishDisabled}
              onClick={() => setPublishOpen(true)}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {draft.unpublishedChanges
                ? 'Review to publish'
                : 'Release is current'}
            </button>
          </div>
        </div>
      </header>

      <nav
        className="grid grid-cols-3 border-b border-slate-200 bg-white p-2 xl:hidden"
        aria-label="Configuration surface"
      >
        {(['edit', 'preview', 'readiness'] as const).map((surface) => (
          <button
            key={surface}
            type="button"
            onClick={() => chooseSurface(surface)}
            className={`rounded-lg px-3 py-2 text-xs font-bold capitalize ${
              mobileSurface === surface
                ? 'bg-emerald-600 text-white'
                : 'text-slate-500'
            }`}
          >
            {surface}
          </button>
        ))}
      </nav>

      <div className="mx-auto grid max-w-[1600px] xl:grid-cols-[220px_minmax(0,1fr)_400px]">
        <nav
          className={`${mobileSurface === 'edit' ? 'flex' : 'hidden'} gap-2 overflow-x-auto border-b border-slate-200 bg-white p-3 xl:flex xl:min-h-[calc(100vh-72px)] xl:flex-col xl:border-b-0 xl:border-r`}
          aria-label="Configuration resources"
        >
          {(
            [
              ['branding', 'Branding'],
              ['modules', 'Modules'],
              ['intake', 'Intake'],
              ['translations', 'Locales'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => chooseResource(key)}
              className={`min-w-24 rounded-xl px-3 py-3 text-left text-sm font-bold ${
                resource === key
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
          {resource === 'modules' ? (
            <div className="mt-3 hidden w-full grid-cols-1 gap-1 xl:grid">
              {candidate.release.modules.map((item, index) => (
                <div key={item.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setModuleId(item.id)}
                    className={`min-w-0 flex-1 rounded px-2 py-1 text-left text-xs ${
                      selectedModule?.id === item.id
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    {index + 1}. {localized(item.title, locale)}
                  </button>
                  {index > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const ids = candidate.release.modules.map(
                          (entry) => entry.id,
                        );
                        const previous = ids[index - 1];
                        const currentId = ids[index];
                        if (!previous || !currentId) return;
                        ids[index - 1] = currentId;
                        ids[index] = previous;
                        void editDraft({
                          type: 'reorder-learning-modules',
                          orderedResourceIds: ids,
                          expectedResourceRevisions:
                            candidate.release.modules.map((entry) => ({
                              resourceId: entry.id,
                              revisionNumber: entry.revision,
                            })),
                        });
                      }}
                      className="shrink-0 text-[10px] font-bold text-slate-500"
                    >
                      Up
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  void editDraft({
                    type: 'create-learning-module',
                    title: 'New Learning Module',
                    description: 'Describe what students will practice.',
                  })
                }
                className="mt-2 rounded-lg border border-dashed px-2 py-2 text-left text-xs font-bold text-emerald-800"
              >
                Add Learning Module
              </button>
            </div>
          ) : null}
          <p className="mt-auto hidden pt-6 text-xs leading-5 text-slate-400 xl:block">
            Autosaves to the shared draft. Active Students remain pinned to the
            active School Configuration Release.
          </p>
        </nav>

        <section
          className={`${mobileSurface === 'preview' ? 'block' : 'hidden'} min-w-0 p-4 sm:p-7 xl:block`}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black">Student experience preview</h2>
              <p className="text-sm text-slate-500">
                Exact draft candidate. Synthetic data only. No Student route or
                record is loaded. Preview follows the selected resource.
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
              {previewScreen === 'home' ? (
                <>
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
                    Student home
                  </p>
                  <h3 className="mt-2 text-3xl font-black">
                    {localized(branding.displayName, locale)}
                  </h3>
                  <p className="mt-3 leading-7 text-slate-600">
                    Students still see the active School Configuration Release
                    until this candidate is published atomically.
                  </p>
                </>
              ) : previewScreen === 'module' && selectedModule ? (
                <>
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
                    Knowledge · Skills · Application
                  </p>
                  <h3 className="mt-2 text-3xl font-black">
                    {localized(selectedModule.title, locale)}
                  </h3>
                  <p className="mt-3 leading-7 text-slate-600">
                    {localized(selectedModule.description, locale)}
                  </p>
                  <div
                    className={`mt-6 grid gap-3 ${width === 'desktop' ? 'sm:grid-cols-3' : ''}`}
                  >
                    {(
                      [
                        ['Knowledge', selectedModule.knowledgeItems],
                        ['Skills', selectedModule.skillItems],
                        ['Application', selectedModule.applicationItems],
                      ] as const
                    ).map(([label, items]) => (
                      <article key={label} className="rounded-xl border p-4">
                        <strong>{label}</strong>
                        <div className="mt-2 grid gap-2">
                          {items.map((item) => (
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

        <aside
          className={`${mobileSurface === 'preview' ? 'hidden' : 'block'} border-t border-slate-200 bg-white p-5 xl:block xl:border-l xl:border-t-0 xl:p-7`}
        >
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => chooseSurface('edit')}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${inspectorTab === 'edit' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}
            >
              Edit selected
            </button>
            <button
              type="button"
              onClick={() => chooseSurface('readiness')}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${inspectorTab === 'readiness' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}
            >
              Release readiness · {blockers.length}
            </button>
          </div>
          {inspectorTab === 'edit' ? (
            <EditorPane
              key={editorEpoch}
              resource={resource}
              draft={draft}
              branding={branding}
              selectedModule={selectedModule}
              saveState={saveState}
              conflict={conflict}
              comparison={selectedComparison}
              onReload={() => void loadDraft()}
              onRestore={(resourceId, revisionNumber) =>
                void editDraft({
                  type: 'restore-active-revision',
                  resourceId,
                  expectedResourceRevisions: [
                    { resourceId, revisionNumber },
                  ],
                })
              }
              onDiscard={(resourceId, revisionNumber) =>
                void editDraft({
                  type: 'discard-authored-resource',
                  resourceId,
                  expectedResourceRevisions: [
                    { resourceId, revisionNumber },
                  ],
                })
              }
              onPatchBranding={patchBranding}
              onPatchModule={(fields) => {
                if (!selectedModule) return;
                patchModule(selectedModule, fields);
              }}
              onPatchItem={patchItem}
              onReorder={(collection, orderedResourceIds) => {
                if (!selectedModule) return;
                void editDraft({
                  type: 'reorder-learning-module-items',
                  moduleId: selectedModule.id,
                  collection,
                  orderedResourceIds,
                  expectedResourceRevisions: [
                    {
                      resourceId: selectedModule.id,
                      revisionNumber: selectedModule.revision,
                    },
                    ...selectedModule[collection].map((item) => ({
                      resourceId: item.id,
                      revisionNumber: item.revision,
                    })),
                  ],
                });
              }}
              onCreateItem={(collection) => {
                if (!selectedModule) return;
                void editDraft({
                  type: 'create-learning-module-item',
                  moduleId: selectedModule.id,
                  collection,
                  text:
                    collection === 'skillItems'
                      ? 'I can describe this skill.'
                      : collection === 'applicationItems'
                        ? 'Complete this application step.'
                        : 'New knowledge key point',
                  expectedResourceRevisions: [
                    {
                      resourceId: selectedModule.id,
                      revisionNumber: selectedModule.revision,
                    },
                  ],
                });
              }}
            />
          ) : (
            <ReadinessPane
              draft={draft}
              publishDisabled={publishDisabled}
              onOpenPublish={() => setPublishOpen(true)}
              onJump={(path) => {
                if (path.includes('branding')) chooseResource('branding');
                else if (path.includes('modules')) chooseResource('modules');
                else if (path.includes('intake')) chooseResource('intake');
                else chooseResource('translations');
              }}
            />
          )}
        </aside>
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
                  publishDisabled ||
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

function EditorPane(props: {
  resource: ResourceKey;
  draft: Draft;
  branding: Candidate['workspace']['branding'];
  selectedModule?: LearningModule;
  saveState: string;
  conflict: boolean;
  comparison?: Draft['comparisons'][number];
  onReload(): void;
  onRestore(resourceId: string, revisionNumber: number): void;
  onDiscard(resourceId: string, revisionNumber: number): void;
  onPatchBranding(patch: Partial<BrandingFields>): void;
  onPatchModule(patch: Partial<ModuleFields>): void;
  onPatchItem(item: ModuleItem, patch: Partial<ItemFields>): void;
  onReorder(collection: Collection, orderedResourceIds: string[]): void;
  onCreateItem(collection: Collection): void;
}) {
  const branding = props.branding;
  const module = props.selectedModule;
  const comparison = props.comparison;
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
        Selected resource
      </p>
      <h2 className="mt-1 text-2xl font-bold text-slate-900">
        {props.resource === 'branding'
          ? 'Workspace Branding'
          : props.resource === 'modules'
            ? 'Learning Module'
            : props.resource === 'intake'
              ? 'Intake Form'
              : 'Managed Translations'}
      </h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        {props.saveState} Active Students remain on the active release
        {props.draft.activeReleaseNumber
          ? ` ${props.draft.activeReleaseNumber}`
          : ''}
        .
      </p>
      {props.conflict ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-bold">Stale write blocked</p>
          <p className="mt-1 text-xs leading-5">
            Compare with the current shared draft or the active revision, then
            reload. Autosave will not overwrite another Administrator.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={props.onReload}
              className="rounded-lg bg-white px-3 py-2 text-xs font-bold"
            >
              Compare
            </button>
            <button
              type="button"
              onClick={props.onReload}
              className="rounded-lg bg-white px-3 py-2 text-xs font-bold"
            >
              Reload shared draft
            </button>
          </div>
        </div>
      ) : null}
      {comparison ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <p>
            Draft revision {comparison.draftRevision}
            {comparison.activeRevision
              ? ` · active revision ${comparison.activeRevision}`
              : ' · never published'}
            {comparison.differs ? ' · differs from active' : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {comparison.activeRevision ? (
              <button
                type="button"
                onClick={() =>
                  props.onRestore(comparison.resourceId, comparison.draftRevision)
                }
                className="rounded-lg border bg-white px-3 py-1.5 font-bold"
              >
                Restore active revision
              </button>
            ) : null}
            {comparison.discardEligible ? (
              <button
                type="button"
                onClick={() =>
                  props.onDiscard(comparison.resourceId, comparison.draftRevision)
                }
                className="rounded-lg border bg-white px-3 py-1.5 font-bold"
              >
                Discard never-published
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {props.resource === 'branding' ? (
        <div className="mt-6 space-y-4">
          <label className="block text-sm font-bold">
            School display name
            <input
              defaultValue={localized(branding.displayName, 'en-US')}
              onChange={(event) =>
                props.onPatchBranding({ displayName: event.target.value })
              }
              className="mt-2 w-full rounded-xl border px-3 py-2"
            />
          </label>
          <label className="block text-sm font-bold">
            Short name
            <input
              defaultValue={localized(branding.shortName, 'en-US')}
              onChange={(event) =>
                props.onPatchBranding({ shortName: event.target.value })
              }
              className="mt-2 w-full rounded-xl border px-3 py-2"
            />
          </label>
          <label className="block text-sm font-bold">
            Generated text mark
            <input
              defaultValue={branding.generatedTextMark}
              maxLength={4}
              onChange={(event) =>
                props.onPatchBranding({ generatedTextMark: event.target.value })
              }
              className="mt-2 w-full rounded-xl border px-3 py-2"
            />
          </label>
          <label className="block text-sm font-bold">
            Primary color
            <input
              type="color"
              defaultValue={branding.primaryColor}
              onChange={(event) =>
                props.onPatchBranding({ primaryColor: event.target.value })
              }
              className="mt-2 h-12 w-20 rounded-lg border bg-white p-1"
            />
          </label>
          <label className="block text-sm font-bold">
            Accent color
            <input
              type="color"
              defaultValue={branding.accentColor}
              onChange={(event) =>
                props.onPatchBranding({ accentColor: event.target.value })
              }
              className="mt-2 h-12 w-20 rounded-lg border bg-white p-1"
            />
          </label>
        </div>
      ) : null}

      {props.resource === 'modules' && module ? (
        <div className="mt-6 space-y-4">
          <p className="text-xs text-slate-500">Stable ID: {module.id}</p>
          <label className="block text-sm font-bold">
            English title
            <input
              defaultValue={localized(module.title, 'en-US')}
              onChange={(event) =>
                props.onPatchModule({ title: event.target.value })
              }
              className="mt-2 w-full rounded-xl border px-3 py-2"
            />
          </label>
          <label className="block text-sm font-bold">
            English summary
            <textarea
              defaultValue={localized(module.description, 'en-US')}
              rows={3}
              onChange={(event) =>
                props.onPatchModule({ description: event.target.value })
              }
              className="mt-2 w-full rounded-xl border px-3 py-2"
            />
          </label>
          <label className="block text-sm font-bold">
            Knowledge introduction
            <textarea
              defaultValue={localized(module.knowledgeIntroduction, 'en-US')}
              rows={3}
              onChange={(event) =>
                props.onPatchModule({
                  knowledgeIntroduction: event.target.value,
                })
              }
              className="mt-2 w-full rounded-xl border px-3 py-2"
            />
          </label>
          {(['knowledgeItems', 'skillItems', 'applicationItems'] as const).map(
            (collection) => (
              <section key={collection} className="rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <strong className="text-sm">
                    {collection === 'knowledgeItems'
                      ? 'Knowledge'
                      : collection === 'skillItems'
                        ? 'Skills'
                        : 'Application'}
                  </strong>
                  <button
                    type="button"
                    onClick={() => props.onCreateItem(collection)}
                    className="text-xs font-bold text-emerald-800"
                  >
                    Add item
                  </button>
                </div>
                <div className="mt-3 grid gap-2">
                  {module[collection].map((item, index) => (
                    <div key={item.id} className="rounded-lg bg-slate-50 p-2">
                      <textarea
                        defaultValue={localized(item.text, 'en-US')}
                        rows={2}
                        onChange={(event) =>
                          props.onPatchItem(item, { text: event.target.value })
                        }
                        className="w-full rounded-lg border px-2 py-1 text-sm"
                      />
                      {collection === 'applicationItems' ? (
                        <input
                          defaultValue={item.href ?? ''}
                          placeholder="https://"
                          onChange={(event) =>
                            props.onPatchItem(item, {
                              href: event.target.value || null,
                            })
                          }
                          className="mt-1 w-full rounded-lg border px-2 py-1 text-sm"
                        />
                      ) : null}
                      <div className="mt-1 flex gap-2">
                        {index > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              const ids = module[collection].map(
                                (entry) => entry.id,
                              );
                              const previous = ids[index - 1];
                              const currentId = ids[index];
                              if (!previous || !currentId) return;
                              ids[index - 1] = currentId;
                              ids[index] = previous;
                              props.onReorder(collection, ids);
                            }}
                            className="text-xs font-bold"
                          >
                            Move up
                          </button>
                        ) : null}
                        {props.draft.comparisons.find(
                          (itemComparison) =>
                            itemComparison.resourceId === item.id,
                        )?.discardEligible ? (
                          <button
                            type="button"
                            onClick={() =>
                              props.onDiscard(item.id, item.revision)
                            }
                            className="text-xs font-bold"
                          >
                            Discard
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      ) : null}

      {props.resource === 'intake' ? (
        <p className="mt-6 rounded-xl bg-violet-50 p-4 text-sm text-violet-950">
          Intake Form authoring is not part of this slice. Preview the current
          candidate with synthetic answers. Students remain on the active
          release.
        </p>
      ) : null}

      {props.resource === 'translations' ? (
        <p className="mt-6 rounded-xl bg-sky-50 p-4 text-sm text-sky-950">
          Managed Translation generation and review are not part of this slice.
          Linked readiness results still show missing or stale locale work that
          blocks publication.
        </p>
      ) : null}
    </div>
  );
}

function ReadinessPane(props: {
  draft: Draft;
  publishDisabled: boolean;
  onOpenPublish(): void;
  onJump(path: string): void;
}) {
  const blockers = props.draft.validation.blockers;
  const warnings = props.draft.validation.warnings;
  return (
    <div>
      <div className="rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 p-5 text-white shadow-lg">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-100">
          Release candidate
        </p>
        <div className="mt-3 flex items-end justify-between">
          <strong className="text-4xl">{blockers.length}</strong>
          <span className="pb-1 text-xs text-emerald-100">blocking checks</span>
        </div>
        <p className="mt-3 text-xs leading-5 text-emerald-100">
          Warnings remain visible but do not prevent publication. Administrators
          cannot override blockers.
        </p>
      </div>
      <div className="mt-5 space-y-2">
        {blockers.length === 0 ? (
          <p className="rounded-xl border border-emerald-100 p-3 text-sm font-bold">
            No publication blockers for branding, content, or constrained
            safety checks.
          </p>
        ) : (
          blockers.map((blocker) => (
            <button
              key={`${blocker.code}:${blocker.path}`}
              type="button"
              onClick={() => props.onJump(blocker.path)}
              className="block w-full rounded-xl border border-rose-100 bg-rose-50 p-3 text-left text-sm"
            >
              <strong className="text-rose-900">{blocker.code}</strong>
              <span className="mt-1 block text-xs text-rose-800">
                {blocker.message}
              </span>
              <span className="mt-1 block font-mono text-[11px] text-rose-700">
                {blocker.path}
              </span>
            </button>
          ))
        )}
        {warnings.map((warning) => (
          <p
            key={`${warning.code}:${warning.path}`}
            className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900"
          >
            <strong>{warning.code}:</strong> {warning.message}
          </p>
        ))}
      </div>
      <button
        type="button"
        disabled={props.publishDisabled}
        onClick={props.onOpenPublish}
        className="mt-6 w-full rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {props.draft.unpublishedChanges
          ? blockers.length
            ? `Resolve ${blockers.length} blockers`
            : 'Review release and publish'
          : 'Release is current'}
      </button>
    </div>
  );
}
