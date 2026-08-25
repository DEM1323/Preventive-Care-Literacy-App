export const GOLDEN_JOURNEY_EVIDENCE_SCHEMA_VERSION = 1 as const;

export const goldenJourneyCoverageKeys = [
  'staffAuth',
  'staffFreshness',
  'releasePublication',
  'classInvitation',
  'emailDelivery',
  'invitationRedemption',
  'intakeDraft',
  'intakeSubmission',
  'learningAcknowledgement',
  'clinicalDirectory',
  'clinicalReveal',
  'freshBrowserRestoration',
  'keyboard',
  'focus',
  'announcements',
  'contrast',
  'zoomReflow',
  'responsive',
  'multilingualLayout',
] as const;

export const goldenJourneyProviderContractNames = [
  'postgres',
  'auth',
  'storage',
  'queue',
  'cron',
  'email',
  'envelope',
  'railway-public',
  'invitation-worker',
] as const;

export type GoldenJourneyCoverageKey =
  (typeof goldenJourneyCoverageKeys)[number];
export type GoldenJourneyProviderContractName =
  (typeof goldenJourneyProviderContractNames)[number];
export type CoverageOutcome = 'pass';
export type ProviderContractStatus = 'ok';

export type GoldenJourneySyntheticIdentifiers = {
  workspaceId: string;
  staffIdentityId: string;
  classId: string;
  invitationId: string;
  restorationInvitationId: string;
  releaseId: string;
  studentId: string;
  intakeRecordVersionId: string;
  itemCompletionId: string;
};

export type GoldenJourneyEvidence = {
  schemaVersion: typeof GOLDEN_JOURNEY_EVIDENCE_SCHEMA_VERSION;
  environment: 'staging';
  environmentHost: string;
  commit: string;
  artifactDigest: string;
  envelopeAdapter: 'application-layer-envelope/v1';
  runId: string;
  startedAt: string;
  completedAt: string;
  syntheticIdentifiers: GoldenJourneySyntheticIdentifiers;
  cleanupBoundary: {
    marker: string;
    disposition: 'operator-cleanup-required';
  };
  coverage: Record<GoldenJourneyCoverageKey, CoverageOutcome>;
  providerContracts: {
    name: GoldenJourneyProviderContractName;
    status: ProviderContractStatus;
  }[];
};

export type GoldenJourneyEvidenceInput = {
  environment: 'staging';
  environmentHost: string;
  commit: string;
  artifactDigest: string;
  envelopeAdapter: 'application-layer-envelope/v1';
  runId: string;
  startedAt: string;
  completedAt: string;
  syntheticIdentifiers: GoldenJourneySyntheticIdentifiers;
  coverage: Record<GoldenJourneyCoverageKey, CoverageOutcome>;
  providerContracts: {
    name: GoldenJourneyProviderContractName;
    status: ProviderContractStatus;
  }[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const commitPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const hostPattern =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const prohibitedEvidencePatterns = [
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
  /"(?:address|answers|generatedContent|invitationCode|requestBody|responseBody|sessionHandle|signInCode|password|totpSecret|renderedClinicalContent)"/i,
  /\b\d{6}\b/,
  /otpauth:/i,
  /Bearer\s+/i,
  /UNIQUE-ANSWER/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertSafeGoldenJourneyEvidence(
  value: unknown,
): asserts value is GoldenJourneyEvidence {
  const serialized = JSON.stringify(value);
  if (prohibitedEvidencePatterns.some((pattern) => pattern.test(serialized))) {
    throw new Error(
      'Golden journey evidence contained a prohibited data class',
    );
  }
  if (!isRecord(value)) {
    throw new Error('Golden journey evidence is malformed');
  }
  const allowedKeys = [
    'schemaVersion',
    'environment',
    'environmentHost',
    'commit',
    'artifactDigest',
    'envelopeAdapter',
    'runId',
    'startedAt',
    'completedAt',
    'syntheticIdentifiers',
    'cleanupBoundary',
    'coverage',
    'providerContracts',
  ];
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(
        'Golden journey evidence contained a prohibited data class',
      );
    }
  }
}

function requireUuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) {
    throw new Error(`Golden journey evidence ${label} must be an opaque uuid`);
  }
  return value;
}

export function createGoldenJourneyEvidence(
  input: GoldenJourneyEvidenceInput,
): GoldenJourneyEvidence {
  for (const key of goldenJourneyCoverageKeys) {
    if (input.coverage[key] !== 'pass') {
      throw new Error('Golden journey evidence coverage is incomplete');
    }
  }
  const providerNames = input.providerContracts.map((entry) => entry.name);
  if (
    goldenJourneyProviderContractNames.some(
      (name) => !providerNames.includes(name),
    ) ||
    input.providerContracts.some(({ status }) => status !== 'ok')
  ) {
    throw new Error(
      'Golden journey evidence provider contracts are incomplete',
    );
  }

  if (!commitPattern.test(input.commit)) {
    throw new Error('Golden journey evidence commit is malformed');
  }
  if (!digestPattern.test(input.artifactDigest)) {
    throw new Error('Golden journey evidence artifact digest is malformed');
  }
  if (!hostPattern.test(input.environmentHost)) {
    throw new Error(
      'Golden journey evidence contained a prohibited data class',
    );
  }
  if (
    !isoPattern.test(input.startedAt) ||
    !isoPattern.test(input.completedAt)
  ) {
    throw new Error('Golden journey evidence timestamps are malformed');
  }
  if (input.envelopeAdapter !== 'application-layer-envelope/v1') {
    throw new Error('Golden journey evidence envelope adapter is unexpected');
  }

  const evidence: GoldenJourneyEvidence = {
    schemaVersion: GOLDEN_JOURNEY_EVIDENCE_SCHEMA_VERSION,
    environment: 'staging',
    environmentHost: input.environmentHost,
    commit: input.commit,
    artifactDigest: input.artifactDigest,
    envelopeAdapter: 'application-layer-envelope/v1',
    runId: requireUuid(input.runId, 'runId'),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    syntheticIdentifiers: {
      workspaceId: requireUuid(
        input.syntheticIdentifiers.workspaceId,
        'workspaceId',
      ),
      staffIdentityId: requireUuid(
        input.syntheticIdentifiers.staffIdentityId,
        'staffIdentityId',
      ),
      classId: requireUuid(input.syntheticIdentifiers.classId, 'classId'),
      invitationId: requireUuid(
        input.syntheticIdentifiers.invitationId,
        'invitationId',
      ),
      restorationInvitationId: requireUuid(
        input.syntheticIdentifiers.restorationInvitationId,
        'restorationInvitationId',
      ),
      releaseId: requireUuid(input.syntheticIdentifiers.releaseId, 'releaseId'),
      studentId: requireUuid(input.syntheticIdentifiers.studentId, 'studentId'),
      intakeRecordVersionId: requireUuid(
        input.syntheticIdentifiers.intakeRecordVersionId,
        'intakeRecordVersionId',
      ),
      itemCompletionId: requireUuid(
        input.syntheticIdentifiers.itemCompletionId,
        'itemCompletionId',
      ),
    },
    cleanupBoundary: {
      marker: `golden-journey/${input.runId}`,
      disposition: 'operator-cleanup-required',
    },
    coverage: { ...input.coverage },
    providerContracts: goldenJourneyProviderContractNames.map((name) => {
      const contract = input.providerContracts.find(
        (entry) => entry.name === name,
      );
      if (!contract) {
        throw new Error(
          'Golden journey evidence provider contracts are incomplete',
        );
      }
      return { name, status: 'ok' as const };
    }),
  };
  assertSafeGoldenJourneyEvidence(evidence);
  return evidence;
}
