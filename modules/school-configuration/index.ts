import { createHash } from 'node:crypto';
import type {
  AdministrativeSessionContext,
  Clock,
  IdGenerator,
  IdentityAndAccess,
} from '../identity-access/index.ts';
import { staffAuthenticationFreshnessMs } from '../identity-access/index.ts';

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

export type SchoolConfigurationDraft = {
  workspaceId: string;
  draftVersion: number;
  activeReleaseId: string | null;
  candidateFingerprint: string;
  candidate: unknown;
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
  ): Promise<SchoolConfigurationDraft | undefined>;
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
          localized.reviewProvenanceId !== reviewProvenanceId ||
          !/^(?:[^<>]|<strong>[^<>]*<\/strong>)*$/.test(localized.value)
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
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.reviewProvenance) ||
    typeof candidate.reviewProvenance.id !== 'string' ||
    typeof candidate.reviewProvenance.actor !== 'string' ||
    typeof candidate.reviewProvenance.recordedAt !== 'string'
  ) {
    throw new InvalidSchoolConfigurationError('reviewProvenance');
  }
  const provenance = {
    id: candidate.reviewProvenance.id,
    actor: candidate.reviewProvenance.actor,
    recordedAt: candidate.reviewProvenance.recordedAt,
  };
  const reviewedAt = new Date(provenance.recordedAt);
  if (Number.isNaN(reviewedAt.getTime())) {
    throw new InvalidSchoolConfigurationError('reviewProvenance.recordedAt');
  }
  const reviews: ExactTranslationReview[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (supportedLocales.every((locale) => locale in value)) {
      const source = value['en-US'];
      if (!isRecord(source)) {
        throw new InvalidSchoolConfigurationError('translationSource');
      }
      for (const locale of supportedLocales.slice(1) as Array<
        Exclude<Locale, 'en-US'>
      >) {
        const translation = value[locale];
        if (!isRecord(translation)) {
          throw new InvalidSchoolConfigurationError(`translation.${locale}`);
        }
        reviews.push({
          sourceResourceId: String(source.id),
          sourceRevisionNumber: Number(source.revision),
          translationResourceId: String(translation.id),
          translationRevisionNumber: Number(translation.revision),
          locale,
          reviewProvenanceId: provenance.id,
          reviewer: provenance.actor,
          reviewedAt,
        });
      }
    }
    Object.values(value).forEach(visit);
  }
  visit(candidate);
  return reviews;
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
}) {
  return {
    async readDraft(command: { sessionHandle: string }) {
      const session =
        await dependencies.identityAndAccess.requireAdministrativeSession(
          command,
        );
      return dependencies.store.readDraft(session);
    },

    stepUp(command: { sessionHandle: string; password: string; totp: string }) {
      return dependencies.identityAndAccess.stepUpStaffSession(command);
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
