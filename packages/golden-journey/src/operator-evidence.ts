import { isRecord } from './http.ts';
import { NonRetryableGoldenJourneyError } from './retry.ts';

const digestPattern = /^[0-9a-f]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const allowedKeys = [
  'auditRowCount',
  'outboxCompletedCount',
  'invitationStatus',
  'workerArtifactDigest',
  'workerEnvelopeAdapter',
  'workerRecordedAt',
  'releaseId',
  'packageDigest',
  'releaseNumber',
  'intakeReceiptPresent',
  'learningReceiptPresent',
] as const;

export type GoldenJourneyOperatorEvidence = {
  auditRowCount: number;
  outboxCompletedCount: number;
  invitationStatus: string | null;
  workerArtifactDigest: string | null;
  workerEnvelopeAdapter: string | null;
  workerRecordedAt: string | null;
  releaseId: string | null;
  packageDigest: string | null;
  releaseNumber: number | null;
  intakeReceiptPresent: boolean;
  learningReceiptPresent: boolean;
};

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
    /answers|invitationCode|requestBody|email/i.test(serialized)
  ) {
    throw new NonRetryableGoldenJourneyError(
      'Operator evidence is unavailable',
      'OPERATOR_EVIDENCE_FAILED',
    );
  }
  const digest =
    value.workerArtifactDigest === null ||
    value.workerArtifactDigest === undefined
      ? null
      : typeof value.workerArtifactDigest === 'string' &&
          digestPattern.test(value.workerArtifactDigest)
        ? value.workerArtifactDigest
        : undefined;
  const packageDigest =
    value.packageDigest === null || value.packageDigest === undefined
      ? null
      : typeof value.packageDigest === 'string' &&
          digestPattern.test(value.packageDigest)
        ? value.packageDigest
        : undefined;
  const releaseId =
    value.releaseId === null || value.releaseId === undefined
      ? null
      : typeof value.releaseId === 'string' && uuidPattern.test(value.releaseId)
        ? value.releaseId
        : undefined;
  if (
    typeof value.auditRowCount !== 'number' ||
    typeof value.outboxCompletedCount !== 'number' ||
    digest === undefined ||
    packageDigest === undefined ||
    releaseId === undefined ||
    typeof value.intakeReceiptPresent !== 'boolean' ||
    typeof value.learningReceiptPresent !== 'boolean'
  ) {
    throw new NonRetryableGoldenJourneyError(
      'Operator evidence is unavailable',
      'OPERATOR_EVIDENCE_FAILED',
    );
  }
  return {
    auditRowCount: value.auditRowCount,
    outboxCompletedCount: value.outboxCompletedCount,
    invitationStatus:
      typeof value.invitationStatus === 'string'
        ? value.invitationStatus
        : null,
    workerArtifactDigest: digest,
    workerEnvelopeAdapter:
      typeof value.workerEnvelopeAdapter === 'string'
        ? value.workerEnvelopeAdapter
        : null,
    workerRecordedAt:
      typeof value.workerRecordedAt === 'string'
        ? value.workerRecordedAt
        : null,
    releaseId,
    packageDigest,
    releaseNumber:
      typeof value.releaseNumber === 'number' ? value.releaseNumber : null,
    intakeReceiptPresent: value.intakeReceiptPresent,
    learningReceiptPresent: value.learningReceiptPresent,
  };
}
