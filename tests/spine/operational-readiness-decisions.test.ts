import { expect, test } from 'bun:test';
import {
  activityRouteIsAllowedDuringStop,
  alertContainsProtectedContent,
  classifyProviderDenial,
  decideArtifactRollback,
  evaluateBackupConfiguration,
  evaluateRestoreResume,
  sanitizeAlert,
  serviceCaps,
  taskRetryDelaySeconds,
} from '../../modules/operational-readiness/index.ts';

const evidenceDigest = 'ab'.repeat(32);

test('daily backups and seven-day PITR are required before restore resume', () => {
  expect(
    evaluateBackupConfiguration({
      dailyBackupsEnabled: true,
      pointInTimeRecoveryDays: 7,
      source: 'automated_contract',
      evidenceDigest,
    }).status,
  ).toBe('satisfied');
  expect(
    evaluateBackupConfiguration({
      dailyBackupsEnabled: false,
      pointInTimeRecoveryDays: 7,
      source: 'provider_dashboard',
      evidenceDigest,
    }).status,
  ).toBe('unsatisfied');
  expect(
    evaluateBackupConfiguration({
      dailyBackupsEnabled: true,
      pointInTimeRecoveryDays: 6,
      source: 'provider_dashboard',
      evidenceDigest,
    }).status,
  ).toBe('unsatisfied');

  const backup = evaluateBackupConfiguration({
    dailyBackupsEnabled: true,
    pointInTimeRecoveryDays: 7,
    source: 'automated_contract',
    evidenceDigest,
  });
  expect(
    evaluateRestoreResume({
      backup,
      purgeRestoreGate: 'verified',
      restoreSucceeded: true,
    }),
  ).toEqual({ allowed: true });
  expect(
    evaluateRestoreResume({
      backup,
      purgeRestoreGate: 'pending',
      restoreSucceeded: true,
    }).code,
  ).toBe('PURGE_RESTORE_GATE_NOT_VERIFIED');
  expect(
    evaluateRestoreResume({
      backup,
      purgeRestoreGate: 'failed',
      restoreSucceeded: true,
    }).code,
  ).toBe('PURGE_MANIFESTS_NOT_REAPPLIED');
  expect(
    evaluateRestoreResume({
      backup,
      purgeRestoreGate: 'verified',
      restoreSucceeded: false,
    }).code,
  ).toBe('RESTORE_DID_NOT_SUCCEED');
});

test('operator alerts keep only non-sensitive kind and summary', () => {
  const alert = sanitizeAlert({
    kind: 'failed_email',
    summary: 'Invitation delivery failed',
    payload: {
      recipient: 'student.repair@example.test',
      code: '729104',
      answers: { asthma: 'yes' },
    },
  });
  expect(alert).toEqual({
    kind: 'failed_email',
    summary: 'Invitation delivery failed',
  });
  expect(
    alertContainsProtectedContent(alert, [
      'student.repair@example.test',
      '729104',
      'asthma',
    ]),
  ).toBe(false);
});

test('explicit caps encode pool, request, worker, and retry limits', () => {
  expect(serviceCaps).toEqual({
    databasePoolMax: 10,
    databasePoolIdleTimeoutMs: 10_000,
    databasePoolConnectionTimeoutMs: 5_000,
    requestBodyLimitBytes: 64 * 1024,
    workerRequestBodyLimitBytes: 1024,
    workerConcurrency: 1,
    taskMaxAttempts: 5,
    taskBackoffInitialSeconds: 30,
    taskBackoffMaxSeconds: 900,
    invitationChallengeMaxFailedAttempts: 5,
  });
  expect(taskRetryDelaySeconds(1)).toBe(30);
  expect(taskRetryDelaySeconds(2)).toBe(60);
  expect(taskRetryDelaySeconds(6)).toBe(900);
});

test('artifact rollback is schema-compatible or roll-forward-only', () => {
  const digestA = 'aa'.repeat(32);
  const digestB = 'bb'.repeat(32);
  const schema = ['001_audited_spine.sql', '032_operator_repair.sql'];
  expect(
    decideArtifactRollback({
      currentSchemaMigrations: schema,
      targetSchemaMigrations: schema,
      currentArtifactDigest: digestA,
      targetArtifactDigest: digestB,
    }),
  ).toMatchObject({
    decision: 'schema_compatible_rollback',
    reason: 'SAME_SCHEMA',
  });
  expect(
    decideArtifactRollback({
      currentSchemaMigrations: [...schema, '033_operational_readiness.sql'],
      targetSchemaMigrations: schema,
      currentArtifactDigest: digestA,
      targetArtifactDigest: digestB,
    }),
  ).toMatchObject({
    decision: 'schema_compatible_rollback',
    reason: 'EXPAND_CONTRACT_COMPATIBLE',
  });
  expect(
    decideArtifactRollback({
      currentSchemaMigrations: schema,
      targetSchemaMigrations: [...schema, '033_operational_readiness.sql'],
      currentArtifactDigest: digestA,
      targetArtifactDigest: digestB,
    }),
  ).toMatchObject({
    decision: 'roll_forward_only',
    reason: 'TARGET_SCHEMA_AHEAD',
  });
  expect(
    decideArtifactRollback({
      currentSchemaMigrations: schema,
      targetSchemaMigrations: ['001_audited_spine.sql', '999_other.sql'],
      currentArtifactDigest: digestA,
      targetArtifactDigest: digestB,
    }),
  ).toMatchObject({
    decision: 'roll_forward_only',
    reason: 'SCHEMA_DIVERGED',
  });
});

test('provider denials distinguish deterministic rejection from transient failure', () => {
  expect(classifyProviderDenial({ permanent: true })).toBe('deterministic');
  expect(classifyProviderDenial({ status: 403 })).toBe('deterministic');
  expect(classifyProviderDenial({ status: 408 })).toBe('transient');
  expect(classifyProviderDenial({ status: 429, retryable: true })).toBe(
    'transient',
  );
  expect(classifyProviderDenial({ status: 503 })).toBe('transient');
});

test('incident stop leaves health and operator recovery routes available', () => {
  expect(activityRouteIsAllowedDuringStop('/health/ready')).toBe(true);
  expect(activityRouteIsAllowedDuringStop('/health/live')).toBe(true);
  expect(activityRouteIsAllowedDuringStop('/api/v1/operator/incidents')).toBe(
    true,
  );
  expect(
    activityRouteIsAllowedDuringStop('/api/v1/clinical/incident-stop-requests'),
  ).toBe(true);
  expect(
    activityRouteIsAllowedDuringStop(
      '/api/v1/administration/school-workspaces',
    ),
  ).toBe(false);
  expect(activityRouteIsAllowedDuringStop('/api/v1/auth/student/sign-in')).toBe(
    false,
  );
});
