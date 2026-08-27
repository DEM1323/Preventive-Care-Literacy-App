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
} from '../identity-access/index.ts';
import {
  canonicalJson,
  supportedLocales,
} from '../school-configuration/index.ts';
import type { SupportedIntakeFieldType } from '../intake-answers/index.ts';
import {
  intakeFieldIsVisible,
  isSupportedIntakeFieldType,
  selectedIntakeOptionCodes,
} from '../intake-answers/index.ts';

export { renderIntakeAnswer } from '../intake-answers/index.ts';
export type { LocalizedIntakeAnswerField } from '../intake-answers/index.ts';

export const intakeKeyManagementName = 'application-layer-envelope/v1' as const;
export const supportedIntakeLocales = supportedLocales;

export type IntakeLocale = (typeof supportedIntakeLocales)[number];

export type KeyWrappingContext = {
  purpose: 'intake-draft' | 'intake-record-version';
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
  draft: {
    locale: IntakeLocale;
    updatedAt: string;
    answers: IntakeAnswerMap;
  } | null;
  form: StudentIntakeForm;
};

export type SaveIntakeDraftCommand = {
  sessionHandle: string;
  expectedSchoolConfigurationReleaseId: string;
  expectedIntakeForm: ExactResourceRevision;
  locale: IntakeLocale;
  answers: IntakeAnswerMap;
};

export type SaveIntakeDraftResult = {
  locale: IntakeLocale;
  updatedAt: string;
};

export type SubmitIntakeRecordVersionCommand = {
  sessionHandle: string;
  operationId: string;
  expectedSchoolConfigurationReleaseId: string;
  expectedIntakeForm: ExactResourceRevision;
  expectedSubmissionAttestation: ExactResourceRevision;
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
  constructor() {
    super('The expected configuration or form revision changed');
    this.name = 'IntakeRevisionConflictError';
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

export type RevealCurrentIntakeRecordCommand = {
  sessionHandle: string;
  studentId: string;
};

export type RevealedCurrentIntakeRecord = {
  studentId: string;
  intakeRecordVersionId: string;
  acceptedAt: string;
  schoolConfigurationReleaseId: string;
  locale: IntakeLocale;
  intakeForm: StudentIntakeForm['intakeForm'];
  answers: IntakeAnswerMap;
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
      acceptedAt: Date;
      schoolConfigurationReleaseId: string;
      locale: IntakeLocale;
      intakeForm: StudentIntakeForm['intakeForm'];
      answers: IntakeAnswerMap;
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
  sealed: SealedRecord;
};

export type StoredIntakeRecordVersion = {
  intakeRecordVersionId: string;
  acceptedAt: Date;
  schoolConfigurationReleaseId: string;
  intakeForm: ExactResourceRevision;
  submissionAttestation: ExactResourceRevision;
  locale: IntakeLocale;
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
    locale: IntakeLocale;
    expectedSchoolConfigurationReleaseId: string;
    expectedIntakeForm: ExactResourceRevision;
    sealed: SealedRecord;
    updatedAt: Date;
  }): Promise<void>;
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
    sealed: SealedRecord;
    acceptedAt: Date;
    auditId: string;
    outboxId: string;
  }): Promise<
    | { outcome: 'accepted'; intakeRecordVersionId: string; acceptedAt: Date }
    | { outcome: 'replayed'; result: SubmitIntakeRecordVersionResult }
  >;
  revealCurrent(input: {
    sessionHandleHash: string;
    studentId: string;
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
  }): Promise<ClinicalRevealAttempt>;
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

function assertExpectedRelease(
  release: ActiveIntakeRelease,
  expected: {
    schoolConfigurationReleaseId: string;
    intakeForm: ExactResourceRevision;
    submissionAttestation?: ExactResourceRevision;
  },
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
    throw new IntakeRevisionConflictError();
  }
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
      const draft =
        current || !state.draft
          ? null
          : {
              locale: state.draft.locale,
              updatedAt: state.draft.updatedAt.toISOString(),
              answers: decodeAnswers(
                await dependencies.keys.open(state.draft.sealed, {
                  purpose: 'intake-draft',
                  workspaceId: session.workspaceId,
                  studentId: session.studentId,
                }),
              ),
            };
      return {
        learningUnlocked: current !== null,
        currentIntakeRecordVersion: current,
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
      if (state.currentVersion) throw new IntakeAlreadyAcceptedError();
      assertExpectedRelease(state.release, {
        schoolConfigurationReleaseId:
          command.expectedSchoolConfigurationReleaseId,
        intakeForm: command.expectedIntakeForm,
      });
      const updatedAt = dependencies.clock.now();
      await dependencies.store.saveDraft({
        studentId: session.studentId,
        workspaceId: session.workspaceId,
        locale: command.locale,
        expectedSchoolConfigurationReleaseId:
          command.expectedSchoolConfigurationReleaseId,
        expectedIntakeForm: command.expectedIntakeForm,
        sealed: dependencies.keys.seal(encodeAnswers(command.answers), {
          purpose: 'intake-draft',
          workspaceId: session.workspaceId,
          studentId: session.studentId,
        }),
        updatedAt,
      });
      return { locale: command.locale, updatedAt: updatedAt.toISOString() };
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
      assertExpectedRelease(state.release, {
        schoolConfigurationReleaseId:
          command.expectedSchoolConfigurationReleaseId,
        intakeForm: command.expectedIntakeForm,
        submissionAttestation: command.expectedSubmissionAttestation,
      });
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
        sealed: dependencies.keys.seal(encodeAnswers(command.answers), {
          purpose: 'intake-record-version',
          workspaceId: session.workspaceId,
          studentId: session.studentId,
        }),
        acceptedAt,
        auditId: dependencies.ids.create(),
        outboxId: dependencies.ids.create(),
      });
      if (submitted.outcome === 'replayed') return submitted.result;
      return {
        operationId: command.operationId,
        intakeRecordVersionId: submitted.intakeRecordVersionId,
        acceptedAt: submitted.acceptedAt.toISOString(),
        learningUnlocked: true as const,
        replayed: false,
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

    async revealCurrent(command: RevealCurrentIntakeRecordCommand) {
      const auditId = dependencies.ids.create();
      const operationId = dependencies.ids.create();
      const attempted = await dependencies.store.revealCurrent({
        sessionHandleHash: dependencies.hashSessionHandle(
          command.sessionHandle,
        ),
        studentId: command.studentId,
        now: () => dependencies.clock.now(),
        auditId,
        operationId,
        projectForm: projectStudentIntakeForm,
        openAnswers: async (sealed, context) =>
          decodeAnswers(
            await dependencies.keys.open(sealed, {
              purpose: 'intake-record-version',
              workspaceId: context.workspaceId,
              studentId: context.studentId,
            }),
          ),
      });
      if (attempted.outcome === 'missing_session') {
        throw new StaffAuthenticationFailedError();
      }
      if (attempted.outcome === 'denied') {
        if (attempted.reason === 'revoked')
          throw new StaffSessionRevokedError();
        if (attempted.reason === 'expired')
          throw new StaffSessionExpiredError();
        if (attempted.reason === 'permission') {
          throw new StaffPermissionRequiredError('clinical');
        }
        if (attempted.reason === 'stale') {
          throw new StaffAuthenticationStaleError();
        }
        throw new StaffAuthenticationFailedError();
      }
      if (attempted.outcome === 'not_found') {
        throw new IntakeRecordNotFoundError();
      }
      if (attempted.outcome === 'failed') {
        if (attempted.cause === 'decrypt') {
          throw new Error('Unable to open the current Intake Record Version');
        }
        throw new IntakeUnavailableError();
      }
      return {
        studentId: command.studentId,
        intakeRecordVersionId: attempted.intakeRecordVersionId,
        acceptedAt: new Date(attempted.acceptedAt).toISOString(),
        schoolConfigurationReleaseId: attempted.schoolConfigurationReleaseId,
        locale: attempted.locale,
        intakeForm: attempted.intakeForm,
        answers: attempted.answers,
        freshUntil: new Date(attempted.freshUntil).toISOString(),
      } satisfies RevealedCurrentIntakeRecord;
    },
  };
}

export type Intake = ReturnType<typeof createIntake>;
