import { createHash } from 'node:crypto';
import type {
  AdministrativeSessionContext,
  Clock,
  IdGenerator,
  IdentityAndAccess,
} from '../identity-access/index.ts';
import { staffAuthenticationFreshnessMs } from '../identity-access/index.ts';
import {
  isChoiceIntakeFieldType,
  isSupportedIntakeFieldType,
} from '../intake-answers/index.ts';
import {
  applyGeneratedTranslations,
  applyManagedTranslationEdit,
  applyManagedTranslationReview,
  extractTranslatableSegments,
  findLocalizedValue,
  managedLocales,
  presentManagedTranslations,
  translationStatusFor,
  type ManagedLocale,
  type ManagedTranslationWork,
  type TranslationAdapter,
  type TranslationGenerationRejection,
  type TranslationGenerationTelemetry,
} from './managed-translations.ts';

export {
  applyGeneratedTranslations,
  assertApprovedTranslationRequest,
  createUnavailableTranslationAdapter,
  extractTranslatableSegments,
  presentManagedTranslations,
  productOwnedInterfaceCatalog,
  restorePlaceholders,
  shieldPlaceholders,
  translationAdapterId,
  translationAdapterVersion,
  translationGlossaryRevision,
  translationSafetyRegressionFixtures,
  translationSegmentKinds,
  TranslationAdapterRejectedError,
  TranslationProviderUnavailableError,
  UnsafeGeneratedTranslationError,
  validateTranslationSafety,
} from './managed-translations.ts';
export type {
  ManagedLocale,
  ManagedTranslationItem,
  ManagedTranslationWork,
  TranslationAdapter,
  TranslationGenerationRejection,
  TranslationGenerationTelemetry,
  TranslationSegment,
  TranslationSegmentKind,
  TranslationStatus,
} from './managed-translations.ts';

export const candidateFingerprintAlgorithm =
  'school-configuration-candidate/v1' as const;
export const releasePackageFormat = 'school-configuration-package/v1' as const;
export const releasePackageBucket = 'school-configuration-releases' as const;
export const minimumClientContractVersion = 1;
export const supportedLocales = [
  'en-US',
  'es-US',
  'pt-BR',
  'fr-CA',
  'ht-HT',
] as const;

export type ExactResource = {
  resourceId: string;
  revisionNumber: number;
  kind: string;
  slot: string;
  position: number | null;
  payload: Record<string, unknown>;
};

export type ExactTranslationReview = {
  sourceResourceId: string;
  sourceRevisionNumber: number;
  translationResourceId: string;
  translationRevisionNumber: number;
  locale: Exclude<Locale, 'en-US'>;
  reviewProvenanceId: string;
  reviewer: string;
  reviewedAt: Date;
};

type Locale = (typeof supportedLocales)[number];

export type ValidationResult = {
  code: string;
  path: string;
  message: string;
  severity: 'blocker' | 'warning';
};

export type ResourceComparison = {
  resourceId: string;
  draftRevision: number;
  activeRevision: number | null;
  differs: boolean;
  discardEligible: boolean;
};

export type SchoolConfigurationDraft = {
  workspaceId: string;
  draftVersion: number;
  activeReleaseId: string | null;
  activeReleaseNumber: number | null;
  candidateFingerprint: string;
  candidate: unknown;
  unpublishedChanges: boolean;
  validation: { blockers: ValidationResult[]; warnings: ValidationResult[] };
  comparisons: ResourceComparison[];
  managedTranslations: ManagedTranslationWork;
};

export type BrandingAsset = {
  mediaType: string;
  width: number;
  height: number;
  byteLength: number;
  src: string;
};

export type DraftEdit =
  | {
      type: 'save-workspace-branding';
      resourceId: string;
      displayName: string;
      shortName: string;
      generatedTextMark: string;
      primaryColor: string;
      accentColor: string;
      logo?: BrandingAsset | null;
      secondaryMark?: BrandingAsset | null;
    }
  | {
      type: 'save-learning-module';
      resourceId: string;
      title: string;
      description: string;
      knowledgeIntroduction: string;
    }
  | {
      type: 'save-learning-module-item';
      resourceId: string;
      text: string;
      href?: string | null;
    }
  | {
      type: 'reorder-learning-modules';
      orderedResourceIds: string[];
    }
  | {
      type: 'reorder-learning-module-items';
      moduleId: string;
      collection: 'knowledgeItems' | 'skillItems' | 'applicationItems';
      orderedResourceIds: string[];
    }
  | {
      type: 'create-learning-module';
      title: string;
      description: string;
    }
  | {
      type: 'create-learning-module-item';
      moduleId: string;
      collection: 'knowledgeItems' | 'skillItems' | 'applicationItems';
      text: string;
      href?: string | null;
    }
  | {
      type: 'save-intake-form';
      resourceId: string;
      title: string;
      text: string;
    }
  | {
      type: 'save-intake-section';
      resourceId: string;
      title: string;
    }
  | {
      type: 'save-intake-field';
      resourceId: string;
      sectionId: string;
      fieldType: string;
      label: string;
      helpText?: string | null;
      required: boolean;
      requiredWhenVisible: boolean;
      visibility: { fieldId: string; equalsOptionCode: string } | null;
    }
  | {
      type: 'save-intake-option';
      resourceId: string;
      code: string;
      label: string;
    }
  | {
      type: 'reorder-intake-sections';
      orderedResourceIds: string[];
    }
  | {
      type: 'reorder-intake-fields';
      orderedResourceIds: string[];
    }
  | {
      type: 'reorder-intake-options';
      fieldId: string;
      orderedResourceIds: string[];
    }
  | {
      type: 'create-intake-section';
      title: string;
    }
  | {
      type: 'create-intake-field';
      sectionId: string;
      fieldType: string;
      label: string;
    }
  | {
      type: 'create-intake-option';
      fieldId: string;
      code: string;
      label: string;
    }
  | {
      type: 'restore-active-revision';
      resourceId: string;
    }
  | {
      type: 'discard-authored-resource';
      resourceId: string;
    }
  | {
      type: 'save-managed-translation';
      resourceId: string;
      locale: ManagedLocale;
      text: string;
    }
  | {
      type: 'review-managed-translation';
      resourceId: string;
      locale: ManagedLocale;
    };

export type EditSchoolConfigurationDraftCommand = {
  sessionHandle: string;
  operationId: string;
  expectedDraftVersion: number;
  expectedResourceRevisions: { resourceId: string; revisionNumber: number }[];
  edit: DraftEdit;
};

export type EditSchoolConfigurationDraftResult = SchoolConfigurationDraft & {
  operationId: string;
  affectedResources: { resourceId: string; revisionNumber: number }[];
};

export type GenerateManagedTranslationsCommand = {
  sessionHandle: string;
  operationId: string;
  expectedDraftVersion: number;
  locale: ManagedLocale;
  sourceResourceIds?: string[];
};

export type GenerateManagedTranslationsResult = SchoolConfigurationDraft & {
  operationId: string;
  affectedResources: { resourceId: string; revisionNumber: number }[];
  rejected: TranslationGenerationRejection[];
  telemetry: TranslationGenerationTelemetry;
};

export type ImportSchoolConfigurationDraftCommand = {
  sessionHandle: string;
  operationId: string;
  expectedDraftVersion: number;
  candidate: unknown;
};

export type ImportSchoolConfigurationDraftResult = {
  operationId: string;
  draftVersion: number;
  candidateFingerprint: string;
  affectedResources: { resourceId: string; revisionNumber: number }[];
};

export type PublishSchoolConfigurationReleaseCommand = {
  sessionHandle: string;
  operationId: string;
  expectedActiveReleaseId: string | null;
  expectedDraftVersion: number;
  candidateFingerprint: string;
  changeDescription: string;
};

export type PublishSchoolConfigurationReleaseResult = {
  operationId: string;
  releaseId: string;
  releaseNumber: number;
  candidateFingerprint: string;
  activeReleaseId: string;
  draftVersion: number;
  package: {
    format: typeof releasePackageFormat;
    digest: string;
    byteLength: number;
  };
  replayed: boolean;
};

export type PublicationFailure = {
  code:
    | 'DRAFT_VERSION_CONFLICT'
    | 'ACTIVE_RELEASE_CONFLICT'
    | 'CANDIDATE_FINGERPRINT_CONFLICT'
    | 'RESOURCE_REVISION_CONFLICT'
    | 'INVALID_SCHOOL_CONFIGURATION';
  draftVersion?: number;
  activeReleaseId?: string | null;
  candidateFingerprint?: string;
  affectedValue?: string;
};

export class DraftVersionConflictError extends Error {
  readonly code = 'DRAFT_VERSION_CONFLICT';
  constructor(readonly draftVersion: number) {
    super('The shared School Configuration Draft changed');
    this.name = 'DraftVersionConflictError';
  }
}

export class ResourceRevisionConflictError extends Error {
  readonly code = 'RESOURCE_REVISION_CONFLICT';
  constructor() {
    super('The authored resource revision changed');
    this.name = 'ResourceRevisionConflictError';
  }
}

export class ActiveReleaseConflictError extends Error {
  readonly code = 'ACTIVE_RELEASE_CONFLICT';
  constructor(readonly activeReleaseId: string | null) {
    super('The active School Configuration Release changed');
    this.name = 'ActiveReleaseConflictError';
  }
}

export class CandidateFingerprintConflictError extends Error {
  readonly code = 'CANDIDATE_FINGERPRINT_CONFLICT';
  constructor(readonly candidateFingerprint: string) {
    super('The School Configuration Release Candidate changed');
    this.name = 'CandidateFingerprintConflictError';
  }
}

export class OperationIdReusedError extends Error {
  readonly code = 'OPERATION_ID_REUSED';
  constructor() {
    super('The operation ID is already bound to different input');
    this.name = 'OperationIdReusedError';
  }
}

export class AuthenticationFreshnessRequiredError extends Error {
  readonly code = 'AUTHENTICATION_FRESHNESS_REQUIRED';
  constructor() {
    super('Fresh password and authenticator verification is required');
    this.name = 'AuthenticationFreshnessRequiredError';
  }
}

export class InvalidSchoolConfigurationError extends Error {
  readonly code = 'INVALID_SCHOOL_CONFIGURATION';
  constructor(readonly affectedValue?: string) {
    super('The School Configuration Release Candidate is not publishable');
    this.name = 'InvalidSchoolConfigurationError';
  }
}

export function publicationFailureFromError(
  error: unknown,
): PublicationFailure | undefined {
  if (error instanceof DraftVersionConflictError) {
    return { code: error.code, draftVersion: error.draftVersion };
  }
  if (error instanceof ActiveReleaseConflictError) {
    return { code: error.code, activeReleaseId: error.activeReleaseId };
  }
  if (error instanceof CandidateFingerprintConflictError) {
    return {
      code: error.code,
      candidateFingerprint: error.candidateFingerprint,
    };
  }
  if (error instanceof ResourceRevisionConflictError) {
    return { code: error.code };
  }
  if (error instanceof InvalidSchoolConfigurationError) {
    return { code: error.code, affectedValue: error.affectedValue };
  }
  return undefined;
}

export function errorFromPublicationFailure(
  failure: PublicationFailure,
): Error {
  if (failure.code === 'DRAFT_VERSION_CONFLICT') {
    return new DraftVersionConflictError(failure.draftVersion ?? 0);
  }
  if (failure.code === 'ACTIVE_RELEASE_CONFLICT') {
    return new ActiveReleaseConflictError(failure.activeReleaseId ?? null);
  }
  if (failure.code === 'CANDIDATE_FINGERPRINT_CONFLICT') {
    return new CandidateFingerprintConflictError(
      failure.candidateFingerprint ?? '',
    );
  }
  if (failure.code === 'RESOURCE_REVISION_CONFLICT') {
    return new ResourceRevisionConflictError();
  }
  return new InvalidSchoolConfigurationError(failure.affectedValue);
}

export type ReleasePackageStorage = {
  putIfAbsent(input: {
    bucket: typeof releasePackageBucket;
    key: string;
    bytes: Uint8Array;
    digest: string;
  }): Promise<'created' | 'matched'>;
};

export type StoredSchoolConfigurationDraft = {
  workspaceId: string;
  draftVersion: number;
  activeReleaseId: string | null;
  activeReleaseNumber: number | null;
  activeCandidateFingerprint: string | null;
  candidateFingerprint: string;
  candidate: unknown;
};

export type SchoolConfigurationStore = {
  withPublicationLock<Result>(input: {
    workspaceId: string;
    operationId: string;
    run(): Promise<Result>;
  }): Promise<Result>;
  withPackageLock<Result>(input: {
    workspaceId: string;
    packageDigest: string;
    run(): Promise<Result>;
  }): Promise<Result>;
  readDraft(
    session: AdministrativeSessionContext,
  ): Promise<StoredSchoolConfigurationDraft | undefined>;
  readActiveReleaseResources(
    session: AdministrativeSessionContext,
  ): Promise<ExactResource[]>;
  saveDraft(input: {
    session: AdministrativeSessionContext;
    operationId: string;
    requestFingerprint: string;
    expectedDraftVersion: number;
    expectedResourceRevisions: { resourceId: string; revisionNumber: number }[];
    candidate: unknown;
    candidateFingerprint: string;
    resources: ExactResource[];
    reviews: ExactTranslationReview[];
    discardedResourceIds: string[];
    changedAt: Date;
    auditId: string;
  }): Promise<{ draftVersion: number }>;
  importDraft(input: {
    session: AdministrativeSessionContext;
    operationId: string;
    requestFingerprint: string;
    expectedDraftVersion: number;
    candidate: unknown;
    candidateFingerprint: string;
    resources: ExactResource[];
    reviews: ExactTranslationReview[];
    changedAt: Date;
  }): Promise<ImportSchoolConfigurationDraftResult>;
  preparePublication(input: {
    session: AdministrativeSessionContext;
    operationId: string;
    requestFingerprint: string;
    proposedReleaseId: string;
    preparedAt: Date;
  }): Promise<
    | { outcome: 'prepared'; releaseId: string }
    | { outcome: 'replayed'; result: PublishSchoolConfigurationReleaseResult }
  >;
  recordPublicationFailure(input: {
    session: AdministrativeSessionContext;
    operationId: string;
    requestFingerprint: string;
    failure: PublicationFailure;
    failedAt: Date;
  }): Promise<void>;
  activatePublication(input: {
    session: AdministrativeSessionContext;
    sessionHandle: string;
    operationId: string;
    requestFingerprint: string;
    releaseId: string;
    expectedActiveReleaseId: string | null;
    expectedDraftVersion: number;
    candidateFingerprint: string;
    changeDescription: string;
    packageDigest: string;
    packageByteLength: number;
    packageObjectKey: string;
    resources: ExactResource[];
    publishedAt: Date;
    auditId: string;
    outboxId: string;
  }): Promise<PublishSchoolConfigurationReleaseResult>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new InvalidSchoolConfigurationError();
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  throw new InvalidSchoolConfigurationError();
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function fingerprintCandidate(candidate: unknown): string {
  return sha256(
    canonicalJson({
      algorithm: candidateFingerprintAlgorithm,
      minimumClientContractVersion,
      packageFormat: releasePackageFormat,
      candidate,
    }),
  );
}

function candidateWorkspace(candidate: unknown): {
  workspace: Record<string, unknown>;
  release: Record<string, unknown>;
} {
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.workspace) ||
    !isRecord(candidate.release)
  ) {
    throw new InvalidSchoolConfigurationError('workspace');
  }
  const workspace = candidate.workspace;
  const release = candidate.release;
  if (
    typeof workspace.id !== 'string' ||
    !isRecord(workspace.branding) ||
    !Array.isArray(release.modules) ||
    release.modules.length === 0 ||
    !isRecord(release.intakeForm) ||
    !isRecord(release.submissionAttestation) ||
    release.canonicalLocale !== 'en-US' ||
    !Array.isArray(release.supportedLocales) ||
    release.supportedLocales.length !== supportedLocales.length ||
    supportedLocales.some(
      (locale) => !(release.supportedLocales as unknown[]).includes(locale),
    )
  ) {
    throw new InvalidSchoolConfigurationError('workspace');
  }
  return { workspace, release };
}

function assertReviewedTranslations(candidate: unknown): void {
  let affected: string | undefined;
  const reviewProvenanceId =
    isRecord(candidate) &&
    isRecord(candidate.reviewProvenance) &&
    typeof candidate.reviewProvenance.id === 'string'
      ? candidate.reviewProvenance.id
      : undefined;
  if (!reviewProvenanceId) {
    throw new InvalidSchoolConfigurationError('reviewProvenance');
  }
  function visit(value: unknown, path: string): void {
    if (affected) return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    const keys = Object.keys(value);
    const localeKeys = supportedLocales.filter((locale) => locale in value);
    if (localeKeys.length > 0) {
      if (localeKeys.length !== supportedLocales.length) {
        affected = path;
        return;
      }
      for (const locale of supportedLocales) {
        const localized = value[locale];
        if (
          !isRecord(localized) ||
          typeof localized.value !== 'string' ||
          localized.value.trim().length === 0 ||
          typeof localized.id !== 'string' ||
          !Number.isInteger(localized.revision) ||
          Number(localized.revision) < 1 ||
          !/^(?:[^<>]|<strong>[^<>]*<\/strong>)*$/.test(localized.value)
        ) {
          affected = `${path}.${locale}`;
          return;
        }
        if (locale === 'en-US') continue;
        const sourceRevision = Number(
          isRecord(value['en-US']) ? value['en-US'].revision : 0,
        );
        const boundRevision = Number(localized.sourceRevision ?? 1);
        if (
          typeof localized.reviewProvenanceId !== 'string' ||
          boundRevision !== sourceRevision
        ) {
          affected = `${path}.${locale}`;
          return;
        }
      }
    }
    for (const key of keys) visit(value[key], path ? `${path}.${key}` : key);
  }
  visit(candidate, 'candidate');
  if (affected) throw new InvalidSchoolConfigurationError(affected);
}

function assertLocalizedValue(value: unknown, path: string): void {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== supportedLocales.length
  ) {
    throw new InvalidSchoolConfigurationError(path);
  }
  for (const locale of supportedLocales) {
    if (!(locale in value)) {
      throw new InvalidSchoolConfigurationError(`${path}.${locale}`);
    }
  }
}

function assertRevisioned(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 1
  ) {
    throw new InvalidSchoolConfigurationError(path);
  }
  return value;
}

export function validateCandidate(
  candidate: unknown,
  workspaceId: string,
): void {
  const { workspace, release } = candidateWorkspace(candidate);
  if (workspace.id !== workspaceId) {
    throw new InvalidSchoolConfigurationError('workspace.id');
  }
  const branding = assertRevisioned(workspace.branding, 'workspace.branding');
  assertLocalizedValue(branding.displayName, 'workspace.branding.displayName');
  assertLocalizedValue(branding.shortName, 'workspace.branding.shortName');
  if (
    typeof branding.primaryColor !== 'string' ||
    typeof branding.accentColor !== 'string'
  ) {
    throw new InvalidSchoolConfigurationError('workspace.branding.colors');
  }
  for (const [index, value] of (release.modules as unknown[]).entries()) {
    const module = assertRevisioned(value, `release.modules[${index}]`);
    assertLocalizedValue(module.title, `release.modules[${index}].title`);
    assertLocalizedValue(
      module.description,
      `release.modules[${index}].description`,
    );
    for (const collection of [
      'knowledgeItems',
      'skillItems',
      'applicationItems',
    ] as const) {
      const items = module[collection];
      if (!Array.isArray(items) || items.length === 0) {
        throw new InvalidSchoolConfigurationError(
          `release.modules[${index}].${collection}`,
        );
      }
      items.forEach((item, itemIndex) => {
        const revision = assertRevisioned(
          item,
          `release.modules[${index}].${collection}[${itemIndex}]`,
        );
        assertLocalizedValue(
          revision.text,
          `release.modules[${index}].${collection}[${itemIndex}].text`,
        );
      });
    }
  }
  const intake = release.intakeForm as Record<string, unknown>;
  assertRevisioned(intake, 'release.intakeForm');
  assertLocalizedValue(intake.title, 'release.intakeForm.title');
  if (!Array.isArray(intake.sections) || intake.sections.length === 0) {
    throw new InvalidSchoolConfigurationError('release.intakeForm.sections');
  }
  if (!Array.isArray(intake.fields) || intake.fields.length === 0) {
    throw new InvalidSchoolConfigurationError('release.intakeForm.fields');
  }
  intake.sections.forEach((section, index) => {
    const revision = assertRevisioned(
      section,
      `release.intakeForm.sections[${index}]`,
    );
    assertLocalizedValue(
      revision.title,
      `release.intakeForm.sections[${index}].title`,
    );
  });
  intake.fields.forEach((field, index) => {
    const revision = assertRevisioned(
      field,
      `release.intakeForm.fields[${index}]`,
    );
    assertLocalizedValue(
      revision.label,
      `release.intakeForm.fields[${index}].label`,
    );
  });
  const attestation = assertRevisioned(
    release.submissionAttestation,
    'release.submissionAttestation',
  );
  assertLocalizedValue(attestation.text, 'release.submissionAttestation.text');
  assertReviewedTranslations(candidate);
  canonicalJson(candidate);
  const publicationBlockers: string[] = [];
  collectIntakeFormValidation(candidate, (_severity, code, path) => {
    if (
      code === 'INVALID_VISIBILITY_REFERENCE' ||
      code === 'CYCLIC_VISIBILITY' ||
      code === 'UNSUPPORTED_FIELD_SHAPE' ||
      code === 'MISSING_SUBMISSION_ATTESTATION' ||
      code === 'DUPLICATE_OPTION_CODE' ||
      code === 'INVALID_FIELD_REFERENCE'
    ) {
      publicationBlockers.push(path);
    }
  });
  if (publicationBlockers[0]) {
    throw new InvalidSchoolConfigurationError(publicationBlockers[0]);
  }
}

export function extractExactResources(candidate: unknown): ExactResource[] {
  const resources = new Map<string, ExactResource>();
  function visit(value: unknown, path: string, position: number | null): void {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, path, index + 1));
      return;
    }
    if (!isRecord(value)) return;
    if (
      typeof value.id === 'string' &&
      Number.isInteger(value.revision) &&
      Number(value.revision) > 0
    ) {
      const key = `${value.id}:${value.revision}`;
      if (resources.has(key)) {
        throw new InvalidSchoolConfigurationError(path);
      }
      resources.set(key, {
        resourceId: value.id,
        revisionNumber: Number(value.revision),
        kind: path.split('.').at(-1) ?? 'resource',
        slot: path,
        position,
        payload: value,
      });
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, path ? `${path}.${key}` : key, null);
    }
  }
  visit(candidate, 'candidate', null);
  return [...resources.values()].sort((left, right) =>
    left.resourceId.localeCompare(right.resourceId),
  );
}

export function extractTranslationReviews(
  candidate: unknown,
): ExactTranslationReview[] {
  const global =
    isRecord(candidate) && isRecord(candidate.reviewProvenance)
      ? candidate.reviewProvenance
      : undefined;
  const globalReviewedAt =
    global && typeof global.recordedAt === 'string'
      ? new Date(global.recordedAt)
      : undefined;
  const reviews: ExactTranslationReview[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    const source = isRecord(value['en-US']) ? value['en-US'] : undefined;
    if (source && typeof source.id === 'string') {
      for (const locale of managedLocales) {
        const translation = value[locale];
        if (
          !isRecord(translation) ||
          typeof translation.id !== 'string' ||
          typeof translation.reviewProvenanceId !== 'string'
        ) {
          continue;
        }
        const reviewedAt =
          typeof translation.reviewedAt === 'string'
            ? new Date(translation.reviewedAt)
            : globalReviewedAt;
        if (!reviewedAt || Number.isNaN(reviewedAt.getTime())) continue;
        reviews.push({
          sourceResourceId: String(source.id),
          sourceRevisionNumber: Number(source.revision),
          translationResourceId: String(translation.id),
          translationRevisionNumber: Number(translation.revision),
          locale,
          reviewProvenanceId: String(translation.reviewProvenanceId),
          reviewer:
            typeof translation.reviewer === 'string'
              ? translation.reviewer
              : typeof global?.actor === 'string'
                ? global.actor
                : 'administrator',
          reviewedAt,
        });
      }
    }
    Object.values(value).forEach(visit);
  }
  visit(candidate);
  return reviews;
}

const hexColorPattern = /^#[0-9A-Fa-f]{6}$/;
const safeRichTextPattern = /^(?:[^<>]|<strong>[^<>]*<\/strong>)*$/;
const generatedTextMarkPattern = /^[A-Za-z0-9]{1,4}$/;
const allowedBrandingKeys = new Set([
  'id',
  'revision',
  'displayName',
  'shortName',
  'generatedTextMark',
  'primaryColor',
  'accentColor',
  'officialInstitutionalMarks',
  'secondaryMark',
  'affiliationDisclaimer',
  'logo',
]);
const allowedAssetTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

function cloneCandidate(candidate: unknown): unknown {
  return structuredClone(candidate);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(left: string, right: string): number {
  const first = relativeLuminance(left);
  const second = relativeLuminance(right);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function canonicalMeaning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalMeaning);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => key !== 'order')
      .map((key) => [key, canonicalMeaning(value[key])]),
  );
}

function indexRevisioned(
  value: unknown,
  map: Map<string, Record<string, unknown>>,
): void {
  if (Array.isArray(value)) {
    value.forEach((child) => indexRevisioned(child, map));
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.id === 'string' && Number.isInteger(value.revision)) {
    map.set(value.id, value);
  }
  Object.values(value).forEach((child) => indexRevisioned(child, map));
}

function assignCanonicalRevisions(previous: unknown, next: unknown): unknown {
  const previousById = new Map<string, Record<string, unknown>>();
  indexRevisioned(previous, previousById);
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!isRecord(value)) return value;
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      copy[key] = visit(child);
    }
    if (typeof copy.id === 'string' && Number.isInteger(copy.revision)) {
      const prior = previousById.get(copy.id);
      if (prior) {
        copy.revision =
          canonicalJson(canonicalMeaning(prior)) ===
          canonicalJson(canonicalMeaning(copy))
            ? prior.revision
            : Number(prior.revision) + 1;
      }
    }
    return copy;
  }
  return visit(next);
}

function findRevisioned(
  value: unknown,
  resourceId: string,
): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findRevisioned(child, resourceId);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.id === resourceId) return value;
  for (const child of Object.values(value)) {
    const found = findRevisioned(child, resourceId);
    if (found) return found;
  }
  return undefined;
}

function replaceRevisioned(
  value: unknown,
  resourceId: string,
  replacement: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map((child) => {
      if (isRecord(child) && child.id === resourceId) return replacement;
      return replaceRevisioned(child, resourceId, replacement);
    });
  }
  if (!isRecord(value)) return value;
  if (value.id === resourceId) return replacement;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      replaceRevisioned(child, resourceId, replacement),
    ]),
  );
}

function removeRevisioned(value: unknown, resourceId: string): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((child) => !(isRecord(child) && child.id === resourceId))
      .map((child) => removeRevisioned(child, resourceId));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      removeRevisioned(child, resourceId),
    ]),
  );
}

function collectResourceIds(value: unknown, ids: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((child) => collectResourceIds(child, ids));
    return ids;
  }
  if (!isRecord(value)) return ids;
  if (typeof value.id === 'string') ids.push(value.id);
  Object.values(value).forEach((child) => collectResourceIds(child, ids));
  return ids;
}

function releaseRecord(candidate: unknown): Record<string, unknown> {
  if (!isRecord(candidate) || !isRecord(candidate.release)) {
    throw new InvalidSchoolConfigurationError('release');
  }
  return candidate.release;
}

function modulesArray(candidate: unknown): Record<string, unknown>[] {
  const modules = releaseRecord(candidate).modules;
  if (!Array.isArray(modules)) {
    throw new InvalidSchoolConfigurationError('release.modules');
  }
  return modules.filter(isRecord);
}

function intakeFormRecord(candidate: unknown): Record<string, unknown> {
  const intake = releaseRecord(candidate).intakeForm;
  if (!isRecord(intake)) {
    throw new InvalidSchoolConfigurationError('release.intakeForm');
  }
  return intake;
}

function intakeSections(candidate: unknown): Record<string, unknown>[] {
  const sections = intakeFormRecord(candidate).sections;
  if (!Array.isArray(sections)) {
    throw new InvalidSchoolConfigurationError('release.intakeForm.sections');
  }
  return sections.filter(isRecord);
}

function intakeFields(candidate: unknown): Record<string, unknown>[] {
  const fields = intakeFormRecord(candidate).fields;
  if (!Array.isArray(fields)) {
    throw new InvalidSchoolConfigurationError('release.intakeForm.fields');
  }
  return fields.filter(isRecord);
}

function intakeOptions(
  field: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!Array.isArray(field.options)) return [];
  return field.options.filter(isRecord);
}

const optionCodePattern = /^[a-z][a-z0-9_-]{0,63}$/;

function slugKey(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || fallback;
}

function applyExplicitOrder(candidate: unknown): void {
  modulesArray(candidate).forEach((module, index) => {
    module.order = index + 1;
    for (const collection of [
      'knowledgeItems',
      'skillItems',
      'applicationItems',
      'pronunciationTerms',
    ] as const) {
      const items = module[collection];
      if (!Array.isArray(items)) continue;
      items.filter(isRecord).forEach((item, itemIndex) => {
        item.order = itemIndex + 1;
      });
    }
  });
  const intake = intakeFormRecord(candidate);
  intakeSections(candidate).forEach((section, index) => {
    section.order = index + 1;
  });
  intakeFields(candidate).forEach((field, index) => {
    field.order = index + 1;
    intakeOptions(field).forEach((option, optionIndex) => {
      option.order = optionIndex + 1;
    });
  });
  intake.sections = intakeSections(candidate);
  intake.fields = intakeFields(candidate);
}

function setEnglishSource(
  localized: unknown,
  value: string,
  path: string,
): Record<string, unknown> {
  if (!isRecord(localized) || !isRecord(localized['en-US'])) {
    throw new InvalidSchoolConfigurationError(path);
  }
  if (localized['en-US'].value === value) return localized;
  return {
    ...localized,
    'en-US': {
      id: localized['en-US'].id,
      revision: localized['en-US'].revision,
      value,
      origin: 'administrator-authored',
    },
  };
}

function assertSafeRichText(value: string, path: string): void {
  if (!safeRichTextPattern.test(value)) {
    throw new InvalidSchoolConfigurationError(path);
  }
}

function assertHexColor(value: string, path: string): void {
  if (!hexColorPattern.test(value)) {
    throw new InvalidSchoolConfigurationError(path);
  }
}

function assertSafeHref(href: string, path: string): void {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    throw new InvalidSchoolConfigurationError(path);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new InvalidSchoolConfigurationError(path);
  }
}

function assertSafeAsset(asset: BrandingAsset, path: string): void {
  if (
    !allowedAssetTypes.has(asset.mediaType) ||
    !Number.isInteger(asset.width) ||
    !Number.isInteger(asset.height) ||
    !Number.isInteger(asset.byteLength) ||
    asset.width < 1 ||
    asset.width > 1024 ||
    asset.height < 1 ||
    asset.height > 1024 ||
    asset.byteLength < 1 ||
    asset.byteLength > 262144 ||
    typeof asset.src !== 'string'
  ) {
    throw new InvalidSchoolConfigurationError(path);
  }
  const svg = asset.mediaType === 'image/svg+xml';
  if (asset.src.startsWith('https://')) {
    assertSafeHref(asset.src, path);
    return;
  }
  const dataPrefix = `data:${asset.mediaType}`;
  if (!asset.src.startsWith(dataPrefix)) {
    throw new InvalidSchoolConfigurationError(path);
  }
  if (svg && /<script|onload=|onerror=|javascript:/i.test(asset.src)) {
    throw new InvalidSchoolConfigurationError(path);
  }
}

function createEnglishLocalized(
  ids: IdGenerator,
  value: string,
): Record<string, unknown> {
  return {
    'en-US': {
      id: ids.create(),
      revision: 1,
      value,
      origin: 'administrator-authored',
    },
  };
}

function createModuleItem(
  ids: IdGenerator,
  text: string,
  href?: string | null,
): Record<string, unknown> {
  return {
    id: ids.create(),
    revision: 1,
    order: 1,
    text: createEnglishLocalized(ids, text),
    ...(href ? { href } : {}),
  };
}

function createLearningModule(
  ids: IdGenerator,
  title: string,
  description: string,
): Record<string, unknown> {
  return {
    id: ids.create(),
    revision: 1,
    order: 1,
    key: 'custom',
    iconKey: 'custom',
    title: createEnglishLocalized(ids, title),
    description: createEnglishLocalized(ids, description),
    knowledgeIntroduction: createEnglishLocalized(ids, description),
    knowledgeItems: [createModuleItem(ids, 'New knowledge key point')],
    skillItems: [createModuleItem(ids, 'I can describe this skill.')],
    applicationItems: [
      createModuleItem(ids, 'Complete this application step.'),
    ],
    pronunciationTerms: [],
  };
}

function createIntakeOption(
  ids: IdGenerator,
  code: string,
  label: string,
): Record<string, unknown> {
  return {
    id: ids.create(),
    revision: 1,
    order: 1,
    code,
    label: createEnglishLocalized(ids, label),
  };
}

function createIntakeSection(
  ids: IdGenerator,
  title: string,
): Record<string, unknown> {
  const id = ids.create();
  return {
    id,
    revision: 1,
    key: slugKey(title, `section-${id.slice(0, 8)}`),
    order: 1,
    title: createEnglishLocalized(ids, title),
  };
}

function defaultChoiceOptions(
  ids: IdGenerator,
  fieldType: string,
): Record<string, unknown>[] {
  if (fieldType === 'yes-no') {
    return [
      createIntakeOption(ids, 'yes', 'Yes'),
      createIntakeOption(ids, 'no', 'No'),
    ];
  }
  if (fieldType === 'single-choice' || fieldType === 'multiple-choice') {
    return [
      createIntakeOption(ids, 'option-a', 'Option A'),
      createIntakeOption(ids, 'option-b', 'Option B'),
    ];
  }
  return [];
}

function createIntakeField(
  ids: IdGenerator,
  sectionId: string,
  fieldType: string,
  label: string,
): Record<string, unknown> {
  const id = ids.create();
  const options = defaultChoiceOptions(ids, fieldType);
  return {
    id,
    revision: 1,
    key: slugKey(label, `field-${id.slice(0, 8)}`),
    sectionId,
    order: 1,
    type: fieldType,
    required: fieldType === 'acknowledgement' ? true : false,
    requiredWhenVisible: false,
    defaultValue: null,
    label: createEnglishLocalized(ids, label),
    visibility: null,
    ...(options.length > 0 ? { options } : {}),
  };
}

function reorderByIds(
  records: Record<string, unknown>[],
  orderedResourceIds: string[],
  path: string,
): Record<string, unknown>[] {
  const byId = new Map(records.map((record) => [String(record.id), record]));
  if (
    orderedResourceIds.length !== records.length ||
    orderedResourceIds.some((id) => !byId.has(id))
  ) {
    throw new InvalidSchoolConfigurationError(path);
  }
  return orderedResourceIds.map(
    (id) => byId.get(id) as Record<string, unknown>,
  );
}

function localizedPath(path: string, locale: string): string {
  return `${path}.${locale}`;
}

export function collectValidationResults(
  candidate: unknown,
  workspaceId: string,
): { blockers: ValidationResult[]; warnings: ValidationResult[] } {
  const blockers: ValidationResult[] = [];
  const warnings: ValidationResult[] = [];
  function add(
    severity: 'blocker' | 'warning',
    code: string,
    path: string,
    message: string,
  ) {
    (severity === 'blocker' ? blockers : warnings).push({
      code,
      path,
      message,
      severity,
    });
  }
  try {
    candidateWorkspace(candidate);
  } catch (error) {
    if (error instanceof InvalidSchoolConfigurationError) {
      add(
        'blocker',
        'INVALID_SCHOOL_CONFIGURATION',
        error.affectedValue ?? 'workspace',
        error.message,
      );
      return { blockers, warnings };
    }
    throw error;
  }
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.workspace) ||
    candidate.workspace.id !== workspaceId
  ) {
    add(
      'blocker',
      'INVALID_SCHOOL_CONFIGURATION',
      'workspace.id',
      'Workspace identity does not match.',
    );
    return { blockers, warnings };
  }
  const branding = isRecord(candidate.workspace.branding)
    ? candidate.workspace.branding
    : undefined;
  if (branding) {
    for (const key of Object.keys(branding)) {
      if (!allowedBrandingKeys.has(key)) {
        add(
          'blocker',
          'CONSTRAINED_BRANDING',
          `workspace.branding.${key}`,
          'Workspace Branding cannot include custom fonts, CSS, or unconstrained fields.',
        );
      }
    }
    if (
      typeof branding.primaryColor !== 'string' ||
      !hexColorPattern.test(branding.primaryColor)
    ) {
      add(
        'blocker',
        'INVALID_COLOR',
        'workspace.branding.primaryColor',
        'Primary color must be a six-digit hex value.',
      );
    } else if (contrastRatio(branding.primaryColor, '#ffffff') < 4.5) {
      add(
        'blocker',
        'INACCESSIBLE_CONTRAST',
        'workspace.branding.primaryColor',
        'Primary color does not meet accessible contrast against white.',
      );
    }
    if (
      typeof branding.accentColor !== 'string' ||
      !hexColorPattern.test(branding.accentColor)
    ) {
      add(
        'blocker',
        'INVALID_COLOR',
        'workspace.branding.accentColor',
        'Accent color must be a six-digit hex value.',
      );
    } else if (contrastRatio(branding.accentColor, '#ffffff') < 4.5) {
      add(
        'blocker',
        'INACCESSIBLE_CONTRAST',
        'workspace.branding.accentColor',
        'Accent color does not meet accessible contrast against white.',
      );
    }
    if (
      typeof branding.generatedTextMark !== 'string' ||
      !generatedTextMarkPattern.test(branding.generatedTextMark)
    ) {
      add(
        'blocker',
        'CONSTRAINED_BRANDING',
        'workspace.branding.generatedTextMark',
        'The generated text mark must be one to four letters or digits.',
      );
    }
    if (branding.logo != null) {
      try {
        if (!isRecord(branding.logo)) {
          throw new InvalidSchoolConfigurationError();
        }
        assertSafeAsset(
          branding.logo as BrandingAsset,
          'workspace.branding.logo',
        );
      } catch {
        add(
          'blocker',
          'INVALID_ASSET',
          'workspace.branding.logo',
          'The school mark is not a safe, constrained branding asset.',
        );
      }
    }
    if (branding.secondaryMark != null) {
      try {
        if (!isRecord(branding.secondaryMark)) {
          throw new InvalidSchoolConfigurationError();
        }
        assertSafeAsset(
          branding.secondaryMark as BrandingAsset,
          'workspace.branding.secondaryMark',
        );
      } catch {
        add(
          'blocker',
          'INVALID_ASSET',
          'workspace.branding.secondaryMark',
          'The secondary mark is not a safe, constrained branding asset.',
        );
      }
    }
  }
  function visitLocalized(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    const localeKeys = supportedLocales.filter((locale) => locale in value);
    if (localeKeys.length > 0) {
      const source = isRecord(value['en-US']) ? value['en-US'] : undefined;
      for (const locale of supportedLocales) {
        const localized = value[locale];
        if (!isRecord(localized) || typeof localized.value !== 'string') {
          add(
            'blocker',
            'MISSING_TRANSLATION',
            localizedPath(path, locale),
            'Every supported language needs a complete Managed Translation before publication.',
          );
          continue;
        }
        if (localized.value.trim().length === 0) {
          add(
            'blocker',
            'MISSING_TRANSLATION',
            localizedPath(path, locale),
            'Translated values cannot be empty.',
          );
        }
        if (!safeRichTextPattern.test(localized.value)) {
          add(
            'blocker',
            'UNSAFE_RICH_TEXT',
            localizedPath(path, locale),
            'Only plain text and <strong> emphasis are allowed.',
          );
        }
        if (locale === 'en-US') continue;
        const sourceRevision = Number(source?.revision ?? 0);
        const boundRevision = Number(localized.sourceRevision ?? 1);
        const reviewed =
          typeof localized.reviewProvenanceId === 'string' &&
          boundRevision === sourceRevision;
        if (!reviewed) {
          add(
            'blocker',
            'STALE_TRANSLATION',
            localizedPath(path, locale),
            'This Managed Translation is missing, stale, or unreviewed for the current English source.',
          );
        }
      }
      return;
    }
    Object.entries(value).forEach(([key, child]) =>
      visit(child, path ? `${path}.${key}` : key),
    );
  }
  function visit(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.href === 'string' && value.href.length > 0) {
      try {
        assertSafeHref(value.href, `${path}.href`);
      } catch {
        add(
          'blocker',
          'INVALID_URL',
          `${path}.href`,
          'Application links must be HTTPS URLs without credentials.',
        );
      }
    }
    visitLocalized(value, path);
  }
  visit(candidate, 'candidate');
  const modules =
    isRecord(candidate) && isRecord(candidate.release)
      ? candidate.release.modules
      : undefined;
  if (!Array.isArray(modules) || modules.length === 0) {
    add(
      'blocker',
      'EMPTY_REQUIRED_SECTION',
      'release.modules',
      'A release needs at least one active Learning Module.',
    );
  } else {
    modules.filter(isRecord).forEach((module, index) => {
      for (const collection of [
        'knowledgeItems',
        'skillItems',
        'applicationItems',
      ] as const) {
        const items = module[collection];
        if (!Array.isArray(items) || items.length === 0) {
          add(
            'blocker',
            'EMPTY_REQUIRED_SECTION',
            `release.modules[${index}].${collection}`,
            'Knowledge, Skills, and Application each need at least one authored item.',
          );
        }
      }
    });
  }
  collectIntakeFormValidation(candidate, add);
  return { blockers, warnings };
}

function collectIntakeFormValidation(
  candidate: unknown,
  add: (
    severity: 'blocker' | 'warning',
    code: string,
    path: string,
    message: string,
  ) => void,
): void {
  if (!isRecord(candidate) || !isRecord(candidate.release)) return;
  const intake = candidate.release.intakeForm;
  const attestation = candidate.release.submissionAttestation;
  if (
    !isRecord(intake) ||
    !Array.isArray(intake.sections) ||
    !Array.isArray(intake.fields)
  ) {
    add(
      'blocker',
      'EMPTY_REQUIRED_SECTION',
      'release.intakeForm',
      'A release needs one Intake Form with ordered sections and fields.',
    );
    return;
  }
  if (intake.sections.length === 0) {
    add(
      'blocker',
      'EMPTY_REQUIRED_SECTION',
      'release.intakeForm.sections',
      'The Intake Form needs at least one section.',
    );
  }
  if (intake.fields.length === 0) {
    add(
      'blocker',
      'EMPTY_REQUIRED_SECTION',
      'release.intakeForm.fields',
      'The Intake Form needs at least one field.',
    );
  }
  const sections = intake.sections.filter(isRecord);
  const fields = intake.fields.filter(isRecord);
  const sectionIds = new Set(sections.map((section) => String(section.id)));
  const fieldById = new Map(
    fields.map((field) => [String(field.id), field] as const),
  );
  const fieldIndex = new Map(
    fields.map((field, index) => [String(field.id), index]),
  );
  const visibilityEdges: Array<{ from: string; to: string; path: string }> = [];

  if (
    !isRecord(attestation) ||
    !isRecord(attestation.text) ||
    !isRecord(attestation.text['en-US']) ||
    typeof attestation.text['en-US'].value !== 'string' ||
    attestation.text['en-US'].value.trim().length === 0
  ) {
    add(
      'blocker',
      'MISSING_SUBMISSION_ATTESTATION',
      'release.submissionAttestation.text',
      'Submission Attestation content is required before publication.',
    );
  }

  fields.forEach((field, index) => {
    const fieldId = String(field.id);
    const path = `release.intakeForm.fields.${fieldId}`;
    if (
      typeof field.sectionId !== 'string' ||
      !sectionIds.has(field.sectionId)
    ) {
      add(
        'blocker',
        'INVALID_FIELD_REFERENCE',
        `${path}.sectionId`,
        'Each field must belong to an earlier authored section.',
      );
    }
    if (!isSupportedIntakeFieldType(field.type)) {
      add(
        'blocker',
        'UNSUPPORTED_FIELD_SHAPE',
        `${path}.type`,
        'This field type is not part of the supported Intake Form model.',
      );
    }
    const options = intakeOptions(field);
    const choice = isChoiceIntakeFieldType(field.type);
    if (choice && options.length === 0) {
      add(
        'blocker',
        'UNSUPPORTED_FIELD_SHAPE',
        `${path}.options`,
        'Choice fields need locale-neutral coded options.',
      );
    }
    if (!choice && options.length > 0) {
      add(
        'blocker',
        'UNSUPPORTED_FIELD_SHAPE',
        `${path}.options`,
        'Only choice fields may include coded options.',
      );
    }
    if (field.type === 'yes-no') {
      const codes = new Set(options.map((option) => option.code));
      if (!codes.has('yes') || !codes.has('no')) {
        add(
          'blocker',
          'UNSUPPORTED_FIELD_SHAPE',
          `${path}.options`,
          'Yes/no fields need stable yes and no option codes.',
        );
      }
    }
    const seenCodes = new Set<string>();
    options.forEach((option, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      if (
        typeof option.code !== 'string' ||
        !optionCodePattern.test(option.code)
      ) {
        add(
          'blocker',
          'UNSUPPORTED_FIELD_SHAPE',
          `${optionPath}.code`,
          'Option meaning must use a locale-neutral code, not a label or position.',
        );
        return;
      }
      if (seenCodes.has(option.code)) {
        add(
          'blocker',
          'DUPLICATE_OPTION_CODE',
          `${optionPath}.code`,
          'Option codes must be unique within a field.',
        );
      }
      seenCodes.add(option.code);
    });
    if (field.visibility != null) {
      const visibilityPath = `${path}.visibility`;
      const visibility = field.visibility;
      if (
        !isRecord(visibility) ||
        typeof visibility.fieldId !== 'string' ||
        typeof visibility.equalsOptionCode !== 'string'
      ) {
        add(
          'blocker',
          'INVALID_VISIBILITY_REFERENCE',
          visibilityPath,
          'Visibility rules must name an earlier choice field and one of its codes.',
        );
      } else {
        const controller = fieldById.get(visibility.fieldId);
        const controllerIndex = fieldIndex.get(visibility.fieldId);
        const optionCode = visibility.equalsOptionCode;
        visibilityEdges.push({
          from: fieldId,
          to: visibility.fieldId,
          path: visibilityPath,
        });
        if (!controller || controllerIndex === undefined) {
          add(
            'blocker',
            'INVALID_VISIBILITY_REFERENCE',
            visibilityPath,
            'Visibility rules cannot reference a missing field.',
          );
        } else if (!isChoiceIntakeFieldType(controller.type)) {
          add(
            'blocker',
            'INVALID_VISIBILITY_REFERENCE',
            visibilityPath,
            'Visibility rules may only reference earlier choice fields.',
          );
        } else if (controllerIndex >= index) {
          add(
            'blocker',
            'INVALID_VISIBILITY_REFERENCE',
            visibilityPath,
            'Visibility rules may only reference earlier choice fields.',
          );
        } else if (
          !intakeOptions(controller).some(
            (option) => option.code === optionCode,
          )
        ) {
          add(
            'blocker',
            'INVALID_VISIBILITY_REFERENCE',
            visibilityPath,
            'Visibility rules must use a locale-neutral option code from the controlling field.',
          );
        }
      }
    }
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const adjacency = new Map<string, string[]>();
  for (const edge of visibilityEdges) {
    const current = adjacency.get(edge.from) ?? [];
    current.push(edge.to);
    adjacency.set(edge.from, current);
  }
  let cyclic = false;
  function walk(node: string): void {
    if (cyclic || visited.has(node)) return;
    if (visiting.has(node)) {
      cyclic = true;
      return;
    }
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) walk(next);
    visiting.delete(node);
    visited.add(node);
  }
  for (const field of fields) walk(String(field.id));
  if (cyclic) {
    add(
      'blocker',
      'CYCLIC_VISIBILITY',
      'release.intakeForm.fields',
      'Visibility rules must remain acyclic.',
    );
  }
}

export function presentDraft(
  draft: StoredSchoolConfigurationDraft,
  activeResources: ExactResource[],
): SchoolConfigurationDraft {
  const draftResources = extractExactResources(draft.candidate);
  const activeById = new Map(
    activeResources.map((resource) => [resource.resourceId, resource]),
  );
  const publishedIds = new Set(
    activeResources.map((resource) => resource.resourceId),
  );
  return {
    workspaceId: draft.workspaceId,
    draftVersion: draft.draftVersion,
    activeReleaseId: draft.activeReleaseId,
    activeReleaseNumber: draft.activeReleaseNumber,
    candidateFingerprint: draft.candidateFingerprint,
    candidate: draft.candidate,
    unpublishedChanges:
      !draft.activeCandidateFingerprint ||
      draft.candidateFingerprint !== draft.activeCandidateFingerprint,
    validation: collectValidationResults(draft.candidate, draft.workspaceId),
    comparisons: draftResources.map((resource) => {
      const active = activeById.get(resource.resourceId);
      return {
        resourceId: resource.resourceId,
        draftRevision: resource.revisionNumber,
        activeRevision: active?.revisionNumber ?? null,
        differs:
          !active ||
          canonicalJson(canonicalMeaning(active.payload)) !==
            canonicalJson(canonicalMeaning(resource.payload)),
        discardEligible: !publishedIds.has(resource.resourceId),
      };
    }),
    managedTranslations: presentManagedTranslations(draft.candidate),
  };
}

export function applyDraftEdit(input: {
  candidate: unknown;
  edit: DraftEdit;
  ids: IdGenerator;
  activePayload?: Record<string, unknown>;
  reviewer?: string;
  reviewedAt?: Date;
}): { candidate: unknown; discardedResourceIds: string[] } {
  let next = cloneCandidate(input.candidate);
  const discardedResourceIds: string[] = [];
  const edit = input.edit;
  if (edit.type === 'save-workspace-branding') {
    const branding = findRevisioned(next, edit.resourceId);
    if (!branding) {
      throw new InvalidSchoolConfigurationError('workspace.branding');
    }
    assertHexColor(edit.primaryColor, 'workspace.branding.primaryColor');
    assertHexColor(edit.accentColor, 'workspace.branding.accentColor');
    if (!generatedTextMarkPattern.test(edit.generatedTextMark)) {
      throw new InvalidSchoolConfigurationError(
        'workspace.branding.generatedTextMark',
      );
    }
    if (!edit.displayName.trim() || !edit.shortName.trim()) {
      throw new InvalidSchoolConfigurationError('workspace.branding');
    }
    assertSafeRichText(
      edit.displayName,
      'workspace.branding.displayName.en-US',
    );
    assertSafeRichText(edit.shortName, 'workspace.branding.shortName.en-US');
    if (edit.logo) assertSafeAsset(edit.logo, 'workspace.branding.logo');
    if (edit.secondaryMark) {
      assertSafeAsset(edit.secondaryMark, 'workspace.branding.secondaryMark');
    }
    branding.displayName = setEnglishSource(
      branding.displayName,
      edit.displayName.trim(),
      'workspace.branding.displayName',
    );
    branding.shortName = setEnglishSource(
      branding.shortName,
      edit.shortName.trim(),
      'workspace.branding.shortName',
    );
    branding.generatedTextMark = edit.generatedTextMark;
    branding.primaryColor = edit.primaryColor;
    branding.accentColor = edit.accentColor;
    if (edit.logo !== undefined) branding.logo = edit.logo;
    if (edit.secondaryMark !== undefined) {
      branding.secondaryMark = edit.secondaryMark;
    }
  } else if (edit.type === 'save-learning-module') {
    const module = findRevisioned(next, edit.resourceId);
    if (!module) throw new InvalidSchoolConfigurationError('release.modules');
    assertSafeRichText(
      edit.title,
      `release.modules.${edit.resourceId}.title.en-US`,
    );
    assertSafeRichText(
      edit.description,
      `release.modules.${edit.resourceId}.description.en-US`,
    );
    assertSafeRichText(
      edit.knowledgeIntroduction,
      `release.modules.${edit.resourceId}.knowledgeIntroduction.en-US`,
    );
    module.title = setEnglishSource(
      module.title,
      edit.title.trim(),
      `release.modules.${edit.resourceId}.title`,
    );
    module.description = setEnglishSource(
      module.description,
      edit.description.trim(),
      `release.modules.${edit.resourceId}.description`,
    );
    module.knowledgeIntroduction = setEnglishSource(
      module.knowledgeIntroduction,
      edit.knowledgeIntroduction.trim(),
      `release.modules.${edit.resourceId}.knowledgeIntroduction`,
    );
  } else if (edit.type === 'save-learning-module-item') {
    const item = findRevisioned(next, edit.resourceId);
    if (!item) {
      throw new InvalidSchoolConfigurationError('release.modules');
    }
    const owningModule = modulesArray(next).find((module) =>
      ['knowledgeItems', 'skillItems', 'applicationItems'].some(
        (collection) => {
          const items = module[collection];
          return (
            Array.isArray(items) &&
            items.some(
              (child) => isRecord(child) && child.id === edit.resourceId,
            )
          );
        },
      ),
    );
    const collection = owningModule
      ? (['knowledgeItems', 'skillItems', 'applicationItems'] as const).find(
          (name) => {
            const items = owningModule[name];
            return (
              Array.isArray(items) &&
              items.some(
                (child) => isRecord(child) && child.id === edit.resourceId,
              )
            );
          },
        )
      : 'knowledgeItems';
    assertSafeRichText(
      edit.text,
      `release.modules.${collection}.${edit.resourceId}.text.en-US`,
    );
    if (edit.href) {
      assertSafeHref(
        edit.href,
        `release.modules.${collection}.${edit.resourceId}.href`,
      );
    }
    item.text = setEnglishSource(
      item.text,
      edit.text.trim(),
      `release.modules.${collection}.${edit.resourceId}.text`,
    );
    if (edit.href !== undefined) {
      if (edit.href) item.href = edit.href;
      else delete item.href;
    }
  } else if (edit.type === 'reorder-learning-modules') {
    const modules = modulesArray(next);
    const byId = new Map(modules.map((module) => [String(module.id), module]));
    if (
      edit.orderedResourceIds.length !== modules.length ||
      edit.orderedResourceIds.some((id) => !byId.has(id))
    ) {
      throw new InvalidSchoolConfigurationError('release.modules');
    }
    releaseRecord(next).modules = edit.orderedResourceIds.map(
      (id) => byId.get(id) as Record<string, unknown>,
    );
  } else if (edit.type === 'reorder-learning-module-items') {
    const module = findRevisioned(next, edit.moduleId);
    if (!module) throw new InvalidSchoolConfigurationError('release.modules');
    const items = module[edit.collection];
    if (!Array.isArray(items)) {
      throw new InvalidSchoolConfigurationError(
        `release.modules.${edit.collection}`,
      );
    }
    const records = items.filter(isRecord);
    const byId = new Map(records.map((item) => [String(item.id), item]));
    if (
      edit.orderedResourceIds.length !== records.length ||
      edit.orderedResourceIds.some((id) => !byId.has(id))
    ) {
      throw new InvalidSchoolConfigurationError(
        `release.modules.${edit.collection}`,
      );
    }
    module[edit.collection] = edit.orderedResourceIds.map(
      (id) => byId.get(id) as Record<string, unknown>,
    );
  } else if (edit.type === 'create-learning-module') {
    assertSafeRichText(edit.title, 'release.modules.title.en-US');
    assertSafeRichText(edit.description, 'release.modules.description.en-US');
    releaseRecord(next).modules = [
      ...modulesArray(next),
      createLearningModule(
        input.ids,
        edit.title.trim(),
        edit.description.trim(),
      ),
    ];
  } else if (edit.type === 'create-learning-module-item') {
    const module = findRevisioned(next, edit.moduleId);
    if (!module) throw new InvalidSchoolConfigurationError('release.modules');
    const items = module[edit.collection];
    if (!Array.isArray(items)) {
      throw new InvalidSchoolConfigurationError(
        `release.modules.${edit.collection}`,
      );
    }
    assertSafeRichText(
      edit.text,
      `release.modules.${edit.collection}.text.en-US`,
    );
    if (edit.href) {
      assertSafeHref(edit.href, `release.modules.${edit.collection}.href`);
    }
    items.push(createModuleItem(input.ids, edit.text.trim(), edit.href));
  } else if (edit.type === 'save-intake-form') {
    const intake = intakeFormRecord(next);
    const attestation = releaseRecord(next).submissionAttestation;
    if (!isRecord(attestation)) {
      throw new InvalidSchoolConfigurationError(
        'release.submissionAttestation',
      );
    }
    assertSafeRichText(edit.title, 'release.intakeForm.title.en-US');
    assertSafeRichText(edit.text, 'release.submissionAttestation.text.en-US');
    intake.title = setEnglishSource(
      intake.title,
      edit.title.trim(),
      'release.intakeForm.title',
    );
    attestation.text = setEnglishSource(
      attestation.text,
      edit.text.trim(),
      'release.submissionAttestation.text',
    );
  } else if (edit.type === 'save-intake-section') {
    const section = findRevisioned(next, edit.resourceId);
    if (!section) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.sections');
    }
    assertSafeRichText(
      edit.title,
      `release.intakeForm.sections.${edit.resourceId}.title.en-US`,
    );
    section.title = setEnglishSource(
      section.title,
      edit.title.trim(),
      `release.intakeForm.sections.${edit.resourceId}.title`,
    );
  } else if (edit.type === 'save-intake-field') {
    const field = findRevisioned(next, edit.resourceId);
    if (!field) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.fields');
    }
    assertSafeRichText(
      edit.label,
      `release.intakeForm.fields.${edit.resourceId}.label.en-US`,
    );
    if (edit.helpText) {
      assertSafeRichText(
        edit.helpText,
        `release.intakeForm.fields.${edit.resourceId}.helpText.en-US`,
      );
    }
    field.sectionId = edit.sectionId;
    field.type = edit.fieldType;
    field.required =
      edit.fieldType === 'acknowledgement' ? true : edit.required;
    field.requiredWhenVisible = edit.requiredWhenVisible;
    field.visibility = edit.visibility;
    field.label = setEnglishSource(
      field.label,
      edit.label.trim(),
      `release.intakeForm.fields.${edit.resourceId}.label`,
    );
    if (edit.helpText !== undefined) {
      if (edit.helpText && edit.helpText.trim()) {
        field.helpText = isRecord(field.helpText)
          ? setEnglishSource(
              field.helpText,
              edit.helpText.trim(),
              `release.intakeForm.fields.${edit.resourceId}.helpText`,
            )
          : createEnglishLocalized(input.ids, edit.helpText.trim());
      } else {
        delete field.helpText;
      }
    }
    if (!isChoiceIntakeFieldType(edit.fieldType)) {
      delete field.options;
    } else if (!Array.isArray(field.options) || field.options.length === 0) {
      field.options = defaultChoiceOptions(input.ids, edit.fieldType);
    }
  } else if (edit.type === 'save-intake-option') {
    const option = findRevisioned(next, edit.resourceId);
    if (!option) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.options');
    }
    assertSafeRichText(
      edit.label,
      `release.intakeForm.options.${edit.resourceId}.label.en-US`,
    );
    if (!optionCodePattern.test(edit.code)) {
      throw new InvalidSchoolConfigurationError(
        `release.intakeForm.options.${edit.resourceId}.code`,
      );
    }
    option.code = edit.code;
    option.label = setEnglishSource(
      option.label,
      edit.label.trim(),
      `release.intakeForm.options.${edit.resourceId}.label`,
    );
  } else if (edit.type === 'reorder-intake-sections') {
    const intake = intakeFormRecord(next);
    intake.sections = reorderByIds(
      intakeSections(next),
      edit.orderedResourceIds,
      'release.intakeForm.sections',
    );
  } else if (edit.type === 'reorder-intake-fields') {
    const intake = intakeFormRecord(next);
    intake.fields = reorderByIds(
      intakeFields(next),
      edit.orderedResourceIds,
      'release.intakeForm.fields',
    );
  } else if (edit.type === 'reorder-intake-options') {
    const field = findRevisioned(next, edit.fieldId);
    if (!field) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.fields');
    }
    field.options = reorderByIds(
      intakeOptions(field),
      edit.orderedResourceIds,
      `release.intakeForm.fields.${edit.fieldId}.options`,
    );
  } else if (edit.type === 'create-intake-section') {
    assertSafeRichText(edit.title, 'release.intakeForm.sections.title.en-US');
    const intake = intakeFormRecord(next);
    intake.sections = [
      ...intakeSections(next),
      createIntakeSection(input.ids, edit.title.trim()),
    ];
  } else if (edit.type === 'create-intake-field') {
    assertSafeRichText(edit.label, 'release.intakeForm.fields.label.en-US');
    if (
      !intakeSections(next).some((section) => section.id === edit.sectionId)
    ) {
      throw new InvalidSchoolConfigurationError(
        'release.intakeForm.fields.sectionId',
      );
    }
    const intake = intakeFormRecord(next);
    intake.fields = [
      ...intakeFields(next),
      createIntakeField(
        input.ids,
        edit.sectionId,
        edit.fieldType,
        edit.label.trim(),
      ),
    ];
  } else if (edit.type === 'create-intake-option') {
    assertSafeRichText(edit.label, 'release.intakeForm.options.label.en-US');
    if (!optionCodePattern.test(edit.code)) {
      throw new InvalidSchoolConfigurationError(
        'release.intakeForm.options.code',
      );
    }
    const field = findRevisioned(next, edit.fieldId);
    if (!field || !isChoiceIntakeFieldType(field.type)) {
      throw new InvalidSchoolConfigurationError('release.intakeForm.fields');
    }
    field.options = [
      ...intakeOptions(field),
      createIntakeOption(input.ids, edit.code, edit.label.trim()),
    ];
  } else if (edit.type === 'restore-active-revision') {
    if (!input.activePayload) {
      throw new InvalidSchoolConfigurationError('activeRevision');
    }
    next = replaceRevisioned(next, edit.resourceId, input.activePayload);
    applyExplicitOrder(next);
    return { candidate: next, discardedResourceIds };
  } else if (edit.type === 'discard-authored-resource') {
    const existing = findRevisioned(next, edit.resourceId);
    if (!existing) {
      throw new InvalidSchoolConfigurationError('discard');
    }
    discardedResourceIds.push(...collectResourceIds(existing));
    const sectionFields = intakeFields(next).filter(
      (field) => field.sectionId === edit.resourceId,
    );
    for (const field of sectionFields) {
      discardedResourceIds.push(...collectResourceIds(field));
      next = removeRevisioned(next, String(field.id));
    }
    next = removeRevisioned(next, edit.resourceId);
  } else if (edit.type === 'save-managed-translation') {
    if (!(managedLocales as readonly string[]).includes(edit.locale)) {
      throw new InvalidSchoolConfigurationError('managedTranslation.locale');
    }
    assertSafeRichText(edit.text, `managedTranslation.${edit.locale}`);
    next = applyManagedTranslationEdit({
      candidate: next,
      sourceResourceId: edit.resourceId,
      locale: edit.locale,
      text: edit.text.trim(),
      ids: input.ids,
    });
  } else if (edit.type === 'review-managed-translation') {
    if (!(managedLocales as readonly string[]).includes(edit.locale)) {
      throw new InvalidSchoolConfigurationError('managedTranslation.locale');
    }
    if (!input.reviewer || !input.reviewedAt) {
      throw new InvalidSchoolConfigurationError('managedTranslation.reviewer');
    }
    next = applyManagedTranslationReview({
      candidate: next,
      sourceResourceId: edit.resourceId,
      locale: edit.locale,
      reviewProvenanceId: input.ids.create(),
      reviewer: input.reviewer,
      reviewedAt: input.reviewedAt,
    });
  }
  applyExplicitOrder(next);
  return {
    candidate: assignCanonicalRevisions(input.candidate, next),
    discardedResourceIds,
  };
}

export function createSchoolConfiguration(dependencies: {
  identityAndAccess: Pick<
    IdentityAndAccess,
    'requireAdministrativeSession' | 'stepUpStaffSession'
  >;
  store: SchoolConfigurationStore;
  packages: ReleasePackageStorage;
  clock: Clock;
  ids: IdGenerator;
  translationAdapter: TranslationAdapter;
}) {
  return {
    async readDraft(command: { sessionHandle: string }) {
      const session =
        await dependencies.identityAndAccess.requireAdministrativeSession(
          command,
        );
      const draft = await dependencies.store.readDraft(session);
      if (!draft) return undefined;
      const activeResources =
        await dependencies.store.readActiveReleaseResources(session);
      return presentDraft(draft, activeResources);
    },

    stepUp(command: { sessionHandle: string; password: string; totp: string }) {
      return dependencies.identityAndAccess.stepUpStaffSession(command);
    },

    async editDraft(command: EditSchoolConfigurationDraftCommand) {
      const session =
        await dependencies.identityAndAccess.requireAdministrativeSession(
          command,
        );
      const draft = await dependencies.store.readDraft(session);
      if (!draft) throw new InvalidSchoolConfigurationError('draft');
      if (draft.draftVersion !== command.expectedDraftVersion) {
        throw new DraftVersionConflictError(draft.draftVersion);
      }
      const currentResources = extractExactResources(draft.candidate);
      const currentById = new Map(
        currentResources.map((resource) => [resource.resourceId, resource]),
      );
      for (const expected of command.expectedResourceRevisions) {
        const current = currentById.get(expected.resourceId);
        if (!current || current.revisionNumber !== expected.revisionNumber) {
          throw new ResourceRevisionConflictError();
        }
      }
      const activeResources =
        await dependencies.store.readActiveReleaseResources(session);
      const restoreResourceId =
        command.edit.type === 'restore-active-revision'
          ? command.edit.resourceId
          : undefined;
      const activePayload = restoreResourceId
        ? activeResources.find(
            (resource) => resource.resourceId === restoreResourceId,
          )?.payload
        : undefined;
      if (command.edit.type === 'discard-authored-resource') {
        const published = new Set(
          activeResources.map((resource) => resource.resourceId),
        );
        if (published.has(command.edit.resourceId)) {
          throw new InvalidSchoolConfigurationError('discard');
        }
      }
      const applied = applyDraftEdit({
        candidate: draft.candidate,
        edit: command.edit,
        ids: dependencies.ids,
        activePayload,
        reviewer: session.staffIdentityId,
        reviewedAt: dependencies.clock.now(),
      });
      const candidateFingerprint = fingerprintCandidate(applied.candidate);
      const resources = extractExactResources(applied.candidate);
      const saved = await dependencies.store.saveDraft({
        session,
        operationId: command.operationId,
        requestFingerprint: sha256(
          canonicalJson({
            expectedDraftVersion: command.expectedDraftVersion,
            expectedResourceRevisions: command.expectedResourceRevisions,
            edit: JSON.parse(JSON.stringify(command.edit)),
            candidateFingerprint,
          }),
        ),
        expectedDraftVersion: command.expectedDraftVersion,
        expectedResourceRevisions: command.expectedResourceRevisions,
        candidate: applied.candidate,
        candidateFingerprint,
        resources,
        reviews: extractTranslationReviews(applied.candidate),
        discardedResourceIds: applied.discardedResourceIds,
        changedAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
      });
      const stored = await dependencies.store.readDraft(session);
      if (!stored) throw new InvalidSchoolConfigurationError('draft');
      return {
        operationId: command.operationId,
        affectedResources: resources.map((resource) => ({
          resourceId: resource.resourceId,
          revisionNumber: resource.revisionNumber,
        })),
        ...presentDraft(
          { ...stored, draftVersion: saved.draftVersion },
          activeResources,
        ),
      };
    },

    async generateTranslations(command: GenerateManagedTranslationsCommand) {
      const session =
        await dependencies.identityAndAccess.requireAdministrativeSession(
          command,
        );
      if (!(managedLocales as readonly string[]).includes(command.locale)) {
        throw new InvalidSchoolConfigurationError('managedTranslation.locale');
      }
      const draft = await dependencies.store.readDraft(session);
      if (!draft) throw new InvalidSchoolConfigurationError('draft');
      if (draft.draftVersion !== command.expectedDraftVersion) {
        throw new DraftVersionConflictError(draft.draftVersion);
      }
      const requested = new Set(command.sourceResourceIds ?? []);
      const segments = extractTranslatableSegments(
        draft.candidate,
        command.locale,
      ).filter((segment) => {
        if (requested.size > 0 && !requested.has(segment.sourceResourceId)) {
          return false;
        }
        const english = findLocalizedValue(
          draft.candidate,
          segment.sourceResourceId,
          'en-US',
        );
        const localized = findLocalizedValue(
          draft.candidate,
          segment.sourceResourceId,
          command.locale,
        );
        return translationStatusFor(english, localized) !== 'reviewed';
      });
      const startedAt = dependencies.clock.now();
      let outputs: Awaited<
        ReturnType<TranslationAdapter['translate']>
      >['outputs'] = [];
      if (segments.length > 0) {
        const translated = await dependencies.translationAdapter.translate({
          segments,
        });
        outputs = translated.outputs;
      }
      const applied = applyGeneratedTranslations({
        candidate: draft.candidate,
        locale: command.locale,
        outputs,
        adapter: dependencies.translationAdapter,
        generatedAt: startedAt,
        ids: dependencies.ids,
        requestedSourceIds: command.sourceResourceIds,
      });
      const candidate = assignCanonicalRevisions(
        draft.candidate,
        applied.candidate,
      );
      const candidateFingerprint = fingerprintCandidate(candidate);
      const resources = extractExactResources(candidate);
      const saved = await dependencies.store.saveDraft({
        session,
        operationId: command.operationId,
        requestFingerprint: sha256(
          canonicalJson({
            expectedDraftVersion: command.expectedDraftVersion,
            locale: command.locale,
            sourceResourceIds: command.sourceResourceIds ?? [],
            candidateFingerprint,
            rejected: applied.rejected.map((item) => ({
              sourceResourceId: item.sourceResourceId,
              locale: item.locale,
              code: item.code,
            })),
          }),
        ),
        expectedDraftVersion: command.expectedDraftVersion,
        expectedResourceRevisions: [],
        candidate,
        candidateFingerprint,
        resources,
        reviews: extractTranslationReviews(candidate),
        discardedResourceIds: [],
        changedAt: dependencies.clock.now(),
        auditId: dependencies.ids.create(),
      });
      const stored = await dependencies.store.readDraft(session);
      if (!stored) throw new InvalidSchoolConfigurationError('draft');
      const activeResources =
        await dependencies.store.readActiveReleaseResources(session);
      const telemetry: TranslationGenerationTelemetry = {
        adapter: dependencies.translationAdapter.id,
        adapterVersion: dependencies.translationAdapter.version,
        model: dependencies.translationAdapter.model,
        glossaryRevision: dependencies.translationAdapter.glossaryRevision,
        locale: command.locale,
        segmentCount: segments.length,
        rejectedCount: applied.rejected.length,
        outcome:
          applied.rejected.length === 0
            ? 'ok'
            : applied.written > 0
              ? 'rejected'
              : 'rejected',
      };
      return {
        operationId: command.operationId,
        affectedResources: resources.map((resource) => ({
          resourceId: resource.resourceId,
          revisionNumber: resource.revisionNumber,
        })),
        rejected: applied.rejected,
        telemetry,
        ...presentDraft(
          { ...stored, draftVersion: saved.draftVersion },
          activeResources,
        ),
      };
    },

    async importDraft(command: ImportSchoolConfigurationDraftCommand) {
      const session =
        await dependencies.identityAndAccess.requireAdministrativeSession(
          command,
        );
      validateCandidate(command.candidate, session.workspaceId);
      const candidateFingerprint = fingerprintCandidate(command.candidate);
      return dependencies.store.importDraft({
        session,
        operationId: command.operationId,
        requestFingerprint: sha256(
          canonicalJson({
            expectedDraftVersion: command.expectedDraftVersion,
            candidateFingerprint,
          }),
        ),
        expectedDraftVersion: command.expectedDraftVersion,
        candidate: command.candidate,
        candidateFingerprint,
        resources: extractExactResources(command.candidate),
        reviews: extractTranslationReviews(command.candidate),
        changedAt: dependencies.clock.now(),
      });
    },

    async publish(command: PublishSchoolConfigurationReleaseCommand) {
      const session =
        await dependencies.identityAndAccess.requireAdministrativeSession(
          command,
        );
      const now = dependencies.clock.now();
      if (
        now.getTime() - session.authenticationFreshAt.getTime() >=
        staffAuthenticationFreshnessMs
      ) {
        throw new AuthenticationFreshnessRequiredError();
      }
      if (!command.changeDescription.trim()) {
        throw new InvalidSchoolConfigurationError('changeDescription');
      }
      const requestFingerprint = sha256(
        canonicalJson({
          expectedActiveReleaseId: command.expectedActiveReleaseId,
          expectedDraftVersion: command.expectedDraftVersion,
          candidateFingerprint: command.candidateFingerprint,
          changeDescription: command.changeDescription,
        }),
      );
      return dependencies.store.withPublicationLock({
        workspaceId: session.workspaceId,
        operationId: command.operationId,
        run: async () => {
          const preparation = await dependencies.store.preparePublication({
            session,
            operationId: command.operationId,
            requestFingerprint,
            proposedReleaseId: dependencies.ids.create(),
            preparedAt: now,
          });
          if (preparation.outcome === 'replayed') {
            return { ...preparation.result, replayed: true };
          }
          try {
            const draft = await dependencies.store.readDraft(session);
            if (!draft) throw new InvalidSchoolConfigurationError('draft');
            validateCandidate(draft.candidate, session.workspaceId);
            if (draft.candidateFingerprint !== command.candidateFingerprint) {
              throw new CandidateFingerprintConflictError(
                draft.candidateFingerprint,
              );
            }
            const resources = extractExactResources(draft.candidate);
            const packageDocument = {
              format: releasePackageFormat,
              minimumClientContractVersion,
              workspaceId: session.workspaceId,
              releaseId: preparation.releaseId,
              candidateFingerprintAlgorithm,
              candidateFingerprint: draft.candidateFingerprint,
              canonicalLocale: 'en-US',
              supportedLocales,
              components: resources.map((resource) => ({
                resourceId: resource.resourceId,
                revisionNumber: resource.revisionNumber,
                payloadSchemaVersion: 1,
                slot: resource.slot,
                position: resource.position,
                payload: resource.payload,
              })),
              candidate: draft.candidate,
            };
            const packageBytes = new TextEncoder().encode(
              canonicalJson(packageDocument),
            );
            const packageDigest = sha256(packageBytes);
            const packageObjectKey = `workspaces/${session.workspaceId}/packages/sha256/${packageDigest}.json`;
            return await dependencies.store.withPackageLock({
              workspaceId: session.workspaceId,
              packageDigest,
              run: async () => {
                await dependencies.packages.putIfAbsent({
                  bucket: releasePackageBucket,
                  key: packageObjectKey,
                  bytes: packageBytes,
                  digest: packageDigest,
                });
                return dependencies.store.activatePublication({
                  session,
                  sessionHandle: command.sessionHandle,
                  operationId: command.operationId,
                  requestFingerprint,
                  releaseId: preparation.releaseId,
                  expectedActiveReleaseId: command.expectedActiveReleaseId,
                  expectedDraftVersion: command.expectedDraftVersion,
                  candidateFingerprint: command.candidateFingerprint,
                  changeDescription: command.changeDescription.trim(),
                  packageDigest,
                  packageByteLength: packageBytes.byteLength,
                  packageObjectKey,
                  resources,
                  publishedAt: dependencies.clock.now(),
                  auditId: dependencies.ids.create(),
                  outboxId: dependencies.ids.create(),
                });
              },
            });
          } catch (error) {
            const failure = publicationFailureFromError(error);
            if (failure) {
              await dependencies.store.recordPublicationFailure({
                session,
                operationId: command.operationId,
                requestFingerprint,
                failure,
                failedAt: dependencies.clock.now(),
              });
            }
            throw error;
          }
        },
      });
    },
  };
}

export type SchoolConfiguration = ReturnType<typeof createSchoolConfiguration>;
