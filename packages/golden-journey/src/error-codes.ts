export const goldenJourneyErrorCodes = [
  'PREFLIGHT_MISSING',
  'PREFLIGHT_REF',
  'PREFLIGHT_ORIGIN',
  'DIGEST_MISMATCH',
  'WORKER_DIGEST_MISMATCH',
  'STALE_WORKER',
  'PROVIDER_SMOKE_FAILED',
  'HTTP_NOT_READY',
  'AUTHENTICATION_FAILED',
  'RELEASE_PUBLISH_FAILED',
  'INVITATION_FAILED',
  'MAILBOX_UNOBSERVED',
  'INTAKE_FAILED',
  'CLINICAL_REVEAL_FAILED',
  'CLINICAL_ANSWER_MISMATCH',
  'AUTHORIZATION_DENIED',
  'OPERATOR_EVIDENCE_FAILED',
  'RESTORATION_FAILED',
  'BROWSER_ASSERTION_FAILED',
  'CLEANUP_FAILED',
  'UNEXPECTED_FAILURE',
] as const;

export type GoldenJourneyErrorCode = (typeof goldenJourneyErrorCodes)[number];

export function isGoldenJourneyErrorCode(
  value: string,
): value is GoldenJourneyErrorCode {
  return (goldenJourneyErrorCodes as readonly string[]).includes(value);
}
