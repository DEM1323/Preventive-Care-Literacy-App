import { isRecord } from './http.ts';
import { NonRetryableGoldenJourneyError } from './retry.ts';

const digestPattern = /^[0-9a-f]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const allowedKeys = [
  'invitationStatus',
  'workerArtifactDigest',
  'workerEnvelopeAdapter',
  'workerRecordedAt',
  'publishReleaseId',
  'publishPackageDigest',
  'publishReleaseNumber',
  'publishAuditCount',
  'publishOutboxCount',
  'publishReceiptCount',
  'publishOccurredAt',
  'invitationAuditCount',
  'invitationOutboxCount',
  'invitationReceiptCount',
  'invitationOccurredAt',
  'intakeReceiptCount',
  'intakeEntityId',
  'intakeOccurredAt',
  'learningReceiptCount',
  'learningEntityId',
  'learningOccurredAt',
  'clinicalRevealAuditCount',
  'clinicalRevealOccurredAt',
  'clinicalDenialAuditCount',
  'clinicalDenialOccurredAt',
  'unattributedDenialCount',
  'unattributedDenialOccurredAt',
] as const;

export type GoldenJourneyOperatorEvidence = {
  invitationStatus: string | null;
  workerArtifactDigest: string | null;
  workerEnvelopeAdapter: string | null;
  workerRecordedAt: string | null;
  publishReleaseId: string | null;
  publishPackageDigest: string | null;
  publishReleaseNumber: number | null;
  publishAuditCount: number;
  publishOutboxCount: number;
  publishReceiptCount: number;
  publishOccurredAt: string | null;
  invitationAuditCount: number;
  invitationOutboxCount: number;
  invitationReceiptCount: number;
  invitationOccurredAt: string | null;
  intakeReceiptCount: number;
  intakeEntityId: string | null;
  intakeOccurredAt: string | null;
  learningReceiptCount: number;
  learningEntityId: string | null;
  learningOccurredAt: string | null;
  clinicalRevealAuditCount: number;
  clinicalRevealOccurredAt: string | null;
  clinicalDenialAuditCount: number;
  clinicalDenialOccurredAt: string | null;
  unattributedDenialCount: number;
  unattributedDenialOccurredAt: string | null;
};

function requireCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function optionalDigest(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && digestPattern.test(value)
    ? value
    : undefined;
}

function optionalUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && uuidPattern.test(value)
    ? value
    : undefined;
}

function optionalIso(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && isoPattern.test(value)
    ? value
    : undefined;
}

export function parseGoldenJourneyOperatorEvidence(
  value: unknown,
): GoldenJourneyOperatorEvidence {
  if (!isRecord(value)) {
    throw new NonRetryableGoldenJourneyError(
      'Operator evidence is unavailable',
      'OPERATOR_EVIDENCE_FAILED',
    );
  }
  for (const key of Object.keys(value)) {
    if (!(allowedKeys as readonly string[]).includes(key)) {
      throw new NonRetryableGoldenJourneyError(
        'Operator evidence is unavailable',
        'OPERATOR_EVIDENCE_FAILED',
      );
    }
  }
  const serialized = JSON.stringify(value);
  if (
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(serialized) ||
    /answers|invitationCode|requestBody|email|details|payload/i.test(serialized)
  ) {
    throw new NonRetryableGoldenJourneyError(
      'Operator evidence is unavailable',
      'OPERATOR_EVIDENCE_FAILED',
    );
  }
  const workerDigest = optionalDigest(value.workerArtifactDigest);
  const publishPackageDigest = optionalDigest(value.publishPackageDigest);
  const publishReleaseId = optionalUuid(value.publishReleaseId);
  const intakeEntityId = optionalUuid(value.intakeEntityId);
  const learningEntityId = optionalUuid(value.learningEntityId);
  const counts = {
    publishAuditCount: requireCount(value.publishAuditCount),
    publishOutboxCount: requireCount(value.publishOutboxCount),
    publishReceiptCount: requireCount(value.publishReceiptCount),
    invitationAuditCount: requireCount(value.invitationAuditCount),
    invitationOutboxCount: requireCount(value.invitationOutboxCount),
    invitationReceiptCount: requireCount(value.invitationReceiptCount),
    intakeReceiptCount: requireCount(value.intakeReceiptCount),
    learningReceiptCount: requireCount(value.learningReceiptCount),
    clinicalRevealAuditCount: requireCount(value.clinicalRevealAuditCount),
    clinicalDenialAuditCount: requireCount(value.clinicalDenialAuditCount),
    unattributedDenialCount: requireCount(value.unattributedDenialCount),
  };
  if (
    workerDigest === undefined ||
    publishPackageDigest === undefined ||
    publishReleaseId === undefined ||
    intakeEntityId === undefined ||
    learningEntityId === undefined ||
    Object.values(counts).some((count) => count === undefined)
  ) {
    throw new NonRetryableGoldenJourneyError(
      'Operator evidence is unavailable',
      'OPERATOR_EVIDENCE_FAILED',
    );
  }
  return {
    invitationStatus:
      typeof value.invitationStatus === 'string'
        ? value.invitationStatus
        : null,
    workerArtifactDigest: workerDigest,
    workerEnvelopeAdapter:
      typeof value.workerEnvelopeAdapter === 'string'
        ? value.workerEnvelopeAdapter
        : null,
    workerRecordedAt: requireOptionalIso(value.workerRecordedAt),
    publishReleaseId,
    publishPackageDigest,
    publishReleaseNumber:
      typeof value.publishReleaseNumber === 'number'
        ? value.publishReleaseNumber
        : null,
    publishAuditCount: counts.publishAuditCount!,
    publishOutboxCount: counts.publishOutboxCount!,
    publishReceiptCount: counts.publishReceiptCount!,
    publishOccurredAt: requireOptionalIso(value.publishOccurredAt),
    invitationAuditCount: counts.invitationAuditCount!,
    invitationOutboxCount: counts.invitationOutboxCount!,
    invitationReceiptCount: counts.invitationReceiptCount!,
    invitationOccurredAt: requireOptionalIso(value.invitationOccurredAt),
    intakeReceiptCount: counts.intakeReceiptCount!,
    intakeEntityId,
    intakeOccurredAt: requireOptionalIso(value.intakeOccurredAt),
    learningReceiptCount: counts.learningReceiptCount!,
    learningEntityId,
    learningOccurredAt: requireOptionalIso(value.learningOccurredAt),
    clinicalRevealAuditCount: counts.clinicalRevealAuditCount!,
    clinicalRevealOccurredAt: requireOptionalIso(
      value.clinicalRevealOccurredAt,
    ),
    clinicalDenialAuditCount: counts.clinicalDenialAuditCount!,
    clinicalDenialOccurredAt: requireOptionalIso(
      value.clinicalDenialOccurredAt,
    ),
    unattributedDenialCount: counts.unattributedDenialCount!,
    unattributedDenialOccurredAt: requireOptionalIso(
      value.unattributedDenialOccurredAt,
    ),
  };
}

function requireOptionalIso(value: unknown): string | null {
  const parsed = optionalIso(value);
  if (parsed === undefined) {
    throw new NonRetryableGoldenJourneyError(
      'Operator evidence is unavailable',
      'OPERATOR_EVIDENCE_FAILED',
    );
  }
  return parsed;
}
