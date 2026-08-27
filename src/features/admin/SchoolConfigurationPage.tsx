import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  evaluateIntakePreview,
  isChoiceIntakeFieldType,
  selectedIntakeOptionCodes,
} from '../../../modules/intake-answers/index.ts';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';
import type { paths } from '../../../packages/api-client/src/schema.ts';

const client = createBrowserApiClient();
const locales = ['en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'] as const;
type Locale = (typeof locales)[number];
type ManagedLocale = Exclude<Locale, 'en-US'>;
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
    intakeForm: IntakeForm;
    submissionAttestation: {
      id: string;
      revision: number;
      text: LocalizedValue;
    };
  };
};
type Draft = Omit<DraftResponse, 'candidate'> & { candidate: Candidate };
type ReadinessLocation = Draft['validation']['blockers'][number]['location'];
type ReleaseSummary =
  paths['/api/v1/administration/school-configuration/releases']['get']['responses']['200']['content']['application/json']['releases'][number];
type ReleaseDetail =
  paths['/api/v1/administration/school-configuration/releases/{releaseId}']['get']['responses']['200']['content']['application/json'];
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
type IntakeOption = {
  id: string;
  revision: number;
  code: string;
  label: LocalizedValue;
};
type IntakeField = {
  id: string;
  revision: number;
  key: string;
  sectionId: string;
  type: string;
  required: boolean;
  requiredWhenVisible: boolean;
  label: LocalizedValue;
  helpText?: LocalizedValue;
  visibility: { fieldId: string; equalsOptionCode: string } | null;
  options?: IntakeOption[];
};
type IntakeSection = {
  id: string;
  revision: number;
  title: LocalizedValue;
};
type IntakeForm = {
  id: string;
  revision: number;
  title: LocalizedValue;
  sections: IntakeSection[];
  fields: IntakeField[];
};
type IntakeFormFields = { title: string; attestation: string };
type IntakeSectionFields = { title: string };
type IntakeFieldFields = {
  label: string;
  helpText: string;
  fieldType: string;
  required: boolean;
  requiredWhenVisible: boolean;
  sectionId: string;
  visibilityFieldId: string;
  visibilityOptionCode: string;
};
type IntakeOptionFields = { code: string; label: string };
type ManagedTranslationItem = Draft['managedTranslations']['items'][number];
type LocalizedEntry = {
  id?: string;
  revision?: number;
  value?: string;
  origin?: string;
  reviewer?: string;
  reviewedAt?: string;
  generation?: {
    adapter?: string;
    adapterVersion?: string;
    model?: string;
    glossaryRevision?: string;
    generatedAt?: string;
  };
};

const managedLocaleLabels: Record<ManagedLocale, string> = {
  'es-US': 'Spanish',
  'pt-BR': 'Portuguese',
  'fr-CA': 'French',
  'ht-HT': 'Haitian Creole',
};

const translationKindLabels: Record<ManagedTranslationItem['kind'], string> = {
  interface_string: 'Interface',
  learning_module_field: 'Learning',
  intake_question: 'Intake',
  intake_answer_option: 'Answer option',
};

const intakeFieldTypeOptions = [
  ['text', 'Short text'],
  ['textarea', 'Long text'],
  ['date', 'Date'],
  ['tel', 'Phone'],
  ['email', 'Email'],
  ['yes-no', 'Yes / no'],
  ['single-choice', 'Single choice'],
  ['multiple-choice', 'Multiple choice'],
  ['acknowledgement', 'Required acknowledgement'],
] as const;

function localized(value: LocalizedValue | undefined, locale: Locale): string {
  return value?.[locale]?.value ?? value?.['en-US']?.value ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findLocalizedMap(
  value: unknown,
  sourceResourceId: string,
): Record<string, LocalizedEntry> | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findLocalizedMap(child, sourceResourceId);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const english = value['en-US'];
  if (
    isRecord(english) &&
    typeof english.id === 'string' &&
    english.id === sourceResourceId
  ) {
    return value as Record<string, LocalizedEntry>;
  }
  for (const child of Object.values(value)) {
    const found = findLocalizedMap(child, sourceResourceId);
    if (found) return found;
  }
  return undefined;
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

function intakeFormFieldsFrom(
  form: IntakeForm,
  attestation: Candidate['release']['submissionAttestation'],
): IntakeFormFields {
  return {
    title: localized(form.title, 'en-US'),
    attestation: localized(attestation.text, 'en-US'),
  };
}

function sameIntakeForm(left: IntakeFormFields, right: IntakeFormFields): boolean {
  return left.title === right.title && left.attestation === right.attestation;
}

function intakeSectionFieldsFrom(section: IntakeSection): IntakeSectionFields {
  return { title: localized(section.title, 'en-US') };
}

function sameIntakeSection(
  left: IntakeSectionFields,
  right: IntakeSectionFields,
): boolean {
  return left.title === right.title;
}

function intakeFieldFieldsFrom(field: IntakeField): IntakeFieldFields {
  return {
    label: localized(field.label, 'en-US'),
    helpText: localized(field.helpText, 'en-US'),
    fieldType: field.type,
    required: field.required,
    requiredWhenVisible: field.requiredWhenVisible,
    sectionId: field.sectionId,
    visibilityFieldId: field.visibility?.fieldId ?? '',
    visibilityOptionCode: field.visibility?.equalsOptionCode ?? '',
  };
}

function sameIntakeField(
  left: IntakeFieldFields,
  right: IntakeFieldFields,
): boolean {
  return (
    left.label === right.label &&
    left.helpText === right.helpText &&
    left.fieldType === right.fieldType &&
    left.required === right.required &&
    left.requiredWhenVisible === right.requiredWhenVisible &&
    left.sectionId === right.sectionId &&
    left.visibilityFieldId === right.visibilityFieldId &&
    left.visibilityOptionCode === right.visibilityOptionCode
  );
}

function intakeOptionFieldsFrom(option: IntakeOption): IntakeOptionFields {
  return {
    code: option.code,
    label: localized(option.label, 'en-US'),
  };
}

function sameIntakeOption(
  left: IntakeOptionFields,
  right: IntakeOptionFields,
): boolean {
  return left.code === right.code && left.label === right.label;
}

function visibilityFrom(fields: IntakeFieldFields): {
  fieldId: string;
  equalsOptionCode: string;
} | null {
  if (!fields.visibilityFieldId || !fields.visibilityOptionCode) return null;
  return {
    fieldId: fields.visibilityFieldId,
    equalsOptionCode: fields.visibilityOptionCode,
  };
}

function asDraft(value: DraftResponse): Draft {
  return value as Draft;
}

function isVisibleAssemblyComparison(comparison: { kind: string }): boolean {
  return ![
    'displayName',
    'shortName',
    'title',
    'label',
    'text',
    'helpText',
    'knowledgeIntroduction',
    'description',
  ].includes(comparison.kind);
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
  const [syntheticAnswers, setSyntheticAnswers] = useState<
    Record<string, string>
  >({});
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishStage, setPublishStage] = useState<'review' | 'confirm'>(
    'review',
  );
  const [credentialsRequired, setCredentialsRequired] = useState(false);
  const [changeDescription, setChangeDescription] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [selectedRelease, setSelectedRelease] = useState<ReleaseDetail>();
  const [readinessTarget, setReadinessTarget] = useState<string>();
  const [authorityName, setAuthorityName] = useState('');
  const [status, setStatus] = useState('Loading the shared draft...');
  const [saveState, setSaveState] = useState('Saved to the shared draft.');
  const [conflict, setConflict] = useState(false);
  const operationId = useRef(crypto.randomUUID());
  const initializationOperationId = useRef(crypto.randomUUID());
  const saveOperationId = useRef(crypto.randomUUID());
  const generateOperationId = useRef(crypto.randomUUID());
  const saveTimer = useRef<number | undefined>(undefined);
  const saveInFlight = useRef(false);
  const saveAgain = useRef(false);
  const brandingEdits = useRef<BrandingFields | undefined>(undefined);
  const moduleEdits = useRef(new Map<string, ModuleFields>());
  const itemEdits = useRef(new Map<string, ItemFields>());
  const intakeFormEdits = useRef<IntakeFormFields | undefined>(undefined);
  const intakeSectionEdits = useRef(new Map<string, IntakeSectionFields>());
  const intakeFieldEdits = useRef(new Map<string, IntakeFieldFields>());
  const intakeOptionEdits = useRef(new Map<string, IntakeOptionFields>());
  const [editorEpoch, setEditorEpoch] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function resetEditorBuffers() {
    brandingEdits.current = undefined;
    moduleEdits.current = new Map();
    itemEdits.current = new Map();
    intakeFormEdits.current = undefined;
    intakeSectionEdits.current = new Map();
    intakeFieldEdits.current = new Map();
    intakeOptionEdits.current = new Map();
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
    void loadReleases();
    try {
      const session = await client.GET('/api/v1/staff/session');
      if (session.response.status === 200 && session.data) {
        setAuthorityName(session.data.displayName);
      }
    } catch {
      setAuthorityName('');
    }
  }

  async function loadReleases() {
    try {
      const listed = await client.GET(
        '/api/v1/administration/school-configuration/releases',
      );
      if (listed.response.status === 200 && listed.data) {
        setReleases(listed.data.releases);
      }
    } catch {
      setReleases([]);
    }
  }

  async function loadRelease(releaseId: string) {
    try {
      const detail = await client.GET(
        '/api/v1/administration/school-configuration/releases/{releaseId}',
        { params: { path: { releaseId } } },
      );
      if (detail.response.status === 200 && detail.data) {
        setSelectedRelease(detail.data);
      }
    } catch {
      setStatus(
        'That School Configuration Release could not be loaded. Retry this review.',
      );
    }
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

  async function generateTranslations(
    locale: ManagedLocale,
    sourceResourceIds?: string[],
  ): Promise<boolean> {
    const current = draftRef.current;
    if (!current) return false;
    setSaveState('Generating Managed Translations...');
    setConflict(false);
    try {
      const result = await client.POST(
        '/api/v1/administration/school-configuration/managed-translation-generations',
        {
          body: {
            operationId: generateOperationId.current,
            expectedDraftVersion: current.draftVersion,
            locale,
            ...(sourceResourceIds && sourceResourceIds.length > 0
              ? { sourceResourceIds }
              : {}),
          },
        },
      );
      if (result.response.status === 200 && result.data) {
        generateOperationId.current = crypto.randomUUID();
        const next = asDraft(result.data);
        draftRef.current = next;
        setDraft(next);
        const rejected = result.data.rejected.length;
        setSaveState(
          rejected > 0
            ? `${rejected} generated segments failed safety checks and were not written.`
            : 'Generated suggestions saved as unreviewed draft text.',
        );
        return true;
      }
      const problem = result.error as Problem | undefined;
      if (
        problem?.code === 'RESOURCE_REVISION_CONFLICT' ||
        problem?.code === 'DRAFT_VERSION_CONFLICT'
      ) {
        setConflict(true);
        setSaveState(
          'Another Administrator changed this resource. Compare or reload before generating again.',
        );
        return false;
      }
      setSaveState(
        problem?.code === 'TRANSLATION_PROVIDER_UNAVAILABLE'
          ? 'Managed Translation generation is unavailable.'
          : 'Generation could not finish. Retry keeps this operation until the service recovers.',
      );
      return false;
    } catch {
      setSaveState(
        'Generation failed. Retry keeps this operation until the service recovers.',
      );
      return false;
    }
  }

  async function saveManagedTranslation(
    item: ManagedTranslationItem,
    text: string,
  ): Promise<boolean> {
    const current = draftRef.current;
    if (!current) return false;
    const map = findLocalizedMap(current.candidate, item.sourceResourceId);
    const translation = map?.[item.locale];
    return editDraft({
      type: 'save-managed-translation',
      resourceId: item.sourceResourceId,
      locale: item.locale,
      text,
      expectedResourceRevisions:
        translation?.id && typeof translation.revision === 'number'
          ? [
              {
                resourceId: translation.id,
                revisionNumber: translation.revision,
              },
            ]
          : [],
    });
  }

  async function reviewManagedTranslation(
    item: ManagedTranslationItem,
    text?: string,
  ): Promise<boolean> {
    const current = draftRef.current;
    if (!current) return false;
    const map = findLocalizedMap(current.candidate, item.sourceResourceId);
    const existing = map?.[item.locale]?.value ?? '';
    if (text !== undefined && text !== existing) {
      const saved = await saveManagedTranslation(item, text);
      if (!saved) return false;
    }
    const latest = draftRef.current;
    if (!latest) return false;
    const translation = findLocalizedMap(
      latest.candidate,
      item.sourceResourceId,
    )?.[item.locale];
    if (!translation?.id || typeof translation.revision !== 'number') {
      setSaveState(
        'Generate or save this translation before marking it reviewed.',
      );
      return false;
    }
    return editDraft({
      type: 'review-managed-translation',
      resourceId: item.sourceResourceId,
      locale: item.locale,
      expectedResourceRevisions: [
        {
          resourceId: translation.id,
          revisionNumber: translation.revision,
        },
      ],
    });
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
        if (intakeFormEdits.current) {
          const latest = draftRef.current;
          if (!latest) return;
          const sent = { ...intakeFormEdits.current };
          const form = latest.candidate.release.intakeForm;
          const attestation = latest.candidate.release.submissionAttestation;
          const saved = await editDraft({
            type: 'save-intake-form',
            resourceId: form.id,
            expectedResourceRevisions: [
              { resourceId: form.id, revisionNumber: form.revision },
              {
                resourceId: attestation.id,
                revisionNumber: attestation.revision,
              },
            ],
            title: sent.title,
            text: sent.attestation,
          });
          if (!saved) return;
          if (
            intakeFormEdits.current &&
            sameIntakeForm(intakeFormEdits.current, sent)
          ) {
            intakeFormEdits.current = undefined;
          }
        }
        for (const [resourceId, fields] of [
          ...intakeSectionEdits.current.entries(),
        ]) {
          const latest = draftRef.current;
          const section = latest?.candidate.release.intakeForm.sections.find(
            (item) => item.id === resourceId,
          );
          if (!latest || !section) {
            intakeSectionEdits.current.delete(resourceId);
            continue;
          }
          const sent = { ...fields };
          const saved = await editDraft({
            type: 'save-intake-section',
            resourceId,
            expectedResourceRevisions: [
              { resourceId, revisionNumber: section.revision },
            ],
            title: sent.title,
          });
          if (!saved) return;
          const pending = intakeSectionEdits.current.get(resourceId);
          if (pending && sameIntakeSection(pending, sent)) {
            intakeSectionEdits.current.delete(resourceId);
          }
        }
        for (const [resourceId, fields] of [
          ...intakeFieldEdits.current.entries(),
        ]) {
          const latest = draftRef.current;
          const field = latest?.candidate.release.intakeForm.fields.find(
            (item) => item.id === resourceId,
          );
          if (!latest || !field) {
            intakeFieldEdits.current.delete(resourceId);
            continue;
          }
          const sent = { ...fields };
          const saved = await editDraft({
            type: 'save-intake-field',
            resourceId,
            expectedResourceRevisions: [
              { resourceId, revisionNumber: field.revision },
            ],
            sectionId: sent.sectionId,
            fieldType: sent.fieldType,
            label: sent.label,
            helpText: sent.helpText || null,
            required: sent.required,
            requiredWhenVisible: sent.requiredWhenVisible,
            visibility: visibilityFrom(sent),
          });
          if (!saved) return;
          const pending = intakeFieldEdits.current.get(resourceId);
          if (pending && sameIntakeField(pending, sent)) {
            intakeFieldEdits.current.delete(resourceId);
          }
        }
        for (const [resourceId, fields] of [
          ...intakeOptionEdits.current.entries(),
        ]) {
          const latest = draftRef.current;
          const option = latest
            ? latest.candidate.release.intakeForm.fields
                .flatMap((field) => field.options ?? [])
                .find((entry) => entry.id === resourceId)
            : undefined;
          if (!latest || !option) {
            intakeOptionEdits.current.delete(resourceId);
            continue;
          }
          const sent = { ...fields };
          const saved = await editDraft({
            type: 'save-intake-option',
            resourceId,
            expectedResourceRevisions: [
              { resourceId, revisionNumber: option.revision },
            ],
            code: sent.code,
            label: sent.label,
          });
          if (!saved) return;
          const pending = intakeOptionEdits.current.get(resourceId);
          if (pending && sameIntakeOption(pending, sent)) {
            intakeOptionEdits.current.delete(resourceId);
          }
        }
      } while (
        saveAgain.current ||
        brandingEdits.current ||
        moduleEdits.current.size > 0 ||
        itemEdits.current.size > 0 ||
        intakeFormEdits.current ||
        intakeSectionEdits.current.size > 0 ||
        intakeFieldEdits.current.size > 0 ||
        intakeOptionEdits.current.size > 0
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

  function patchIntakeForm(patch: Partial<IntakeFormFields>) {
    const current = draftRef.current;
    if (!current) return;
    intakeFormEdits.current = {
      ...(intakeFormEdits.current ??
        intakeFormFieldsFrom(
          current.candidate.release.intakeForm,
          current.candidate.release.submissionAttestation,
        )),
      ...patch,
    };
    queueSave();
  }

  function patchIntakeSection(
    section: IntakeSection,
    patch: Partial<IntakeSectionFields>,
  ) {
    intakeSectionEdits.current.set(section.id, {
      ...(intakeSectionEdits.current.get(section.id) ??
        intakeSectionFieldsFrom(section)),
      ...patch,
    });
    queueSave();
  }

  function patchIntakeField(
    field: IntakeField,
    patch: Partial<IntakeFieldFields>,
  ) {
    intakeFieldEdits.current.set(field.id, {
      ...(intakeFieldEdits.current.get(field.id) ??
        intakeFieldFieldsFrom(field)),
      ...patch,
    });
    queueSave();
  }

  function patchIntakeOption(
    option: IntakeOption,
    patch: Partial<IntakeOptionFields>,
  ) {
    intakeOptionEdits.current.set(option.id, {
      ...(intakeOptionEdits.current.get(option.id) ??
        intakeOptionFieldsFrom(option)),
      ...patch,
    });
    queueSave();
  }

  useEffect(() => {
    void loadDraft();
    return () => window.clearTimeout(saveTimer.current);
  }, []);

  useEffect(() => {
    if (!readinessTarget) return;
    const target = document.querySelector(
      `[data-readiness-target="${readinessTarget}"]`,
    );
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center' });
      target.focus({ preventScroll: true });
    }
  }, [readinessTarget, resource, inspectorTab, moduleId, locale]);

  function openPublishReview() {
    setPublishStage('review');
    setCredentialsRequired(false);
    setPassword('');
    setTotp('');
    setPublishOpen(true);
  }

  async function activatePublication() {
    if (!draft) return;
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
      setPublishStage('review');
      setCredentialsRequired(false);
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
      setPublishStage('confirm');
      setCredentialsRequired(true);
      setStatus(
        'Authentication freshness expired. Confirm both factors again; this review is preserved.',
      );
    } else if (problem?.code === 'INVALID_SCHOOL_CONFIGURATION') {
      setStatus(
        problem.affectedValue === 'unpublishedChanges'
          ? 'This draft matches the active release. Publication requires unpublished changes.'
          : 'Publication failed without activation. Resolve readiness results and retry this review.',
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

  async function publish() {
    if (!draft) return;
    if (credentialsRequired) {
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
          setStatus(
            'Authentication could not be refreshed. Retry this review.',
          );
        }
        return;
      }
    }
    await activatePublication();
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
      : resource === 'intake'
        ? comparison.resourceId === candidate.release.intakeForm.id
        : comparison.resourceId === selectedModule?.id,
  );
  const changedComparisons = draft.comparisons.filter(
    (comparison) => comparison.change !== 'unchanged',
  );
  const structuralComparisons = changedComparisons.filter(
    isVisibleAssemblyComparison,
  );
  const localizedChangeCount =
    changedComparisons.length - structuralComparisons.length;
  const previewScreen =
    resource === 'branding' || resource === 'translations'
      ? 'home'
      : resource === 'intake'
        ? 'intake'
        : 'module';
  const previewLocaleWork =
    locale === 'en-US'
      ? undefined
      : draft.managedTranslations.locales.find((item) => item.locale === locale);
  const intakePreview = evaluateIntakePreview(
    candidate.release.intakeForm.fields.map((field) => ({
      id: field.id,
      type: field.type,
      required: field.required,
      requiredWhenVisible: field.requiredWhenVisible,
      visibility: field.visibility,
      options: field.options ?? [],
    })),
    syntheticAnswers,
  );
  const visibleIntakeFields = candidate.release.intakeForm.fields.filter(
    (field) => intakePreview.visibleFieldIds.includes(field.id),
  );

  function setSyntheticAnswer(fieldId: string, value: string) {
    const next = evaluateIntakePreview(
      candidate.release.intakeForm.fields.map((field) => ({
        id: field.id,
        type: field.type,
        required: field.required,
        requiredWhenVisible: field.requiredWhenVisible,
        visibility: field.visibility,
        options: field.options ?? [],
      })),
      { ...syntheticAnswers, [fieldId]: value },
    );
    setSyntheticAnswers(next.answers);
  }

  function chooseResource(next: ResourceKey) {
    setResource(next);
    setInspectorTab('edit');
    setMobileSurface('edit');
  }

  function jumpTo(
    location: ReadinessLocation,
    surface: 'edit' | 'preview' = 'edit',
  ) {
    setResource(location.editorResource);
    if (location.moduleId) setModuleId(location.moduleId);
    if (location.locale) setLocale(location.locale);
    setReadinessTarget(
      surface === 'preview' && location.previewScreen === 'module'
        ? location.moduleId
        : location.resourceId ?? location.moduleId,
    );
    if (surface === 'preview') {
      setMobileSurface('preview');
      return;
    }
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
              onClick={openPublishReview}
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
              {previewLocaleWork ? (
                <p className="mt-2 text-xs leading-5 text-amber-900">
                  Previewing draft {locale} translations. Students still see the
                  active release.
                  {previewLocaleWork.stale > 0
                    ? ` ${previewLocaleWork.stale} stale.`
                    : ''}
                  {previewLocaleWork.generated > 0
                    ? ` ${previewLocaleWork.generated} generated and unreviewed.`
                    : ''}
                  {previewLocaleWork.missing > 0
                    ? ` ${previewLocaleWork.missing} missing, so English is shown.`
                    : ''}
                </p>
              ) : null}
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
                <div data-readiness-target={branding.id} tabIndex={-1}>
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
                </div>
              ) : previewScreen === 'module' && selectedModule ? (
                <div
                  data-readiness-target={selectedModule.id}
                  tabIndex={-1}
                >
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
                </div>
              ) : (
                <div
                  data-readiness-target={candidate.release.intakeForm.id}
                  tabIndex={-1}
                >
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-700">
                    Synthetic Intake preview
                  </p>
                  <h3 className="mt-2 text-3xl font-black">
                    {localized(candidate.release.intakeForm.title, locale)}
                  </h3>
                  <p className="mt-4 text-slate-600">
                    Visibility rules use synthetic answers only. Hidden answers
                    are omitted. No Intake Draft or Intake Record is loaded.
                  </p>
                  <div className="mt-5 grid gap-4">
                    {candidate.release.intakeForm.sections.map((section) => {
                      const fields = visibleIntakeFields.filter(
                        (field) => field.sectionId === section.id,
                      );
                      if (fields.length === 0) return null;
                      return (
                        <section key={section.id} className="grid gap-2">
                          <h4 className="text-lg font-black">
                            {localized(section.title, locale)}
                          </h4>
                          {fields.map((field) => {
                            const required =
                              intakePreview.requiredFieldIds.includes(field.id);
                            const value = intakePreview.answers[field.id] ?? '';
                            return (
                              <div
                                key={field.id}
                                className="rounded-lg border bg-white p-3"
                                data-readiness-target={field.id}
                                tabIndex={-1}
                              >
                                <p className="text-sm font-bold">
                                  {localized(field.label, locale)}
                                  {required ? ' · required' : ''}
                                </p>
                                {field.helpText ? (
                                  <p className="mt-1 text-xs text-slate-500">
                                    {localized(field.helpText, locale)}
                                  </p>
                                ) : null}
                                {isChoiceIntakeFieldType(field.type) ? (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {(field.options ?? []).map((option) => {
                                      const selected =
                                        field.type === 'multiple-choice'
                                          ? selectedIntakeOptionCodes(
                                              value,
                                            ).includes(option.code)
                                          : value === option.code;
                                      return (
                                        <button
                                          type="button"
                                          key={option.id}
                                          onClick={() => {
                                            if (field.type === 'multiple-choice') {
                                              const codes =
                                                selectedIntakeOptionCodes(value);
                                              const next = codes.includes(
                                                option.code,
                                              )
                                                ? codes.filter(
                                                    (code) =>
                                                      code !== option.code,
                                                  )
                                                : [...codes, option.code];
                                              setSyntheticAnswer(
                                                field.id,
                                                next.join(','),
                                              );
                                              return;
                                            }
                                            setSyntheticAnswer(
                                              field.id,
                                              option.code,
                                            );
                                          }}
                                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                                            selected
                                              ? 'bg-emerald-700 text-white'
                                              : 'bg-slate-100'
                                          }`}
                                        >
                                          {localized(option.label, locale)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : field.type === 'acknowledgement' ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSyntheticAnswer(
                                        field.id,
                                        value === 'yes' ? '' : 'yes',
                                      )
                                    }
                                    className={`mt-2 rounded-full px-3 py-1 text-xs font-bold ${
                                      value === 'yes'
                                        ? 'bg-emerald-700 text-white'
                                        : 'bg-slate-100'
                                    }`}
                                  >
                                    {value === 'yes'
                                      ? 'Acknowledged'
                                      : 'Synthetic acknowledge'}
                                  </button>
                                ) : (
                                  <input
                                    value={value}
                                    placeholder="Synthetic answer"
                                    onChange={(event) =>
                                      setSyntheticAnswer(
                                        field.id,
                                        event.target.value,
                                      )
                                    }
                                    className="mt-2 w-full rounded-lg border px-2 py-1 text-sm"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </section>
                      );
                    })}
                  </div>
                  <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                    {localized(
                      candidate.release.submissionAttestation.text,
                      locale,
                    )}
                  </div>
                </div>
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
              onArchive={(resourceId, revisionNumber) =>
                void editDraft({
                  type: 'archive-authored-resource',
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
              onPatchIntakeForm={patchIntakeForm}
              onPatchIntakeSection={patchIntakeSection}
              onPatchIntakeField={patchIntakeField}
              onPatchIntakeOption={patchIntakeOption}
              onReorderIntake={(kind, orderedResourceIds, fieldId) => {
                const form = candidate.release.intakeForm;
                if (kind === 'sections') {
                  void editDraft({
                    type: 'reorder-intake-sections',
                    orderedResourceIds,
                    expectedResourceRevisions: [
                      { resourceId: form.id, revisionNumber: form.revision },
                      ...form.sections.map((section) => ({
                        resourceId: section.id,
                        revisionNumber: section.revision,
                      })),
                    ],
                  });
                  return;
                }
                if (kind === 'fields') {
                  void editDraft({
                    type: 'reorder-intake-fields',
                    orderedResourceIds,
                    expectedResourceRevisions: [
                      { resourceId: form.id, revisionNumber: form.revision },
                      ...form.fields.map((field) => ({
                        resourceId: field.id,
                        revisionNumber: field.revision,
                      })),
                    ],
                  });
                  return;
                }
                const field = form.fields.find((item) => item.id === fieldId);
                if (!field) return;
                void editDraft({
                  type: 'reorder-intake-options',
                  fieldId: field.id,
                  orderedResourceIds,
                  expectedResourceRevisions: [
                    { resourceId: field.id, revisionNumber: field.revision },
                    ...(field.options ?? []).map((option) => ({
                      resourceId: option.id,
                      revisionNumber: option.revision,
                    })),
                  ],
                });
              }}
              onCreateIntakeSection={() =>
                void editDraft({
                  type: 'create-intake-section',
                  title: 'New section',
                  expectedResourceRevisions: [
                    {
                      resourceId: candidate.release.intakeForm.id,
                      revisionNumber: candidate.release.intakeForm.revision,
                    },
                  ],
                })
              }
              onCreateIntakeField={(sectionId, fieldType) =>
                void editDraft({
                  type: 'create-intake-field',
                  sectionId,
                  fieldType,
                  label:
                    fieldType === 'acknowledgement'
                      ? 'I confirm this information'
                      : 'New question',
                  expectedResourceRevisions: [
                    {
                      resourceId: candidate.release.intakeForm.id,
                      revisionNumber: candidate.release.intakeForm.revision,
                    },
                  ],
                })
              }
              onCreateIntakeOption={(fieldId) => {
                const field = candidate.release.intakeForm.fields.find(
                  (item) => item.id === fieldId,
                );
                if (!field) return;
                void editDraft({
                  type: 'create-intake-option',
                  fieldId,
                  code: `option-${(field.options?.length ?? 0) + 1}`,
                  label: 'New option',
                  expectedResourceRevisions: [
                    { resourceId: field.id, revisionNumber: field.revision },
                  ],
                });
              }}
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
              previewLocale={locale}
              onPreviewLocale={setLocale}
              onGenerateTranslations={(nextLocale, sourceResourceIds) => {
                setLocale(nextLocale);
                void generateTranslations(nextLocale, sourceResourceIds);
              }}
              onSaveTranslation={(item, text) => {
                setLocale(item.locale);
                void saveManagedTranslation(item, text);
              }}
              onReviewTranslation={(item, text) => {
                setLocale(item.locale);
                void reviewManagedTranslation(item, text);
              }}
            />
          ) : (
            <ReadinessPane
              draft={draft}
              releases={releases}
              selectedRelease={selectedRelease}
              publishDisabled={publishDisabled}
              onOpenPublish={openPublishReview}
              onJump={jumpTo}
              onSelectRelease={(releaseId) => {
                void loadRelease(releaseId);
              }}
              onCloneRelease={async (release) => {
                const cloned = await editDraft({
                  type: 'restore-release-assembly',
                  releaseId: release.releaseId,
                });
                if (!cloned) return;
                setChangeDescription(
                  `Roll back to release ${release.releaseNumber} as a new release.`,
                );
                setStatus(
                  `Release ${release.releaseNumber} is cloned into the shared draft. Review the resource-level diff, then publish a new higher-numbered release.`,
                );
                openPublishReview();
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
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl"
          >
            {publishStage === 'review' ? (
              <>
                <h2 className="text-2xl font-black">
                  Review the resource-level diff
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Publication requires unpublished changes, no blockers, this
                  exact resource-level diff, and a change description.
                </p>
                <ul className="mt-5 max-h-48 space-y-2 overflow-y-auto">
                  {structuralComparisons.map((comparison) => (
                    <li
                      key={comparison.resourceId}
                      className="rounded-xl bg-slate-50 p-3 text-sm"
                    >
                      <strong className="capitalize">{comparison.change}</strong>
                      <span className="mt-1 block font-bold text-slate-800">
                        {comparison.label || comparison.kind}
                      </span>
                      <span className="mt-1 block font-mono text-[11px] text-slate-500">
                        {comparison.slot}
                        {comparison.draftRevision
                          ? ` · draft ${comparison.draftRevision}`
                          : ''}
                        {comparison.activeRevision
                          ? ` · active ${comparison.activeRevision}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {localizedChangeCount > 0 ? (
                  <p className="mt-3 text-xs text-slate-500">
                    {localizedChangeCount} localized string
                    {localizedChangeCount === 1 ? ' change' : ' changes'} in
                    this exact assembly.
                  </p>
                ) : null}
                <textarea
                  aria-label="Change description"
                  value={changeDescription}
                  onChange={(event) => setChangeDescription(event.target.value)}
                  rows={3}
                  placeholder="Required change description"
                  className="mt-5 w-full rounded-xl border px-3 py-2"
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
                    disabled={publishDisabled || !changeDescription.trim()}
                    onClick={() => setPublishStage('confirm')}
                    className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50"
                  >
                    Continue to confirmation
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-black">
                  Authorize atomic publication
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {credentialsRequired
                    ? 'Confirm fresh password-plus-TOTP authentication. The entered change description is preserved.'
                    : 'Authentication is still fresh, or the server will ask for both factors if it is not. Final confirmation publishes this exact candidate as the next immutable release.'}
                </p>
                <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                  Current authority:{' '}
                  <strong>{authorityName || 'this Administrator'}</strong> with
                  Administrative Permission. Fresh authentication is required
                  when this session is no longer fresh.
                </p>
                {credentialsRequired ? (
                  <>
                    <input
                      aria-label="Password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Password"
                      className="mt-5 w-full rounded-xl border px-3 py-2"
                    />
                    <input
                      aria-label="Authenticator code"
                      inputMode="numeric"
                      value={totp}
                      onChange={(event) => setTotp(event.target.value)}
                      placeholder="6-digit authenticator code"
                      className="mt-3 w-full rounded-xl border px-3 py-2"
                    />
                  </>
                ) : null}
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPublishStage('review');
                      setPassword('');
                      setTotp('');
                    }}
                    className="flex-1 rounded-xl border px-4 py-3 font-bold"
                  >
                    Back to review
                  </button>
                  <button
                    type="button"
                    disabled={
                      publishDisabled ||
                      !changeDescription.trim() ||
                      (credentialsRequired &&
                        (!password || !/^[0-9]{6}$/.test(totp)))
                    }
                    onClick={() => void publish()}
                    className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:opacity-50"
                  >
                    Publish atomically
                  </button>
                </div>
              </>
            )}
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
  onArchive(resourceId: string, revisionNumber: number): void;
  onPatchBranding(patch: Partial<BrandingFields>): void;
  onPatchModule(patch: Partial<ModuleFields>): void;
  onPatchItem(item: ModuleItem, patch: Partial<ItemFields>): void;
  onReorder(collection: Collection, orderedResourceIds: string[]): void;
  onCreateItem(collection: Collection): void;
  onPatchIntakeForm(patch: Partial<IntakeFormFields>): void;
  onPatchIntakeSection(
    section: IntakeSection,
    patch: Partial<IntakeSectionFields>,
  ): void;
  onPatchIntakeField(field: IntakeField, patch: Partial<IntakeFieldFields>): void;
  onPatchIntakeOption(
    option: IntakeOption,
    patch: Partial<IntakeOptionFields>,
  ): void;
  onReorderIntake(
    kind: 'sections' | 'fields' | 'options',
    orderedResourceIds: string[],
    fieldId?: string,
  ): void;
  onCreateIntakeSection(): void;
  onCreateIntakeField(sectionId: string, fieldType: string): void;
  onCreateIntakeOption(fieldId: string): void;
  previewLocale: Locale;
  onPreviewLocale(locale: Locale): void;
  onGenerateTranslations(
    locale: ManagedLocale,
    sourceResourceIds?: string[],
  ): void;
  onSaveTranslation(item: ManagedTranslationItem, text: string): void;
  onReviewTranslation(item: ManagedTranslationItem, text?: string): void;
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
            Draft revision {comparison.draftRevision ?? 'removed'}
            {comparison.activeRevision
              ? ` · active revision ${comparison.activeRevision}`
              : ' · never published'}
            {comparison.differs ? ` · ${comparison.change} from active` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {comparison.activeRevision && comparison.draftRevision ? (
              <button
                type="button"
                onClick={() => {
                  if (comparison.draftRevision == null) return;
                  props.onRestore(
                    comparison.resourceId,
                    comparison.draftRevision,
                  );
                }}
                className="rounded-lg border bg-white px-3 py-1.5 font-bold"
              >
                Restore active revision
              </button>
            ) : null}
            {comparison.discardEligible && comparison.draftRevision ? (
              <button
                type="button"
                onClick={() => {
                  if (comparison.draftRevision == null) return;
                  props.onDiscard(
                    comparison.resourceId,
                    comparison.draftRevision,
                  );
                }}
                className="rounded-lg border bg-white px-3 py-1.5 font-bold"
              >
                Discard never-published
              </button>
            ) : null}
            {comparison.archiveEligible && comparison.draftRevision ? (
              <button
                type="button"
                onClick={() => {
                  if (comparison.draftRevision == null) return;
                  props.onArchive(
                    comparison.resourceId,
                    comparison.draftRevision,
                  );
                }}
                className="rounded-lg border bg-white px-3 py-1.5 font-bold"
              >
                Remove from next release
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {props.resource === 'branding' ? (
        <div
          className="mt-6 space-y-4"
          data-readiness-target={branding.id}
          tabIndex={-1}
        >
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
        <div
          className="mt-6 space-y-4"
          data-readiness-target={module.id}
          tabIndex={-1}
        >
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
                    <div
                      key={item.id}
                      className="rounded-lg bg-slate-50 p-2"
                      data-readiness-target={item.id}
                      tabIndex={-1}
                    >
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
                        {props.draft.comparisons.find(
                          (itemComparison) =>
                            itemComparison.resourceId === item.id,
                        )?.archiveEligible ? (
                          <button
                            type="button"
                            onClick={() =>
                              props.onArchive(item.id, item.revision)
                            }
                            className="text-xs font-bold"
                          >
                            Remove
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
        <IntakeFormEditor
          draft={props.draft}
          onPatchForm={props.onPatchIntakeForm}
          onPatchSection={props.onPatchIntakeSection}
          onPatchField={props.onPatchIntakeField}
          onPatchOption={props.onPatchIntakeOption}
          onReorder={props.onReorderIntake}
          onCreateSection={props.onCreateIntakeSection}
          onCreateField={props.onCreateIntakeField}
          onCreateOption={props.onCreateIntakeOption}
          onDiscard={props.onDiscard}
          onArchive={props.onArchive}
        />
      ) : null}

      {props.resource === 'translations' ? (
        <ManagedTranslationsEditor
          draft={props.draft}
          previewLocale={props.previewLocale}
          onPreviewLocale={props.onPreviewLocale}
          onGenerate={props.onGenerateTranslations}
          onSave={props.onSaveTranslation}
          onReview={props.onReviewTranslation}
        />
      ) : null}
    </div>
  );
}

function ManagedTranslationsEditor(props: {
  draft: Draft;
  previewLocale: Locale;
  onPreviewLocale(locale: Locale): void;
  onGenerate(locale: ManagedLocale, sourceResourceIds?: string[]): void;
  onSave(item: ManagedTranslationItem, text: string): void;
  onReview(item: ManagedTranslationItem, text?: string): void;
}) {
  const work = props.draft.managedTranslations;
  const selectedLocale: ManagedLocale =
    props.previewLocale === 'en-US' ? 'es-US' : props.previewLocale;
  const summary = work.locales.find((item) => item.locale === selectedLocale);
  const items = work.items.filter((item) => item.locale === selectedLocale);
  const blockers = props.draft.validation.blockers.filter((blocker) =>
    blocker.path.includes(selectedLocale),
  );
  const [draftText, setDraftText] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraftText({});
  }, [props.draft.draftVersion]);

  function textFor(item: ManagedTranslationItem): string {
    if (item.path in draftText) return draftText[item.path] ?? '';
    return (
      findLocalizedMap(props.draft.candidate, item.sourceResourceId)?.[
        item.locale
      ]?.value ?? ''
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm leading-6 text-slate-600">
        English is canonical. Generate provider suggestions from server-loaded
        authored content, then review before publication. Regeneration never
        overwrites reviewed text.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {work.locales.map((localeSummary) => {
          const selected = localeSummary.locale === selectedLocale;
          const needsWork =
            localeSummary.missing +
              localeSummary.stale +
              localeSummary.generated >
            0;
          return (
            <button
              key={localeSummary.locale}
              type="button"
              onClick={() => props.onPreviewLocale(localeSummary.locale)}
              className={`rounded-xl border p-3 text-left ${
                selected ? 'border-emerald-700 bg-emerald-50' : 'bg-white'
              }`}
            >
              <strong className="text-sm">
                {managedLocaleLabels[localeSummary.locale]}
              </strong>
              <span className="mt-1 block text-xs text-slate-600">
                {localeSummary.reviewed} reviewed · {localeSummary.generated}{' '}
                generated · {localeSummary.stale} stale ·{' '}
                {localeSummary.missing} missing
              </span>
              <span
                className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  needsWork
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {needsWork ? 'Needs review' : 'Ready'}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => props.onGenerate(selectedLocale)}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white"
        >
          Generate suggestions
        </button>
        {summary && summary.generated + summary.stale + summary.missing > 0 ? (
          <p className="self-center text-xs text-slate-500">
            Generated text stays unreviewed until an Administrator marks it
            reviewed.
          </p>
        ) : null}
      </div>
      {blockers.length > 0 ? (
        <div className="space-y-2">
          {blockers.map((blocker) => (
            <p
              key={`${blocker.code}:${blocker.path}`}
              className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs text-rose-900"
            >
              <strong>{blocker.code}</strong>
              <span className="mt-1 block">{blocker.message}</span>
              <span className="mt-1 block font-mono text-[11px]">
                {blocker.path}
              </span>
            </p>
          ))}
        </div>
      ) : null}
      <div className="space-y-3">
        {items.map((item) => {
          const map = findLocalizedMap(
            props.draft.candidate,
            item.sourceResourceId,
          );
          const source = map?.['en-US']?.value ?? '';
          const current = textFor(item);
          const provenance = item.provenance;
          return (
            <article
              key={item.path}
              className="rounded-xl border p-3"
              data-readiness-target={item.sourceResourceId}
              tabIndex={-1}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    {translationKindLabels[item.kind]} · {item.status}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    {item.path}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.status !== 'reviewed' ? (
                    <button
                      type="button"
                      onClick={() =>
                        props.onGenerate(item.locale, [item.sourceResourceId])
                      }
                      className="text-xs font-bold text-emerald-800"
                    >
                      {item.status === 'missing' ? 'Generate' : 'Regenerate'}
                    </button>
                  ) : null}
                  {item.status === 'generated' ? (
                    <button
                      type="button"
                      onClick={() => props.onReview(item, current)}
                      className="text-xs font-bold text-emerald-800"
                    >
                      Mark reviewed
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 text-xs font-bold text-slate-500">English</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                {source || 'Not yet loaded on this candidate.'}
              </p>
              <label className="mt-3 block text-xs font-bold text-slate-500">
                {managedLocaleLabels[item.locale]}
                <textarea
                  value={current}
                  rows={3}
                  disabled={item.status === 'missing'}
                  onChange={(event) =>
                    setDraftText((state) => ({
                      ...state,
                      [item.path]: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border px-2 py-1 text-sm disabled:bg-slate-50"
                />
              </label>
              {item.status !== 'missing' ? (
                <button
                  type="button"
                  onClick={() => props.onSave(item, current)}
                  className="mt-2 text-xs font-bold text-slate-600"
                >
                  Save translation
                </button>
              ) : null}
              {provenance ? (
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  Source revision {provenance.sourceRevision}
                  {provenance.adapter ? ` · ${provenance.adapter}` : ''}
                  {provenance.adapterVersion
                    ? ` · ${provenance.adapterVersion}`
                    : ''}
                  {provenance.model ? ` · ${provenance.model}` : ''}
                  {provenance.glossaryRevision
                    ? ` · ${provenance.glossaryRevision}`
                    : ''}
                  {provenance.generatedAt
                    ? ` · generated ${provenance.generatedAt}`
                    : ''}
                  {provenance.reviewer
                    ? ` · reviewer ${provenance.reviewer}`
                    : ''}
                  {provenance.reviewedAt
                    ? ` · reviewed ${provenance.reviewedAt}`
                    : ''}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function moveId(ids: string[], index: number): string[] | undefined {
  if (index <= 0) return undefined;
  const previous = ids[index - 1];
  const currentId = ids[index];
  if (!previous || !currentId) return undefined;
  const next = [...ids];
  next[index - 1] = currentId;
  next[index] = previous;
  return next;
}

function IntakeFormEditor(props: {
  draft: Draft;
  onPatchForm(patch: Partial<IntakeFormFields>): void;
  onPatchSection(
    section: IntakeSection,
    patch: Partial<IntakeSectionFields>,
  ): void;
  onPatchField(field: IntakeField, patch: Partial<IntakeFieldFields>): void;
  onPatchOption(option: IntakeOption, patch: Partial<IntakeOptionFields>): void;
  onReorder(
    kind: 'sections' | 'fields' | 'options',
    orderedResourceIds: string[],
    fieldId?: string,
  ): void;
  onCreateSection(): void;
  onCreateField(sectionId: string, fieldType: string): void;
  onCreateOption(fieldId: string): void;
  onDiscard(resourceId: string, revisionNumber: number): void;
  onArchive(resourceId: string, revisionNumber: number): void;
}) {
  const form = props.draft.candidate.release.intakeForm;
  const attestation = props.draft.candidate.release.submissionAttestation;
  const choiceFields = form.fields.filter((field) =>
    isChoiceIntakeFieldType(field.type),
  );
  return (
    <div className="mt-6 space-y-4" data-readiness-target={form.id} tabIndex={-1}>
      <p className="text-xs text-slate-500">Stable ID: {form.id}</p>
      <label className="block text-sm font-bold">
        English title
        <input
          defaultValue={localized(form.title, 'en-US')}
          onChange={(event) => props.onPatchForm({ title: event.target.value })}
          className="mt-2 w-full rounded-xl border px-3 py-2"
        />
      </label>
      <label className="block text-sm font-bold">
        Submission Attestation
        <textarea
          defaultValue={localized(attestation.text, 'en-US')}
          rows={4}
          onChange={(event) =>
            props.onPatchForm({ attestation: event.target.value })
          }
          className="mt-2 w-full rounded-xl border px-3 py-2"
        />
      </label>
      <div className="flex items-center justify-between">
        <strong className="text-sm">Sections</strong>
        <button
          type="button"
          onClick={props.onCreateSection}
          className="text-xs font-bold text-emerald-800"
        >
          Add section
        </button>
      </div>
      {form.sections.map((section, sectionIndex) => (
        <section key={section.id} className="rounded-xl border p-3">
          <div className="flex items-center gap-2">
            <input
              defaultValue={localized(section.title, 'en-US')}
              onChange={(event) =>
                props.onPatchSection(section, { title: event.target.value })
              }
              className="w-full rounded-lg border px-2 py-1 text-sm font-bold"
            />
            {sectionIndex > 0 ? (
              <button
                type="button"
                onClick={() => {
                  const ids = moveId(
                    form.sections.map((entry) => entry.id),
                    sectionIndex,
                  );
                  if (ids) props.onReorder('sections', ids);
                }}
                className="shrink-0 text-xs font-bold"
              >
                Up
              </button>
            ) : null}
            {props.draft.comparisons.find(
              (comparison) => comparison.resourceId === section.id,
            )?.discardEligible ? (
              <button
                type="button"
                onClick={() => props.onDiscard(section.id, section.revision)}
                className="shrink-0 text-xs font-bold"
              >
                Discard
              </button>
            ) : null}
            {props.draft.comparisons.find(
              (comparison) => comparison.resourceId === section.id,
            )?.archiveEligible ? (
              <button
                type="button"
                onClick={() => props.onArchive(section.id, section.revision)}
                className="shrink-0 text-xs font-bold"
              >
                Remove
              </button>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {section.id}
          </p>
          <div className="mt-3 grid gap-2">
            {form.fields
              .filter((field) => field.sectionId === section.id)
              .map((field) => {
                const fieldIndex = form.fields.findIndex(
                  (entry) => entry.id === field.id,
                );
                const earlierChoices = choiceFields.filter(
                  (entry) =>
                    form.fields.findIndex((item) => item.id === entry.id) <
                    fieldIndex,
                );
                return (
                  <article
                    key={field.id}
                    className="rounded-lg bg-slate-50 p-2"
                    data-readiness-target={field.id}
                    tabIndex={-1}
                  >
                    <input
                      defaultValue={localized(field.label, 'en-US')}
                      onChange={(event) =>
                        props.onPatchField(field, { label: event.target.value })
                      }
                      className="w-full rounded-lg border px-2 py-1 text-sm"
                    />
                    <input
                      defaultValue={localized(field.helpText, 'en-US')}
                      placeholder="Help text"
                      onChange={(event) =>
                        props.onPatchField(field, {
                          helpText: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-lg border px-2 py-1 text-xs"
                    />
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <select
                        defaultValue={field.type}
                        onChange={(event) =>
                          props.onPatchField(field, {
                            fieldType: event.target.value,
                          })
                        }
                        className="rounded-lg border px-2 py-1 text-xs"
                      >
                        {intakeFieldTypeOptions.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        defaultValue={field.sectionId}
                        onChange={(event) =>
                          props.onPatchField(field, {
                            sectionId: event.target.value,
                          })
                        }
                        className="rounded-lg border px-2 py-1 text-xs"
                      >
                        {form.sections.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {localized(entry.title, 'en-US')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="mt-1 flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        defaultChecked={field.required}
                        onChange={(event) =>
                          props.onPatchField(field, {
                            required: event.target.checked,
                          })
                        }
                      />
                      Required
                    </label>
                    <label className="mt-1 flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        defaultChecked={field.requiredWhenVisible}
                        onChange={(event) =>
                          props.onPatchField(field, {
                            requiredWhenVisible: event.target.checked,
                          })
                        }
                      />
                      Required when visible
                    </label>
                    <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      Visible when earlier choice
                    </p>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <select
                        defaultValue={field.visibility?.fieldId ?? ''}
                        onChange={(event) =>
                          props.onPatchField(field, {
                            visibilityFieldId: event.target.value,
                          })
                        }
                        className="rounded-lg border px-2 py-1 text-xs"
                      >
                        <option value="">Always visible</option>
                        {earlierChoices.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {localized(entry.label, 'en-US')}
                          </option>
                        ))}
                      </select>
                      <select
                        defaultValue={field.visibility?.equalsOptionCode ?? ''}
                        onChange={(event) =>
                          props.onPatchField(field, {
                            visibilityOptionCode: event.target.value,
                          })
                        }
                        className="rounded-lg border px-2 py-1 text-xs"
                      >
                        <option value="">Option code</option>
                        {earlierChoices.map((entry) =>
                          (entry.options ?? []).map((option) => (
                            <option
                              key={option.id}
                              value={option.code}
                            >{`${localized(entry.label, 'en-US')}: ${option.code}`}</option>
                          )),
                        )}
                      </select>
                    </div>
                    {isChoiceIntakeFieldType(field.type) ? (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                            Coded options
                          </span>
                          <button
                            type="button"
                            onClick={() => props.onCreateOption(field.id)}
                            className="text-xs font-bold text-emerald-800"
                          >
                            Add option
                          </button>
                        </div>
                        {(field.options ?? []).map((option, optionIndex) => (
                          <div
                            key={option.id}
                            className="grid grid-cols-[7rem_1fr_auto] gap-1"
                          >
                            <input
                              defaultValue={option.code}
                              onChange={(event) =>
                                props.onPatchOption(option, {
                                  code: event.target.value,
                                })
                              }
                              className="rounded border px-1 py-1 font-mono text-xs"
                            />
                            <input
                              defaultValue={localized(option.label, 'en-US')}
                              onChange={(event) =>
                                props.onPatchOption(option, {
                                  label: event.target.value,
                                })
                              }
                              className="rounded border px-1 py-1 text-xs"
                            />
                            <div className="flex gap-1">
                              {optionIndex > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const ids = moveId(
                                      (field.options ?? []).map(
                                        (entry) => entry.id,
                                      ),
                                      optionIndex,
                                    );
                                    if (ids) {
                                      props.onReorder('options', ids, field.id);
                                    }
                                  }}
                                  className="text-[10px] font-bold"
                                >
                                  Up
                                </button>
                              ) : null}
                              {props.draft.comparisons.find(
                                (comparison) =>
                                  comparison.resourceId === option.id,
                              )?.discardEligible ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    props.onDiscard(option.id, option.revision)
                                  }
                                  className="text-[10px] font-bold"
                                >
                                  Discard
                                </button>
                              ) : null}
                              {props.draft.comparisons.find(
                                (comparison) =>
                                  comparison.resourceId === option.id,
                              )?.archiveEligible ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    props.onArchive(option.id, option.revision)
                                  }
                                  className="text-[10px] font-bold"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-1 flex gap-2">
                      {fieldIndex > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            const ids = moveId(
                              form.fields.map((entry) => entry.id),
                              fieldIndex,
                            );
                            if (ids) props.onReorder('fields', ids);
                          }}
                          className="text-xs font-bold"
                        >
                          Move up
                        </button>
                      ) : null}
                      {props.draft.comparisons.find(
                        (comparison) => comparison.resourceId === field.id,
                      )?.discardEligible ? (
                        <button
                          type="button"
                          onClick={() =>
                            props.onDiscard(field.id, field.revision)
                          }
                          className="text-xs font-bold"
                        >
                          Discard
                        </button>
                      ) : null}
                      {props.draft.comparisons.find(
                        (comparison) => comparison.resourceId === field.id,
                      )?.archiveEligible ? (
                        <button
                          type="button"
                          onClick={() =>
                            props.onArchive(field.id, field.revision)
                          }
                          className="text-xs font-bold"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            <button
              type="button"
              onClick={() => props.onCreateField(section.id, 'text')}
              className="rounded-lg border border-dashed px-2 py-1 text-left text-xs font-bold text-emerald-800"
            >
              Add field
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

function ReadinessPane(props: {
  draft: Draft;
  releases: ReleaseSummary[];
  selectedRelease?: ReleaseDetail;
  publishDisabled: boolean;
  onOpenPublish(): void;
  onJump(location: ReadinessLocation, surface?: 'edit' | 'preview'): void;
  onSelectRelease(releaseId: string): void;
  onCloneRelease(release: ReleaseSummary): void;
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
            <div
              key={`${blocker.code}:${blocker.path}`}
              className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm"
            >
              <button
                type="button"
                onClick={() => props.onJump(blocker.location)}
                className="block w-full text-left"
              >
                <strong className="text-rose-900">{blocker.code}</strong>
                <span className="mt-1 block text-xs text-rose-800">
                  {blocker.message}
                </span>
                <span className="mt-1 block font-mono text-[11px] text-rose-700">
                  {blocker.path} · {blocker.location.editorResource} editor ·{' '}
                  {blocker.location.previewScreen} preview
                </span>
              </button>
              <button
                type="button"
                onClick={() => props.onJump(blocker.location, 'preview')}
                className="mt-2 text-xs font-bold text-emerald-800"
              >
                Open exact preview
              </button>
            </div>
          ))
        )}
        {warnings.map((warning) => (
          <div
            key={`${warning.code}:${warning.path}`}
            className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900"
          >
            <button
              type="button"
              onClick={() => props.onJump(warning.location)}
              className="block w-full text-left"
            >
              <strong>{warning.code}:</strong> {warning.message}
              <span className="mt-1 block font-mono text-[11px]">
                {warning.path} · {warning.location.editorResource} editor ·{' '}
                {warning.location.previewScreen} preview
              </span>
            </button>
            <button
              type="button"
              onClick={() => props.onJump(warning.location, 'preview')}
              className="mt-2 text-xs font-bold text-emerald-800"
            >
              Open exact preview
            </button>
          </div>
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
      <section className="mt-8">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
          Immutable release history
        </h3>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Rollback clones an earlier assembly into the shared draft, validates
          it under current rules, and publishes a new higher-numbered release.
        </p>
        <div className="mt-3 space-y-2">
          {props.releases.length === 0 ? (
            <p className="text-xs text-slate-500">
              No School Configuration Releases have been published yet.
            </p>
          ) : (
            props.releases.map((release) => (
              <article
                key={release.releaseId}
                className={`rounded-xl border p-3 ${
                  props.selectedRelease?.releaseId === release.releaseId
                    ? 'border-emerald-700 bg-emerald-50'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <button
                  type="button"
                  onClick={() => props.onSelectRelease(release.releaseId)}
                  className="w-full text-left"
                >
                  <p className="text-sm font-bold">
                    Release {release.releaseNumber}
                    {release.active ? ' · active' : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {release.changeDescription}
                  </p>
                </button>
                {props.selectedRelease?.releaseId === release.releaseId ? (
                  <div className="mt-3 space-y-2">
                    {props.selectedRelease.comparisons
                      .filter(
                        (comparison) =>
                          comparison.change !== 'unchanged' &&
                          isVisibleAssemblyComparison(comparison),
                      )
                      .map((comparison) => (
                        <p
                          key={comparison.resourceId}
                          className="rounded-lg bg-white p-2 text-xs text-slate-600"
                        >
                          <strong className="capitalize">
                            {comparison.change}
                          </strong>{' '}
                          {comparison.label || comparison.kind}
                        </p>
                      ))}
                    {!release.active ? (
                      <button
                        type="button"
                        onClick={() => props.onCloneRelease(release)}
                        className="w-full rounded-lg bg-white px-3 py-2 text-xs font-bold text-emerald-800"
                      >
                        Clone into the shared draft
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
