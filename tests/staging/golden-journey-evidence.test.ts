import { expect, test } from 'bun:test';
import {
  GOLDEN_JOURNEY_EVIDENCE_SCHEMA_VERSION,
  assertSafeGoldenJourneyEvidence,
  createGoldenJourneyEvidence,
} from '../../packages/golden-journey/src/index.ts';

const opaqueIds = {
  workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8001',
  staffIdentityId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8002',
  classId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8003',
  invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8004',
  restorationInvitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8005',
  releaseId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8006',
  studentId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8007',
  intakeRecordVersionId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8008',
  itemCompletionId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf8009',
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
  });
  expect(Object.keys(evidence)).toEqual([
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
