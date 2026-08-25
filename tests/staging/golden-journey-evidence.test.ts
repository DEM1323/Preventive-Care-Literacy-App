import { expect, test } from 'bun:test';
import {
  GOLDEN_JOURNEY_EVIDENCE_SCHEMA_VERSION,
  artifactDigestForFailureEvidence,
  assertSafeGoldenJourneyEvidence,
  createFailedGoldenJourneyEvidence,
  createGoldenJourneyEvidence,
} from '../../packages/golden-journey/src/index.ts';

const opaqueIds = {
  workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8001',
  staffIdentityId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8002',
  classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8003',
  invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8004',
  restorationInvitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8005',
  isolationWorkspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8014',
  releaseId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8006',
  studentId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8007',
  intakeRecordVersionId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8008',
  itemCompletionId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8009',
  packageDigest:
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
};

const passCoverage = {
  staffAuth: 'pass',
  staffFreshness: 'pass',
  releasePublication: 'pass',
  classInvitation: 'pass',
  emailDelivery: 'pass',
  invitationRedemption: 'pass',
  intakeDraft: 'pass',
  intakeSubmission: 'pass',
  learningAcknowledgement: 'pass',
  clinicalDirectory: 'pass',
  clinicalReveal: 'pass',
  workspaceIsolation: 'pass',
  authorizationDenial: 'pass',
  auditEvidence: 'pass',
  outboxDelivery: 'pass',
  freshBrowserRestoration: 'pass',
  keyboard: 'pass',
  focus: 'pass',
  announcements: 'pass',
  contrast: 'pass',
  zoomReflow: 'pass',
  responsive: 'pass',
  multilingualLayout: 'pass',
} as const;

function validInput() {
  return {
    environment: 'staging' as const,
    environmentHost: 'staging.up.railway.app',
    commit: 'beda69fca3f7954a0200a3209cb44aac7ade4a72',
    artifactDigest:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    envelopeAdapter: 'application-layer-envelope/v1' as const,
    runId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8000',
    startedAt: '2026-08-25T16:00:00.000Z',
    completedAt: '2026-08-25T16:12:00.000Z',
    syntheticIdentifiers: opaqueIds,
    authCleanup: 'completed' as const,
    coverage: passCoverage,
    providerContracts: [
      { name: 'postgres', status: 'ok' as const },
      { name: 'auth', status: 'ok' as const },
      { name: 'storage', status: 'ok' as const },
      { name: 'queue', status: 'ok' as const },
      { name: 'cron', status: 'ok' as const },
      { name: 'email', status: 'ok' as const },
      { name: 'envelope', status: 'ok' as const },
      { name: 'railway-public', status: 'ok' as const },
      { name: 'invitation-worker', status: 'ok' as const },
    ],
  };
}

test('evidence records only allowlisted operational fields', () => {
  const evidence = createGoldenJourneyEvidence(validInput());

  expect(evidence.schemaVersion).toBe(GOLDEN_JOURNEY_EVIDENCE_SCHEMA_VERSION);
  expect(evidence.environment).toBe('staging');
  expect(evidence.environmentHost).toBe('staging.up.railway.app');
  expect(evidence.commit).toBe(validInput().commit);
  expect(evidence.artifactDigest).toBe(validInput().artifactDigest);
  expect(evidence.envelopeAdapter).toBe('application-layer-envelope/v1');
  expect(evidence.syntheticIdentifiers).toEqual(opaqueIds);
  expect(evidence.cleanupBoundary).toEqual({
    marker: 'golden-journey/018f1f5e-7b76-7f70-8f4d-9dc17ecf8000',
    disposition: 'operator-cleanup-required',
    authCleanup: 'completed',
  });
  expect(Object.keys(evidence)).toEqual([
    'schemaVersion',
    'outcome',
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
  ]);
  expect(() => assertSafeGoldenJourneyEvidence(evidence)).not.toThrow();
});

test('evidence rejects credentials, addresses, codes, handles, answers, and bodies', () => {
  const prohibited = [
    { answers: { health: 'private' } },
    { invitationCode: '729104' },
    { signInCode: '123456' },
    { sessionHandle: 'opaque-session-handle' },
    { requestBody: 'private body' },
    { responseBody: '{"answers":{}}' },
    { email: 'student@example.test' },
    { password: 'correct horse battery staple' },
    { totpSecret: 'JBSWY3DPEHPK3PXP' },
    { renderedClinicalContent: 'Asthma: yes' },
  ];

  for (const extra of prohibited) {
    expect(() =>
      assertSafeGoldenJourneyEvidence({
        ...createGoldenJourneyEvidence(validInput()),
        ...extra,
      }),
    ).toThrow('Golden journey evidence contained a prohibited data class');
  }
});

test('evidence rejects an email or six-digit code smuggled into a string field', () => {
  expect(() =>
    createGoldenJourneyEvidence({
      ...validInput(),
      environmentHost: 'nurse@school.example',
    }),
  ).toThrow('Golden journey evidence contained a prohibited data class');

  expect(() =>
    assertSafeGoldenJourneyEvidence({
      ...createGoldenJourneyEvidence(validInput()),
      coverage: {
        ...passCoverage,
        clinicalReveal: 'pass code 729104',
      } as never,
    }),
  ).toThrow('Golden journey evidence contained a prohibited data class');
});

test('evidence fails closed when required coverage or provider contracts are missing', () => {
  expect(() =>
    createGoldenJourneyEvidence({
      ...validInput(),
      coverage: {
        staffAuth: 'pass',
      } as typeof passCoverage,
    }),
  ).toThrow('Golden journey evidence coverage is incomplete');

  expect(() =>
    createGoldenJourneyEvidence({
      ...validInput(),
      providerContracts: [{ name: 'postgres', status: 'ok' }],
    }),
  ).toThrow('Golden journey evidence provider contracts are incomplete');
});

test('failed evidence records the observed cleanup status instead of always not-attempted', () => {
  const failed = createFailedGoldenJourneyEvidence({
    environmentHost: 'staging.up.railway.app',
    commit: validInput().commit,
    artifactDigest: validInput().artifactDigest,
    runId: validInput().runId,
    startedAt: validInput().startedAt,
    completedAt: validInput().completedAt,
    lastCompletedStep: 'browser_checked',
    errorCode: 'CLEANUP_FAILED',
    authCleanup: 'failed',
  });
  expect(failed.cleanupBoundary.authCleanup).toBe('failed');
  expect(failed.cleanupBoundary.authCleanup).not.toBe('not-attempted');
});

test('failed evidence records a fixed error code and last step without exception text', () => {
  const failed = createFailedGoldenJourneyEvidence({
    environmentHost: 'staging.up.railway.app',
    commit: validInput().commit,
    artifactDigest: validInput().artifactDigest,
    runId: validInput().runId,
    startedAt: validInput().startedAt,
    completedAt: validInput().completedAt,
    lastCompletedStep: 'gated',
    errorCode: 'DIGEST_MISMATCH',
    authCleanup: 'completed',
  });
  expect(failed.outcome).toBe('failed');
  expect(failed.errorCode).toBe('DIGEST_MISMATCH');
  expect(failed.lastCompletedStep).toBe('gated');
  expect(JSON.stringify(failed)).not.toContain('Error');
  expect(JSON.stringify(failed)).not.toContain('stack');
  expect(() => assertSafeGoldenJourneyEvidence(failed)).not.toThrow();
});

test('failed evidence includes a previously computed artifact digest and omits it before attestation', () => {
  const digest = validInput().artifactDigest;
  expect(artifactDigestForFailureEvidence(digest)).toBe(digest);
  expect(artifactDigestForFailureEvidence(undefined)).toBeUndefined();
  expect(artifactDigestForFailureEvidence('not-a-digest')).toBeUndefined();

  const withDigest = createFailedGoldenJourneyEvidence({
    environmentHost: 'staging.up.railway.app',
    commit: validInput().commit,
    artifactDigest: artifactDigestForFailureEvidence(digest),
    runId: validInput().runId,
    startedAt: validInput().startedAt,
    completedAt: validInput().completedAt,
    lastCompletedStep: 'browser_checked',
    errorCode: 'BROWSER_ASSERTION_FAILED',
    authCleanup: 'completed',
  });
  expect(withDigest.artifactDigest).toBe(digest);

  const beforeAttestation = createFailedGoldenJourneyEvidence({
    environmentHost: 'staging.up.railway.app',
    artifactDigest: artifactDigestForFailureEvidence(undefined),
    runId: validInput().runId,
    startedAt: validInput().startedAt,
    completedAt: validInput().completedAt,
    lastCompletedStep: 'idle',
    errorCode: 'PREFLIGHT_MISSING',
    authCleanup: 'not-attempted',
  });
  expect(beforeAttestation.artifactDigest).toBeUndefined();
  expect(JSON.stringify(beforeAttestation)).not.toContain(digest);
});
