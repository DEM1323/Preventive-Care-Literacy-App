import type {
  Clock,
  IdGenerator,
  StudentSessionContext,
} from '../identity-access/index.ts';
import {
  StaffAuthenticationFailedError,
  StaffAuthenticationStaleError,
  StaffPermissionRequiredError,
  StaffSessionExpiredError,
  StaffSessionRevokedError,
  StudentClassAccessRequiredError,
  StudentNotFoundError,
} from '../identity-access/index.ts';
import {
  canonicalJson,
  supportedLocales,
} from '../school-configuration/index.ts';
import type { SupportedIntakeFieldType } from '../intake-answers/index.ts';
import {
  compareIntakeCanonicalMeaning,
  intakeFieldIsVisible,
  isSupportedIntakeFieldType,
  rebaseIntakeAnswers,
  selectedIntakeOptionCodes,
} from '../intake-answers/index.ts';

export { renderIntakeAnswer } from '../intake-answers/index.ts';
export type { LocalizedIntakeAnswerField } from '../intake-answers/index.ts';

export const intakeKeyManagementName = 'application-layer-envelope/v1' as const;
export const supportedIntakeLocales = supportedLocales;

export type IntakeLocale = (typeof supportedIntakeLocales)[number];

export type KeyWrappingContext = {
  purpose:
    | 'intake-draft'
    | 'intake-record-version'
    | 'record-production'
    | 'record-amendment';
  workspaceId: string;
  studentId: string;
};

export type SealedRecord = {
  wrappingKeyId: string;
  wrappedDataKey: string;
  ciphertext: string;
};

export type IdempotencyBindingContext = {
  workspaceId: string;
  studentId: string;
};

/**
 * Provider-neutral application-layer envelope encryption. Managed disk
 * encryption and Supabase Vault are not substitutes: answers must be sealed
 * with a wrapped data key before they are admitted to storage.
 */
export type ApplicationKeyManagement = {
  readonly name: typeof intakeKeyManagementName;
  seal(plaintext: Uint8Array, context: KeyWrappingContext): SealedRecord;
  open(
    sealed: SealedRecord,
    context: KeyWrappingContext,
  ): Uint8Array | Promise<Uint8Array>;
  bind(plaintext: Uint8Array, context: IdempotencyBindingContext): string;
};

export type ExactResourceRevision = {
  resourceId: string;
  revisionNumber: number;
};

export type IntakeAnswerMap = Record<string, string>;

export type IntakeFormField = {
  id: string;
  revision: number;
  key: string;
  sectionId: string;
  order: number;
  type: SupportedIntakeFieldType;
  required: boolean;
  requiredWhenVisible: boolean;
  visibility: { fieldId: string; equalsOptionCode: string } | null;
  options: { code: string; label: string }[];
  label: string;
};

export type StudentIntakeForm = {
  schoolConfigurationReleaseId: string;
  locale: IntakeLocale;
  intakeForm: {
    resourceId: string;
    revisionNumber: number;
    title: string;
    sections: { id: string; revision: number; order: number; title: string }[];
    fields: IntakeFormField[];
  };
  submissionAttestation: {
    resourceId: string;
    revisionNumber: number;
    text: string;
  };
};

export type CurrentIntakeRecordVersion = {
  intakeRecordVersionId: string;
  acceptedAt: string;
  schoolConfigurationReleaseId: string;
  intakeForm: ExactResourceRevision;
  submissionAttestation: ExactResourceRevision;
  locale: IntakeLocale;
};

export type StudentIntakeSnapshot = {
  learningUnlocked: boolean;
  currentIntakeRecordVersion: CurrentIntakeRecordVersion | null;
  intakeUpdateRequirement: IntakeUpdateRequirement | null;
  draft: {
    draftRevision: number;
    locale: IntakeLocale;
    updatedAt: string;
    schoolConfigurationReleaseId: string;
    intakeForm: ExactResourceRevision;
    answers: IntakeAnswerMap;
    compatibility: IntakeDraftCompatibility;
    reviewFieldIds: string[];
  } | null;
  form: StudentIntakeForm;
};

export type IntakeDraftCompatibility =
  'current' | 'presentation-equivalent' | 'canonical-change';

export type IntakeUpdateRequirement = {
  currentIntakeRecordVersionId: string;
  currentSchoolConfigurationReleaseId: string;
  currentIntakeForm: ExactResourceRevision;
  currentSubmissionAttestation: ExactResourceRevision;
  activeSchoolConfigurationReleaseId: string;
  activeIntakeForm: ExactResourceRevision;
  activeSubmissionAttestation: ExactResourceRevision;
  impactedFieldIds: string[];
};

export type IntakeReconciliationGuidance = {
  activeSchoolConfigurationReleaseId: string;
  activeIntakeForm: ExactResourceRevision;
  activeSubmissionAttestation: ExactResourceRevision;
  compatibility: 'presentation-equivalent' | 'canonical-change';
  rebaseRequired: boolean;
  impactedFieldIds: string[];
  draftRevision?: number;
  currentIntakeRecordVersionId?: string;
};

export type SaveIntakeDraftCommand = {
  sessionHandle: string;
  operationId: string;
  expectedDraftRevision: number;
  expectedSchoolConfigurationReleaseId: string;
  expectedIntakeForm: ExactResourceRevision;
  locale: IntakeLocale;
  answers: IntakeAnswerMap;
};

export type SaveIntakeDraftResult = {
  operationId: string;
  locale: IntakeLocale;
  updatedAt: string;
  draftRevision: number;
  replayed: boolean;
};

export type IntakeChangedField = {
  fieldId: string;
  change: 'added' | 'removed' | 'changed';
};

export type SubmitIntakeRecordVersionCommand = {
  sessionHandle: string;
  operationId: string;
  expectedSchoolConfigurationReleaseId: string;
  expectedIntakeForm: ExactResourceRevision;
  expectedSubmissionAttestation: ExactResourceRevision;
  expectedDraftRevision?: number;
  expectedCurrentIntakeRecordVersionId?: string;
  locale: IntakeLocale;
  answers: IntakeAnswerMap;
  attestation: {
    locale: IntakeLocale;
    notice: ExactResourceRevision;
  };
};

export type SubmitIntakeRecordVersionResult = {
  operationId: string;
  intakeRecordVersionId: string;
  acceptedAt: string;
  learningUnlocked: true;
  replayed: boolean;
  predecessorIntakeRecordVersionId: string | null;
  changedFields: IntakeChangedField[];
};

export type ReopenIntakeRecordCommand = {
  sessionHandle: string;
  operationId: string;
  expectedCurrentIntakeRecordVersionId: string;
  locale: IntakeLocale;
};

export type ReopenIntakeRecordResult = {
  operationId: string;
  locale: IntakeLocale;
  updatedAt: string;
  draftRevision: number;
  replayed: boolean;
};

export type RebaseIntakeDraftCommand = {
  sessionHandle: string;
  operationId: string;
  expectedDraftRevision: number;
  locale: IntakeLocale;
};

export type RebaseIntakeDraftResult = {
  operationId: string;
  locale: IntakeLocale;
  updatedAt: string;
  draftRevision: number;
  replayed: boolean;
  reviewFieldIds: string[];
  omittedFieldIds: string[];
};

export class IntakeUnavailableError extends Error {
  readonly code = 'INTAKE_UNAVAILABLE';
  constructor() {
    super('An active School Configuration Release is required');
    this.name = 'IntakeUnavailableError';
  }
}

export class IntakeRevisionConflictError extends Error {
  readonly code = 'INTAKE_REVISION_CONFLICT';
  constructor(readonly guidance?: IntakeReconciliationGuidance) {
    super('The expected configuration or form revision changed');
    this.name = 'IntakeRevisionConflictError';
  }
}

export class IntakeDraftRevisionConflictError extends Error {
  readonly code = 'INTAKE_DRAFT_REVISION_CONFLICT';
  constructor(readonly draftRevision: number) {
    super('The Intake Draft changed');
    this.name = 'IntakeDraftRevisionConflictError';
  }
}

export class IntakeIncompleteError extends Error {
  readonly code = 'INTAKE_INCOMPLETE';
  constructor() {
    super(
      'Complete answers and a matching Submission Attestation are required',
    );
    this.name = 'IntakeIncompleteError';
  }
}

export class IntakeAlreadyAcceptedError extends Error {
  readonly code = 'INTAKE_ALREADY_ACCEPTED';
  constructor() {
    super('An Intake Record Version is already current');
    this.name = 'IntakeAlreadyAcceptedError';
  }
}

export class IntakeOperationReusedError extends Error {
  readonly code = 'OPERATION_ID_REUSED';
  constructor() {
    super('The operation ID is already bound to different input');
    this.name = 'IntakeOperationReusedError';
  }
}

export class IntakeRecordNotFoundError extends Error {
  readonly code = 'INTAKE_RECORD_NOT_FOUND';
  constructor() {
    super('No current Intake Record Version is available');
    this.name = 'IntakeRecordNotFoundError';
  }
}

export class IntakeCurrentRevisionConflictError extends Error {
  readonly code = 'INTAKE_CURRENT_REVISION_CONFLICT';
  constructor(readonly currentIntakeRecordVersionId: string) {
    super('The current Intake Record Version changed');
    this.name = 'IntakeCurrentRevisionConflictError';
  }
}

export type RevealCurrentIntakeRecordCommand = {
  sessionHandle: string;
  studentId: string;
};

export const clinicalAccessPurposes = [
  'care_coordination',
  'historical_comparison',
] as const;

export type ClinicalAccessPurpose = (typeof clinicalAccessPurposes)[number];

export type SelectClinicalStudentCommand = {
  sessionHandle: string;
  studentId: string;
  purpose: ClinicalAccessPurpose;
};

export type RevealIntakeRecordVersionCommand = {
  sessionHandle: string;
  studentId: string;
  intakeRecordVersionId: string;
  purpose: ClinicalAccessPurpose;
};

export type ClinicalIntakeVersionSummary = {
  intakeRecordVersionId: string;
  versionNumber: number;
  acceptedAt: string;
  schoolConfigurationReleaseId: string;
  locale: IntakeLocale;
  intakeForm: ExactResourceRevision;
  predecessorIntakeRecordVersionId: string | null;
  status: 'current' | 'superseded';
  supersededAt: string | null;
};

export type ClinicalStudentSelection = {
  studentId: string;
  versions: ClinicalIntakeVersionSummary[];
  freshUntil: string;
};

export type RevealedCurrentIntakeRecord = {
  studentId: string;
  intakeRecordVersionId: string;
  versionNumber: number;
  acceptedAt: string;
  schoolConfigurationReleaseId: string;
  locale: IntakeLocale;
  intakeForm: StudentIntakeForm['intakeForm'];
  answers: IntakeAnswerMap;
  intakeUpdateRequirement: IntakeUpdateRequirement | null;
  predecessorIntakeRecordVersionId: string | null;
  changedFields: IntakeChangedField[];
  status: 'current' | 'superseded';
  supersededAt: string | null;
  freshUntil: string;
};

export type UnattributedRevealOutcome =
  | 'denied_unauthenticated'
  | 'denied_session_unknown'
  | 'denied_origin'
  | 'denied_csrf'
  | 'denied_invalid_request'
  | 'denied_body_too_large';

export type ClinicalRevealDenialReason =
  'revoked' | 'expired' | 'disabled' | 'permission' | 'stale';

export type ClinicalRevealAttempt =
  | { outcome: 'missing_session' }
  | { outcome: 'denied'; reason: ClinicalRevealDenialReason }
  | { outcome: 'not_found' }
  | { outcome: 'failed'; cause: 'read' | 'projection' | 'decrypt' }
  | {
      outcome: 'revealed';
      intakeRecordVersionId: string;
      versionNumber: number;
      acceptedAt: Date;
      schoolConfigurationReleaseId: string;
      locale: IntakeLocale;
      intakeForm: StudentIntakeForm['intakeForm'];
      answers: IntakeAnswerMap;
      intakeUpdateRequirement: IntakeUpdateRequirement | null;
      predecessorIntakeRecordVersionId: string | null;
      changedFields: IntakeChangedField[];
      status: 'current' | 'superseded';
      supersededAt: Date | null;
      freshUntil: Date;
    };

export type ClinicalStudentSelectionAttempt =
  | { outcome: 'missing_session' }
  | { outcome: 'denied'; reason: ClinicalRevealDenialReason }
  | { outcome: 'not_found' }
  | {
      outcome: 'selected';
      versions: ClinicalIntakeVersionSummary[];
      freshUntil: Date;
    };

export type ActiveIntakeRelease = {
  schoolConfigurationReleaseId: string;
  intakeForm: {
    resourceId: string;
    revisionNumber: number;
    payload: Record<string, unknown>;
  };
  submissionAttestation: {
    resourceId: string;
    revisionNumber: number;
    payload: Record<string, unknown>;
  };
};

export type StoredIntakeDraft = {
  locale: IntakeLocale;
  updatedAt: Date;
  draftRevision: number;
  schoolConfigurationReleaseId: string;
  intakeForm: ExactResourceRevision;
  reviewFieldIds: string[];
  formPayload: Record<string, unknown> | undefined;
  sealed: SealedRecord;
};

export type StoredIntakeRecordVersion = {
  intakeRecordVersionId: string;
  versionNumber: number;
  acceptedAt: Date;
  schoolConfigurationReleaseId: string;
  intakeForm: ExactResourceRevision;
  submissionAttestation: ExactResourceRevision;
  locale: IntakeLocale;
  formPayload: Record<string, unknown> | undefined;
  attestationPayload: Record<string, unknown> | undefined;
  sealed: SealedRecord;
};

export type IntakeStore = {
  readWorkspaceIntake(input: {
    studentId: string;
    workspaceId: string;
  }): Promise<{
    release: ActiveIntakeRelease | undefined;
    draft: StoredIntakeDraft | undefined;
    currentVersion: StoredIntakeRecordVersion | undefined;
  }>;
  saveDraft(input: {
    studentId: string;
    workspaceId: string;
    operationId: string;
    requestBinding: string;
    locale: IntakeLocale;
    expectedDraftRevision: number;
    expectedSchoolConfigurationReleaseId: string;
    expectedIntakeForm: ExactResourceRevision;
    sealed: SealedRecord;
    reviewFieldIds: string[];
    updatedAt: Date;
  }): Promise<
    | {
        outcome: 'saved';
        draftRevision: number;
        locale: IntakeLocale;
        updatedAt: Date;
      }
    | { outcome: 'replayed'; result: SaveIntakeDraftResult }
  >;
  reopen(input: {
    studentId: string;
    workspaceId: string;
    operationId: string;
    requestBinding: string;
    locale: IntakeLocale;
    expectedCurrentIntakeRecordVersionId: string;
    updatedAt: Date;
    seedDraft: (
      currentSealed: SealedRecord,
      currentFormPayload: Record<string, unknown> | undefined,
      release: ActiveIntakeRelease,
    ) => Promise<{ sealed: SealedRecord; reviewFieldIds: string[] }>;
  }): Promise<
    | {
        outcome: 'saved';
        draftRevision: number;
        locale: IntakeLocale;
        updatedAt: Date;
      }
    | { outcome: 'replayed'; result: ReopenIntakeRecordResult }
  >;
  rebase(input: {
    studentId: string;
    workspaceId: string;
    operationId: string;
    requestBinding: string;
    locale: IntakeLocale;
    expectedDraftRevision: number;
    updatedAt: Date;
    propose: (
      currentSealed: SealedRecord,
      draftFormPayload: Record<string, unknown> | undefined,
      release: ActiveIntakeRelease,
    ) => Promise<{
      sealed: SealedRecord;
      reviewFieldIds: string[];
      omittedFieldIds: string[];
    }>;
  }): Promise<
    | {
        outcome: 'saved';
        draftRevision: number;
        locale: IntakeLocale;
        updatedAt: Date;
        reviewFieldIds: string[];
        omittedFieldIds: string[];
      }
    | { outcome: 'replayed'; result: RebaseIntakeDraftResult }
  >;
  submit(input: {
    studentId: string;
    workspaceId: string;
    operationId: string;
    requestBinding: string;
    proposedVersionId: string;
    locale: IntakeLocale;
    expectedSchoolConfigurationReleaseId: string;
    expectedIntakeForm: ExactResourceRevision;
    expectedSubmissionAttestation: ExactResourceRevision;
    expectedDraftRevision?: number;
    expectedCurrentIntakeRecordVersionId?: string;
    sealed: SealedRecord;
    acceptedAt: Date;
    auditId: string;
    outboxId: string;
    summarizeChanges: (
      previousSealed: SealedRecord | undefined,
    ) => Promise<IntakeChangedField[]>;
  }): Promise<
    | {
        outcome: 'accepted';
        intakeRecordVersionId: string;
        acceptedAt: Date;
        predecessorIntakeRecordVersionId: string | null;
        changedFields: IntakeChangedField[];
      }
    | { outcome: 'replayed'; result: SubmitIntakeRecordVersionResult }
  >;
  revealCurrent(input: {
    sessionHandleHash: string;
    studentId: string;
    intakeRecordVersionId?: string;
    purpose?: ClinicalAccessPurpose;
    kind: 'current' | 'historical';
    now: () => Date;
    auditId: string;
    operationId: string;
    projectForm: (
      release: ActiveIntakeRelease,
      locale: IntakeLocale,
    ) => StudentIntakeForm;
    openAnswers: (
      sealed: SealedRecord,
      context: { workspaceId: string; studentId: string },
    ) => Promise<IntakeAnswerMap>;
    summarizeChanges: (
      previousAnswers: IntakeAnswerMap | undefined,
      nextAnswers: IntakeAnswerMap,
    ) => IntakeChangedField[];
  }): Promise<ClinicalRevealAttempt>;
  selectStudent(input: {
    sessionHandleHash: string;
    studentId: string;
    purpose: ClinicalAccessPurpose;
    now: () => Date;
    auditId: string;
    operationId: string;
  }): Promise<ClinicalStudentSelectionAttempt>;
  recordUnattributedRevealAttempt(input: {
    auditId: string;
    operationId: string;
    occurredAt: Date;
    outcome: UnattributedRevealOutcome;
    studentId?: string;
  }): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function localizedText(
  value: unknown,
  locale: IntakeLocale,
): string | undefined {
  if (!isRecord(value) || !isRecord(value[locale])) return undefined;
  const localized = value[locale];
  return typeof localized.value === 'string' ? localized.value : undefined;
}

function fieldType(value: unknown): IntakeFormField['type'] | undefined {
  return isSupportedIntakeFieldType(value) ? value : undefined;
}

export function projectStudentIntakeForm(
  release: ActiveIntakeRelease,
  locale: IntakeLocale,
): StudentIntakeForm {
  const form = release.intakeForm.payload;
  const attestation = release.submissionAttestation.payload;
  const title = localizedText(form.title, locale);
  const attestationText = localizedText(attestation.text, locale);
  if (!title || !attestationText) {
    throw new IntakeUnavailableError();
  }
  const sections = Array.isArray(form.sections) ? form.sections : [];
  const fields = Array.isArray(form.fields) ? form.fields : [];
  return {
    schoolConfigurationReleaseId: release.schoolConfigurationReleaseId,
    locale,
    intakeForm: {
      resourceId: release.intakeForm.resourceId,
      revisionNumber: release.intakeForm.revisionNumber,
      title,
      sections: sections.flatMap((section) => {
        if (
          !isRecord(section) ||
          typeof section.id !== 'string' ||
          !Number.isInteger(section.revision)
        ) {
          return [];
        }
        const sectionTitle = localizedText(section.title, locale);
        if (!sectionTitle) return [];
        return [
          {
            id: section.id,
            revision: Number(section.revision),
            order: Number(section.order ?? 0),
            title: sectionTitle,
          },
        ];
      }),
      fields: fields.flatMap((field) => {
        const projected = projectField(field, locale);
        return projected ? [projected] : [];
      }),
    },
    submissionAttestation: {
      resourceId: release.submissionAttestation.resourceId,
      revisionNumber: release.submissionAttestation.revisionNumber,
      text: attestationText,
    },
  };
}

function projectField(
  field: unknown,
  locale: IntakeLocale,
): IntakeFormField | undefined {
  if (
    !isRecord(field) ||
    typeof field.id !== 'string' ||
    !Number.isInteger(field.revision) ||
    typeof field.key !== 'string' ||
    typeof field.sectionId !== 'string'
  ) {
    return undefined;
  }
  const type = fieldType(field.type);
  const label = localizedText(field.label, locale);
  if (!type || !label) return undefined;
  const visibility =
    isRecord(field.visibility) &&
    typeof field.visibility.fieldId === 'string' &&
    typeof field.visibility.equalsOptionCode === 'string'
      ? {
          fieldId: field.visibility.fieldId,
          equalsOptionCode: field.visibility.equalsOptionCode,
        }
      : null;
  const options = Array.isArray(field.options)
    ? field.options.flatMap((option) => {
        if (!isRecord(option) || typeof option.code !== 'string') return [];
        const optionLabel = localizedText(option.label, locale);
        return optionLabel ? [{ code: option.code, label: optionLabel }] : [];
      })
    : [];
  return {
    id: field.id,
    revision: Number(field.revision),
    key: field.key,
    sectionId: field.sectionId,
    order: Number(field.order ?? 0),
    type,
    required: field.required === true,
    requiredWhenVisible: field.requiredWhenVisible === true,
    visibility,
    options,
    label,
  };
}

export function fieldIsVisible(
  field: IntakeFormField,
  answers: IntakeAnswerMap,
): boolean {
  return intakeFieldIsVisible(field, answers);
}

export function answersAreComplete(
  form: StudentIntakeForm,
  answers: IntakeAnswerMap,
): boolean {
  const allowed = new Set(form.intakeForm.fields.map((field) => field.id));
  for (const fieldId of Object.keys(answers)) {
    if (!allowed.has(fieldId)) return false;
  }
  for (const field of form.intakeForm.fields) {
    if (!fieldIsVisible(field, answers)) {
      if (answers[field.id] !== undefined) return false;
      continue;
    }
    const required = field.required || field.requiredWhenVisible;
    const value = answers[field.id];
    if (!required && (value === undefined || value.trim() === '')) continue;
    if (typeof value !== 'string' || value.trim().length === 0) return false;
    if (field.options.length > 0) {
      const selected = selectedIntakeOptionCodes(value);
      if (selected.length === 0) return false;
      if (
        selected.some(
          (code) => !field.options.some((option) => option.code === code),
        )
      ) {
        return false;
      }
      if (field.type !== 'multiple-choice' && selected.length !== 1) {
        return false;
      }
    }
  }
  return true;
}

function sameRevision(
  expected: ExactResourceRevision,
  actual: ExactResourceRevision,
): boolean {
  return (
    expected.resourceId === actual.resourceId &&
    expected.revisionNumber === actual.revisionNumber
  );
}

function encodeAnswers(answers: IntakeAnswerMap): Uint8Array {
  return Buffer.from(canonicalJson(answers), 'utf8');
}

function decodeAnswers(bytes: Uint8Array): IntakeAnswerMap {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!isRecord(parsed)) return {};
  const answers: IntakeAnswerMap = {};
  for (const [fieldId, value] of Object.entries(parsed)) {
    if (typeof value === 'string') answers[fieldId] = value;
  }
  return answers;
}

function changedFieldSummary(
  previous: IntakeAnswerMap | undefined,
  next: IntakeAnswerMap,
): IntakeChangedField[] {
  const fieldIds = [
    ...new Set([...Object.keys(previous ?? {}), ...Object.keys(next)]),
  ].sort();
  const summary: IntakeChangedField[] = [];
  for (const fieldId of fieldIds) {
    const before = previous?.[fieldId];
    const after = next[fieldId];
    if (before === after) continue;
    summary.push({
      fieldId,
      change:
        before === undefined
          ? 'added'
          : after === undefined
            ? 'removed'
            : 'changed',
    });
  }
  return summary;
}

function activeRevisions(release: ActiveIntakeRelease) {
  return {
    activeSchoolConfigurationReleaseId: release.schoolConfigurationReleaseId,
    activeIntakeForm: {
      resourceId: release.intakeForm.resourceId,
      revisionNumber: release.intakeForm.revisionNumber,
    },
    activeSubmissionAttestation: {
      resourceId: release.submissionAttestation.resourceId,
      revisionNumber: release.submissionAttestation.revisionNumber,
    },
  };
}

function compareToActive(
  previousForm: unknown,
  release: ActiveIntakeRelease,
  previousAttestation?: unknown,
) {
  return compareIntakeCanonicalMeaning({
    previousForm,
    nextForm: release.intakeForm.payload,
    previousAttestation,
    nextAttestation: previousAttestation
      ? release.submissionAttestation.payload
      : undefined,
  });
}

function reconciliationGuidance(
  release: ActiveIntakeRelease,
  previousForm: unknown,
  extras: {
    previousAttestation?: unknown;
    draftRevision?: number;
    currentIntakeRecordVersionId?: string;
  } = {},
): IntakeReconciliationGuidance {
  const comparison = compareToActive(
    previousForm,
    release,
    extras.previousAttestation,
  );
  return {
    ...activeRevisions(release),
    compatibility: comparison.compatibility,
    rebaseRequired: comparison.compatibility === 'canonical-change',
    impactedFieldIds: comparison.impactedFieldIds,
    ...(extras.draftRevision === undefined
      ? {}
      : { draftRevision: extras.draftRevision }),
    ...(extras.currentIntakeRecordVersionId
      ? {
          currentIntakeRecordVersionId: extras.currentIntakeRecordVersionId,
        }
      : {}),
  };
}

function assertMatchingActiveRelease(
  release: ActiveIntakeRelease,
  expected: {
    schoolConfigurationReleaseId: string;
    intakeForm: ExactResourceRevision;
    submissionAttestation?: ExactResourceRevision;
  },
  previousForm: unknown,
  extras: {
    previousAttestation?: unknown;
    draftRevision?: number;
    currentIntakeRecordVersionId?: string;
  } = {},
): void {
  if (
    release.schoolConfigurationReleaseId !==
      expected.schoolConfigurationReleaseId ||
    !sameRevision(expected.intakeForm, {
      resourceId: release.intakeForm.resourceId,
      revisionNumber: release.intakeForm.revisionNumber,
    }) ||
    (expected.submissionAttestation &&
      !sameRevision(expected.submissionAttestation, {
        resourceId: release.submissionAttestation.resourceId,
        revisionNumber: release.submissionAttestation.revisionNumber,
      }))
  ) {
    throw new IntakeRevisionConflictError(
      reconciliationGuidance(release, previousForm, extras),
    );
  }
}

function draftCompatibilityFor(
  draft: StoredIntakeDraft,
  release: ActiveIntakeRelease,
): IntakeDraftCompatibility {
  if (
    sameRevision(draft.intakeForm, {
      resourceId: release.intakeForm.resourceId,
      revisionNumber: release.intakeForm.revisionNumber,
    })
  ) {
    return 'current';
  }
  if (!draft.formPayload) return 'canonical-change';
  return compareToActive(draft.formPayload, release).compatibility ===
    'presentation-equivalent'
    ? 'presentation-equivalent'
    : 'canonical-change';
}

export function intakeUpdateRequirementFor(
  current: StoredIntakeRecordVersion,
  release: ActiveIntakeRelease,
): IntakeUpdateRequirement | null {
  if (!current.formPayload) return null;
  const comparison = compareToActive(
    current.formPayload,
    release,
    current.attestationPayload,
  );
  if (comparison.compatibility === 'presentation-equivalent') return null;
  return {
    currentIntakeRecordVersionId: current.intakeRecordVersionId,
    currentSchoolConfigurationReleaseId: current.schoolConfigurationReleaseId,
    currentIntakeForm: current.intakeForm,
    currentSubmissionAttestation: current.submissionAttestation,
    ...activeRevisions(release),
    impactedFieldIds: comparison.impactedFieldIds,
  };
}

export function createIntake(dependencies: {
  resolveStudentSession: (command: {
    sessionHandle: string;
  }) => Promise<StudentSessionContext | undefined>;
  store: IntakeStore;
  keys: ApplicationKeyManagement;
  clock: Clock;
  ids: IdGenerator;
  hashSessionHandle: (sessionHandle: string) => string;
}) {
  async function requireStudent(sessionHandle: string) {
    const session = await dependencies.resolveStudentSession({ sessionHandle });
    if (!session) return undefined;
    if (session.activeClassMemberships.length === 0) {
      throw new StudentClassAccessRequiredError();
    }
    return session;
  }

  return {
    async read(command: { sessionHandle: string; locale: IntakeLocale }) {
      const session = await requireStudent(command.sessionHandle);
      if (!session) return undefined;
      const state = await dependencies.store.readWorkspaceIntake({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
      });
      if (!state.release) throw new IntakeUnavailableError();
      const form = projectStudentIntakeForm(state.release, command.locale);
      const current = state.currentVersion
        ? {
            intakeRecordVersionId: state.currentVersion.intakeRecordVersionId,
            acceptedAt: state.currentVersion.acceptedAt.toISOString(),
            schoolConfigurationReleaseId:
              state.currentVersion.schoolConfigurationReleaseId,
            intakeForm: state.currentVersion.intakeForm,
            submissionAttestation: state.currentVersion.submissionAttestation,
            locale: state.currentVersion.locale,
          }
        : null;
      const draft = !state.draft
        ? null
        : {
            draftRevision: state.draft.draftRevision,
            locale: state.draft.locale,
            updatedAt: state.draft.updatedAt.toISOString(),
            schoolConfigurationReleaseId:
              state.draft.schoolConfigurationReleaseId,
            intakeForm: state.draft.intakeForm,
            answers: decodeAnswers(
              await dependencies.keys.open(state.draft.sealed, {
                purpose: 'intake-draft',
                workspaceId: session.workspaceId,
                studentId: session.studentId,
              }),
            ),
            compatibility: draftCompatibilityFor(state.draft, state.release),
            reviewFieldIds: state.draft.reviewFieldIds,
          };
      return {
        learningUnlocked: current !== null,
        currentIntakeRecordVersion: current,
        intakeUpdateRequirement: state.currentVersion
          ? intakeUpdateRequirementFor(state.currentVersion, state.release)
          : null,
        draft,
        form,
      } satisfies StudentIntakeSnapshot;
    },

    async saveDraft(command: SaveIntakeDraftCommand) {
      const session = await requireStudent(command.sessionHandle);
      if (!session) return undefined;
      const state = await dependencies.store.readWorkspaceIntake({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
      });
      if (!state.release) throw new IntakeUnavailableError();
      assertMatchingActiveRelease(
        state.release,
        {
          schoolConfigurationReleaseId:
            command.expectedSchoolConfigurationReleaseId,
          intakeForm: command.expectedIntakeForm,
        },
        state.draft?.formPayload ?? state.release.intakeForm.payload,
        {
          draftRevision: state.draft?.draftRevision,
          currentIntakeRecordVersionId:
            state.currentVersion?.intakeRecordVersionId,
        },
      );
      if (
        state.draft &&
        draftCompatibilityFor(state.draft, state.release) === 'canonical-change'
      ) {
        throw new IntakeRevisionConflictError(
          reconciliationGuidance(
            state.release,
            state.draft.formPayload ?? state.release.intakeForm.payload,
            {
              draftRevision: state.draft.draftRevision,
              currentIntakeRecordVersionId:
                state.currentVersion?.intakeRecordVersionId,
            },
          ),
        );
      }
      const updatedAt = dependencies.clock.now();
      const requestBinding = dependencies.keys.bind(
        Buffer.from(
          canonicalJson({
            expectedDraftRevision: command.expectedDraftRevision,
            expectedSchoolConfigurationReleaseId:
              command.expectedSchoolConfigurationReleaseId,
            expectedIntakeForm: command.expectedIntakeForm,
            locale: command.locale,
            answers: command.answers,
          }),
          'utf8',
        ),
        {
          workspaceId: session.workspaceId,
          studentId: session.studentId,
        },
      );
      const saved = await dependencies.store.saveDraft({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
        operationId: command.operationId,
        requestBinding,
        locale: command.locale,
        expectedDraftRevision: command.expectedDraftRevision,
        expectedSchoolConfigurationReleaseId:
          command.expectedSchoolConfigurationReleaseId,
        expectedIntakeForm: command.expectedIntakeForm,
        sealed: dependencies.keys.seal(encodeAnswers(command.answers), {
          purpose: 'intake-draft',
          workspaceId: session.workspaceId,
          studentId: session.studentId,
        }),
        reviewFieldIds: state.draft?.reviewFieldIds ?? [],
        updatedAt,
      });
      if (saved.outcome === 'replayed') return saved.result;
      return {
        operationId: command.operationId,
        locale: saved.locale,
        updatedAt: saved.updatedAt.toISOString(),
        draftRevision: saved.draftRevision,
        replayed: false,
      };
    },

    async reopen(command: ReopenIntakeRecordCommand) {
      const session = await requireStudent(command.sessionHandle);
      if (!session) return undefined;
      const updatedAt = dependencies.clock.now();
      const requestBinding = dependencies.keys.bind(
        Buffer.from(
          canonicalJson({
            expectedCurrentIntakeRecordVersionId:
              command.expectedCurrentIntakeRecordVersionId,
            locale: command.locale,
          }),
          'utf8',
        ),
        {
          workspaceId: session.workspaceId,
          studentId: session.studentId,
        },
      );
      const reopened = await dependencies.store.reopen({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
        operationId: command.operationId,
        requestBinding,
        locale: command.locale,
        expectedCurrentIntakeRecordVersionId:
          command.expectedCurrentIntakeRecordVersionId,
        updatedAt,
        seedDraft: async (currentSealed, currentFormPayload, release) => {
          const previousAnswers = decodeAnswers(
            await dependencies.keys.open(currentSealed, {
              purpose: 'intake-record-version',
              workspaceId: session.workspaceId,
              studentId: session.studentId,
            }),
          );
          const rebased = rebaseIntakeAnswers({
            previousForm: currentFormPayload ?? release.intakeForm.payload,
            nextForm: release.intakeForm.payload,
            answers: previousAnswers,
          });
          return {
            sealed: dependencies.keys.seal(encodeAnswers(rebased.answers), {
              purpose: 'intake-draft',
              workspaceId: session.workspaceId,
              studentId: session.studentId,
            }),
            reviewFieldIds: rebased.reviewFieldIds,
          };
        },
      });
      if (reopened.outcome === 'replayed') return reopened.result;
      return {
        operationId: command.operationId,
        locale: reopened.locale,
        updatedAt: reopened.updatedAt.toISOString(),
        draftRevision: reopened.draftRevision,
        replayed: false,
      };
    },

    async rebase(command: RebaseIntakeDraftCommand) {
      const session = await requireStudent(command.sessionHandle);
      if (!session) return undefined;
      const updatedAt = dependencies.clock.now();
      const requestBinding = dependencies.keys.bind(
        Buffer.from(
          canonicalJson({
            expectedDraftRevision: command.expectedDraftRevision,
            locale: command.locale,
          }),
          'utf8',
        ),
        {
          workspaceId: session.workspaceId,
          studentId: session.studentId,
        },
      );
      const rebased = await dependencies.store.rebase({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
        operationId: command.operationId,
        requestBinding,
        locale: command.locale,
        expectedDraftRevision: command.expectedDraftRevision,
        updatedAt,
        propose: async (currentSealed, draftFormPayload, release) => {
          const previousAnswers = decodeAnswers(
            await dependencies.keys.open(currentSealed, {
              purpose: 'intake-draft',
              workspaceId: session.workspaceId,
              studentId: session.studentId,
            }),
          );
          const proposal = rebaseIntakeAnswers({
            previousForm: draftFormPayload ?? release.intakeForm.payload,
            nextForm: release.intakeForm.payload,
            answers: previousAnswers,
          });
          return {
            sealed: dependencies.keys.seal(encodeAnswers(proposal.answers), {
              purpose: 'intake-draft',
              workspaceId: session.workspaceId,
              studentId: session.studentId,
            }),
            reviewFieldIds: proposal.reviewFieldIds,
            omittedFieldIds: proposal.omittedFieldIds,
          };
        },
      });
      if (rebased.outcome === 'replayed') return rebased.result;
      return {
        operationId: command.operationId,
        locale: rebased.locale,
        updatedAt: rebased.updatedAt.toISOString(),
        draftRevision: rebased.draftRevision,
        replayed: false,
        reviewFieldIds: rebased.reviewFieldIds,
        omittedFieldIds: rebased.omittedFieldIds,
      };
    },

    async submit(command: SubmitIntakeRecordVersionCommand) {
      const session = await requireStudent(command.sessionHandle);
      if (!session) return undefined;
      const state = await dependencies.store.readWorkspaceIntake({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
      });
      if (!state.release) throw new IntakeUnavailableError();
      const form = projectStudentIntakeForm(state.release, command.locale);
      assertMatchingActiveRelease(
        state.release,
        {
          schoolConfigurationReleaseId:
            command.expectedSchoolConfigurationReleaseId,
          intakeForm: command.expectedIntakeForm,
          submissionAttestation: command.expectedSubmissionAttestation,
        },
        state.draft?.formPayload ??
          state.currentVersion?.formPayload ??
          state.release.intakeForm.payload,
        {
          previousAttestation: state.currentVersion?.attestationPayload,
          draftRevision: state.draft?.draftRevision,
          currentIntakeRecordVersionId:
            state.currentVersion?.intakeRecordVersionId,
        },
      );
      if (
        state.draft &&
        draftCompatibilityFor(state.draft, state.release) === 'canonical-change'
      ) {
        throw new IntakeRevisionConflictError(
          reconciliationGuidance(
            state.release,
            state.draft.formPayload ?? state.release.intakeForm.payload,
            {
              draftRevision: state.draft.draftRevision,
              currentIntakeRecordVersionId:
                state.currentVersion?.intakeRecordVersionId,
            },
          ),
        );
      }
      if (
        command.attestation.locale !== command.locale ||
        !sameRevision(
          command.attestation.notice,
          command.expectedSubmissionAttestation,
        ) ||
        !answersAreComplete(form, command.answers)
      ) {
        throw new IntakeIncompleteError();
      }
      const acceptedAt = dependencies.clock.now();
      const requestBinding = dependencies.keys.bind(
        Buffer.from(
          canonicalJson({
            expectedSchoolConfigurationReleaseId:
              command.expectedSchoolConfigurationReleaseId,
            expectedIntakeForm: command.expectedIntakeForm,
            expectedSubmissionAttestation:
              command.expectedSubmissionAttestation,
            ...(command.expectedDraftRevision === undefined
              ? {}
              : { expectedDraftRevision: command.expectedDraftRevision }),
            ...(command.expectedCurrentIntakeRecordVersionId
              ? {
                  expectedCurrentIntakeRecordVersionId:
                    command.expectedCurrentIntakeRecordVersionId,
                }
              : {}),
            locale: command.locale,
            answers: command.answers,
            attestation: command.attestation,
          }),
          'utf8',
        ),
        {
          workspaceId: session.workspaceId,
          studentId: session.studentId,
        },
      );
      const submitted = await dependencies.store.submit({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
        operationId: command.operationId,
        requestBinding,
        proposedVersionId: dependencies.ids.create(),
        locale: command.locale,
        expectedSchoolConfigurationReleaseId:
          command.expectedSchoolConfigurationReleaseId,
        expectedIntakeForm: command.expectedIntakeForm,
        expectedSubmissionAttestation: command.expectedSubmissionAttestation,
        expectedDraftRevision: command.expectedDraftRevision,
        expectedCurrentIntakeRecordVersionId:
          command.expectedCurrentIntakeRecordVersionId,
        sealed: dependencies.keys.seal(encodeAnswers(command.answers), {
          purpose: 'intake-record-version',
          workspaceId: session.workspaceId,
          studentId: session.studentId,
        }),
        acceptedAt,
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
        summarizeChanges: async (previousSealed) =>
          changedFieldSummary(
            previousSealed
              ? decodeAnswers(
                  await dependencies.keys.open(previousSealed, {
                    purpose: 'intake-record-version',
                    workspaceId: session.workspaceId,
                    studentId: session.studentId,
                  }),
                )
              : undefined,
            command.answers,
          ),
      });
      if (submitted.outcome === 'replayed') return submitted.result;
      return {
        operationId: command.operationId,
        intakeRecordVersionId: submitted.intakeRecordVersionId,
        acceptedAt: submitted.acceptedAt.toISOString(),
        learningUnlocked: true as const,
        replayed: false,
        predecessorIntakeRecordVersionId:
          submitted.predecessorIntakeRecordVersionId,
        changedFields: submitted.changedFields,
      };
    },

    async reportUnauthenticatedReveal(command: {
      studentId?: string;
      outcome: UnattributedRevealOutcome;
    }) {
      await dependencies.store.recordUnattributedRevealAttempt({
        auditId: dependencies.ids.create(),
        operationId: dependencies.ids.create(),
        occurredAt: dependencies.clock.now(),
        outcome: command.outcome,
        studentId: command.studentId,
      });
    },

    async selectStudent(command: SelectClinicalStudentCommand) {
      const attempted = await dependencies.store.selectStudent({
        sessionHandleHash: dependencies.hashSessionHandle(
          command.sessionHandle,
        ),
        studentId: command.studentId,
        purpose: command.purpose,
        now: () => dependencies.clock.now(),
        auditId: dependencies.ids.create(),
        operationId: dependencies.ids.create(),
      });
      if (attempted.outcome === 'missing_session') {
        throw new StaffAuthenticationFailedError();
      }
      if (attempted.outcome === 'denied') {
        throwClinicalRevealDenial(attempted.reason);
      }
      if (attempted.outcome === 'not_found') {
        throw new StudentNotFoundError();
      }
      return {
        studentId: command.studentId,
        versions: attempted.versions,
        freshUntil: new Date(attempted.freshUntil).toISOString(),
      } satisfies ClinicalStudentSelection;
    },

    async revealCurrent(command: RevealCurrentIntakeRecordCommand) {
      return revealAuthorized({
        sessionHandle: command.sessionHandle,
        studentId: command.studentId,
        kind: 'current',
      });
    },

    async revealVersion(command: RevealIntakeRecordVersionCommand) {
      return revealAuthorized({
        sessionHandle: command.sessionHandle,
        studentId: command.studentId,
        intakeRecordVersionId: command.intakeRecordVersionId,
        purpose: command.purpose,
        kind: 'historical',
      });
    },
  };

  async function revealAuthorized(command: {
    sessionHandle: string;
    studentId: string;
    intakeRecordVersionId?: string;
    purpose?: ClinicalAccessPurpose;
    kind: 'current' | 'historical';
  }) {
    const attempted = await dependencies.store.revealCurrent({
      sessionHandleHash: dependencies.hashSessionHandle(command.sessionHandle),
      studentId: command.studentId,
      intakeRecordVersionId: command.intakeRecordVersionId,
      purpose: command.purpose,
      kind: command.kind,
      now: () => dependencies.clock.now(),
      auditId: dependencies.ids.create(),
      operationId: dependencies.ids.create(),
      projectForm: projectStudentIntakeForm,
      openAnswers: async (sealed, context) =>
        decodeAnswers(
          await dependencies.keys.open(sealed, {
            purpose: 'intake-record-version',
            workspaceId: context.workspaceId,
            studentId: context.studentId,
          }),
        ),
      summarizeChanges: (previousAnswers, nextAnswers) =>
        changedFieldSummary(previousAnswers, nextAnswers),
    });
    return mapRevealedRecord(command.studentId, attempted);
  }

  function throwClinicalRevealDenial(
    reason: ClinicalRevealDenialReason,
  ): never {
    if (reason === 'revoked') throw new StaffSessionRevokedError();
    if (reason === 'expired') throw new StaffSessionExpiredError();
    if (reason === 'permission') {
      throw new StaffPermissionRequiredError('clinical');
    }
    if (reason === 'stale') throw new StaffAuthenticationStaleError();
    throw new StaffAuthenticationFailedError();
  }

  function mapRevealedRecord(
    studentId: string,
    attempted: ClinicalRevealAttempt,
  ): RevealedCurrentIntakeRecord {
    if (attempted.outcome === 'missing_session') {
      throw new StaffAuthenticationFailedError();
    }
    if (attempted.outcome === 'denied') {
      throwClinicalRevealDenial(attempted.reason);
    }
    if (attempted.outcome === 'not_found') {
      throw new IntakeRecordNotFoundError();
    }
    if (attempted.outcome === 'failed') {
      if (attempted.cause === 'decrypt') {
        throw new Error('Unable to open the Intake Record Version');
      }
      throw new IntakeUnavailableError();
    }
    const orderedFields = [...attempted.intakeForm.fields].sort(
      (left, right) => left.order - right.order,
    );
    return {
      studentId,
      intakeRecordVersionId: attempted.intakeRecordVersionId,
      versionNumber: attempted.versionNumber,
      acceptedAt: new Date(attempted.acceptedAt).toISOString(),
      schoolConfigurationReleaseId: attempted.schoolConfigurationReleaseId,
      locale: attempted.locale,
      intakeForm: { ...attempted.intakeForm, fields: orderedFields },
      answers: attempted.answers,
      intakeUpdateRequirement: attempted.intakeUpdateRequirement,
      predecessorIntakeRecordVersionId:
        attempted.predecessorIntakeRecordVersionId,
      changedFields: attempted.changedFields,
      status: attempted.status,
      supersededAt: attempted.supersededAt
        ? new Date(attempted.supersededAt).toISOString()
        : null,
      freshUntil: new Date(attempted.freshUntil).toISOString(),
    } satisfies RevealedCurrentIntakeRecord;
  }
}

export type Intake = ReturnType<typeof createIntake>;
