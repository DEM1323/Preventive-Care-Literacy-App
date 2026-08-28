export const serviceCaps = {
  databasePoolMax: 10,
  databasePoolIdleTimeoutMs: 10_000,
  databasePoolConnectionTimeoutMs: 5_000,
  requestBodyLimitBytes: 64 * 1024,
  workerRequestBodyLimitBytes: 1024,
  workerConcurrency: 1,
  taskMaxAttempts: 5,
  taskBackoffInitialSeconds: 30,
  taskBackoffMaxSeconds: 15 * 60,
  invitationChallengeMaxFailedAttempts: 5,
} as const;

export const requiredBackupConfiguration = {
  dailyBackupsRequired: true,
  pointInTimeRecoveryDays: 7,
} as const;

export const alertKinds = [
  'uptime',
  'application_error',
  'database_capacity',
  'failed_email',
] as const;

export type AlertKind = (typeof alertKinds)[number];

export const operatorAlertDestination = 'technical_operator' as const;

export const nonWaivableIncidentChecks = [
  'purge_restore_gate',
  'artifact_identity',
  'secret_generation',
  'backup_configuration',
] as const;

export type NonWaivableIncidentCheck =
  (typeof nonWaivableIncidentChecks)[number];

export const incidentStopRequesterTypes = [
  'technical_operator',
  'school_nurse',
] as const;

export type IncidentStopRequesterType =
  (typeof incidentStopRequesterTypes)[number];

export type BackupProviderEvidence = {
  dailyBackupsEnabled: boolean;
  pointInTimeRecoveryDays: number;
  source: 'automated_contract' | 'provider_dashboard';
  evidenceDigest: string;
};

export type BackupConfigurationStatus = BackupProviderEvidence & {
  status: 'satisfied' | 'unsatisfied';
  requiredPointInTimeRecoveryDays: number;
};

export type RestoreResumeInput = {
  backup: BackupConfigurationStatus;
  purgeRestoreGate: 'not_required' | 'pending' | 'verified' | 'failed';
  restoreSucceeded: boolean;
};

export type RestoreResumeDecision = {
  allowed: boolean;
  code?:
    | 'BACKUP_CONFIGURATION_UNSATISFIED'
    | 'RESTORE_DID_NOT_SUCCEED'
    | 'PURGE_RESTORE_GATE_NOT_VERIFIED'
    | 'PURGE_MANIFESTS_NOT_REAPPLIED';
};

export type AlertDraft = {
  kind: AlertKind;
  summary: string;
  payload?: Record<string, unknown>;
};

export type OperatorAlert = {
  alertId: string;
  kind: AlertKind;
  summary: string;
  destination: typeof operatorAlertDestination;
  acknowledged: boolean;
  acknowledgedBy?: string;
  recordedAt: string;
};

export type ArtifactCompatibilityInput = {
  currentSchemaMigrations: readonly string[];
  targetSchemaMigrations: readonly string[];
  currentArtifactDigest: string;
  targetArtifactDigest: string;
};

export type ArtifactRollbackDecision = {
  decision: 'schema_compatible_rollback' | 'roll_forward_only';
  reason:
    | 'SAME_SCHEMA'
    | 'EXPAND_CONTRACT_COMPATIBLE'
    | 'TARGET_SCHEMA_AHEAD'
    | 'SCHEMA_DIVERGED';
  currentArtifactDigest: string;
  targetArtifactDigest: string;
};

export type ProviderDenialInput = {
  status?: number;
  retryable?: boolean;
  permanent?: boolean;
};

export type ProviderDenialClassification = 'deterministic' | 'transient';

export type IncidentCheckResult = {
  check: NonWaivableIncidentCheck;
  outcome: 'passed' | 'failed';
};

export type IncidentDrillStatus =
  | 'idle'
  | 'stopped'
  | 'secrets_revoked'
  | 'evidence_preserved'
  | 'repaired'
  | 'checks_recorded'
  | 'resumed';

export type IncidentEvidence = {
  incidentId: string;
  status: IncidentDrillStatus;
  stopped: boolean;
  requestedByType: IncidentStopRequesterType;
  requestedById: string;
  revokedStaffSessionCount: number;
  revokedStudentSessionCount: number;
  secretsRevoked: boolean;
  secretGeneration: number;
  wrappingKeyId: string | null;
  deliveryKeyId: string | null;
  acceptedArtifactDigest: string | null;
  currentArtifactDigest: string | null;
  checks: IncidentCheckResult[];
  resumeAuthorizedBy: string | null;
  recordedAt: string;
};

export type ProcessSecretIdentity = {
  wrappingKeyId: string;
  deliveryKeyId: string;
  secretGeneration: number;
};

export class BackupConfigurationUnsatisfiedError extends Error {
  readonly code = 'BACKUP_CONFIGURATION_UNSATISFIED';
  constructor() {
    super('Daily backups and seven-day point-in-time recovery are required');
    this.name = 'BackupConfigurationUnsatisfiedError';
  }
}

export class RestoreResumeNotAllowedError extends Error {
  readonly code: NonNullable<RestoreResumeDecision['code']>;
  constructor(code: NonNullable<RestoreResumeDecision['code']>) {
    super(
      'Restored service cannot resume until backup, restore, and purge proof pass',
    );
    this.name = 'RestoreResumeNotAllowedError';
    this.code = code;
  }
}

export class OperatorAlertNotFoundError extends Error {
  readonly code = 'OPERATOR_ALERT_NOT_FOUND';
  constructor() {
    super('Operator alert was not found');
    this.name = 'OperatorAlertNotFoundError';
  }
}

export class IncidentStopRequesterDeniedError extends Error {
  readonly code = 'INCIDENT_STOP_REQUESTER_DENIED';
  constructor() {
    super(
      'Only the Technical Operator or a School Nurse may request incident stop',
    );
    this.name = 'IncidentStopRequesterDeniedError';
  }
}

export class IncidentActivityStoppedError extends Error {
  readonly code = 'INCIDENT_ACTIVITY_STOPPED';
  constructor() {
    super(
      'New activity is stopped until the Technical Operator authorizes resume',
    );
    this.name = 'IncidentActivityStoppedError';
  }
}

export class IncidentResumeNotAuthorizedError extends Error {
  readonly code = 'INCIDENT_RESUME_NOT_AUTHORIZED';
  constructor() {
    super('Only the Technical Operator may authorize incident resume');
    this.name = 'IncidentResumeNotAuthorizedError';
  }
}

export class IncidentResumeBlockedError extends Error {
  readonly code:
    | 'INCIDENT_NOT_STOPPED'
    | 'INCIDENT_SECRETS_NOT_REVOKED'
    | 'INCIDENT_EVIDENCE_NOT_PRESERVED'
    | 'INCIDENT_NOT_REPAIRED'
    | 'INCIDENT_CHECKS_FAILED'
    | 'INCIDENT_STALE_SECRETS'
    | 'INCIDENT_PURGE_OBLIGATION'
    | 'INCIDENT_ARTIFACT_MISMATCH'
    | 'INCIDENT_SEQUENCE_REQUIRED';
  constructor(code: IncidentResumeBlockedError['code']) {
    super(
      'Incident resume cannot bypass failed checks, stale secrets, purge obligations, or artifact identity',
    );
    this.name = 'IncidentResumeBlockedError';
    this.code = code;
  }
}

export class IncidentConfirmationRequiredError extends Error {
  readonly code = 'INCIDENT_CONFIRMATION_REQUIRED';
  constructor() {
    super('Incident resume requires explicit Technical Operator authorization');
    this.name = 'IncidentConfirmationRequiredError';
  }
}

export class OperationalReadinessOperationReusedError extends Error {
  readonly code = 'OPERATION_ID_REUSED';
  constructor() {
    super(
      'Operation ID was reused with a different operational-readiness body',
    );
    this.name = 'OperationalReadinessOperationReusedError';
  }
}

export function evaluateBackupConfiguration(
  evidence: BackupProviderEvidence,
): BackupConfigurationStatus {
  const pointInTimeRecoveryDays = Number.isFinite(
    evidence.pointInTimeRecoveryDays,
  )
    ? Math.max(0, Math.trunc(evidence.pointInTimeRecoveryDays))
    : 0;
  const satisfied =
    evidence.dailyBackupsEnabled === true &&
    pointInTimeRecoveryDays >=
      requiredBackupConfiguration.pointInTimeRecoveryDays &&
    /^[0-9a-f]{64}$/.test(evidence.evidenceDigest);
  return {
    dailyBackupsEnabled: evidence.dailyBackupsEnabled === true,
    pointInTimeRecoveryDays,
    source: evidence.source,
    evidenceDigest: evidence.evidenceDigest,
    status: satisfied ? 'satisfied' : 'unsatisfied',
    requiredPointInTimeRecoveryDays:
      requiredBackupConfiguration.pointInTimeRecoveryDays,
  };
}

export function evaluateRestoreResume(
  input: RestoreResumeInput,
): RestoreResumeDecision {
  if (input.backup.status !== 'satisfied') {
    return { allowed: false, code: 'BACKUP_CONFIGURATION_UNSATISFIED' };
  }
  if (!input.restoreSucceeded) {
    return { allowed: false, code: 'RESTORE_DID_NOT_SUCCEED' };
  }
  if (input.purgeRestoreGate === 'failed') {
    return { allowed: false, code: 'PURGE_MANIFESTS_NOT_REAPPLIED' };
  }
  if (input.purgeRestoreGate !== 'verified') {
    return { allowed: false, code: 'PURGE_RESTORE_GATE_NOT_VERIFIED' };
  }
  return { allowed: true };
}

export function sanitizeAlert(draft: AlertDraft): {
  kind: AlertKind;
  summary: string;
} {
  const kind = alertKinds.includes(draft.kind) ? draft.kind : 'uptime';
  const summary = draft.summary.replace(/[^\w\s./:-]/g, '').slice(0, 120);
  return {
    kind,
    summary: summary.length > 0 ? summary : kind,
  };
}

export function alertContainsProtectedContent(
  value: unknown,
  forbidden: readonly string[],
): boolean {
  const serialized = JSON.stringify(value);
  return forbidden.some(
    (token) => token.length > 0 && serialized.includes(token),
  );
}

export function decideArtifactRollback(
  input: ArtifactCompatibilityInput,
): ArtifactRollbackDecision {
  const current = [...input.currentSchemaMigrations];
  const target = [...input.targetSchemaMigrations];
  const sameSchema =
    current.length === target.length &&
    current.every((name, index) => name === target[index]);
  if (sameSchema) {
    return {
      decision: 'schema_compatible_rollback',
      reason: 'SAME_SCHEMA',
      currentArtifactDigest: input.currentArtifactDigest,
      targetArtifactDigest: input.targetArtifactDigest,
    };
  }
  const targetIsPrefix =
    target.length < current.length &&
    target.every((name, index) => name === current[index]);
  if (targetIsPrefix) {
    return {
      decision: 'schema_compatible_rollback',
      reason: 'EXPAND_CONTRACT_COMPATIBLE',
      currentArtifactDigest: input.currentArtifactDigest,
      targetArtifactDigest: input.targetArtifactDigest,
    };
  }
  const currentIsPrefix =
    current.length < target.length &&
    current.every((name, index) => name === target[index]);
  if (currentIsPrefix) {
    return {
      decision: 'roll_forward_only',
      reason: 'TARGET_SCHEMA_AHEAD',
      currentArtifactDigest: input.currentArtifactDigest,
      targetArtifactDigest: input.targetArtifactDigest,
    };
  }
  return {
    decision: 'roll_forward_only',
    reason: 'SCHEMA_DIVERGED',
    currentArtifactDigest: input.currentArtifactDigest,
    targetArtifactDigest: input.targetArtifactDigest,
  };
}

export function classifyProviderDenial(
  input: ProviderDenialInput,
): ProviderDenialClassification {
  if (input.permanent === true) return 'deterministic';
  if (input.retryable === true) return 'transient';
  const status = input.status;
  if (typeof status !== 'number') return 'transient';
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return 'deterministic';
  }
  return 'transient';
}

export function activityRouteIsAllowedDuringStop(path: string): boolean {
  return (
    path.startsWith('/health/') ||
    path.startsWith('/api/v1/operator/') ||
    path === '/api/v1/clinical/incident-stop-requests'
  );
}

export function taskRetryDelaySeconds(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(
    serviceCaps.taskBackoffInitialSeconds * 2 ** exponent,
    serviceCaps.taskBackoffMaxSeconds,
  );
}

export const incidentResumeConfirmation = 'authorize_incident_resume' as const;

export type OperationalReadinessStore = {
  readBackupConfiguration(): Promise<BackupConfigurationStatus | undefined>;
  recordBackupConfiguration(request: {
    operationId: string;
    actorId: string;
    evidence: BackupProviderEvidence;
    status: BackupConfigurationStatus;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; status: BackupConfigurationStatus }
    | { outcome: 'operation_reused' }
  >;
  readRestoreRun(): Promise<
    { succeeded: boolean; recordedAt: string } | undefined
  >;
  recordRestoreRun(request: {
    operationId: string;
    actorId: string;
    succeeded: boolean;
    source: 'automated_contract' | 'provider_restore';
    occurredAt: Date;
  }): Promise<
    | {
        outcome: 'applied' | 'replayed';
        succeeded: boolean;
        recordedAt: string;
      }
    | { outcome: 'operation_reused' }
  >;
  readPurgeRestoreGate(): Promise<
    'not_required' | 'pending' | 'verified' | 'failed'
  >;
  listAlerts(): Promise<OperatorAlert[]>;
  emitAlert(request: {
    alertId: string;
    kind: AlertKind;
    summary: string;
    occurredAt: Date;
  }): Promise<OperatorAlert>;
  acknowledgeAlert(request: {
    operationId: string;
    alertId: string;
    actorId: string;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; alert: OperatorAlert }
    | { outcome: 'not_found' }
    | { outcome: 'operation_reused' }
  >;
  activityIsStopped(): Promise<boolean>;
  readIncident(): Promise<IncidentEvidence | undefined>;
  requestStop(request: {
    operationId: string;
    incidentId: string;
    actorType: IncidentStopRequesterType;
    actorId: string;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; incident: IncidentEvidence }
    | { outcome: 'operation_reused' }
  >;
  revokeAccess(request: {
    operationId: string;
    actorId: string;
    wrappingKeyId: string;
    deliveryKeyId: string;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; incident: IncidentEvidence }
    | { outcome: 'not_stopped' }
    | { outcome: 'operation_reused' }
  >;
  preserveEvidence(request: {
    operationId: string;
    actorId: string;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; incident: IncidentEvidence }
    | { outcome: 'sequence_required' }
    | { outcome: 'operation_reused' }
  >;
  recordRepair(request: {
    operationId: string;
    actorId: string;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; incident: IncidentEvidence }
    | { outcome: 'sequence_required' }
    | { outcome: 'operation_reused' }
  >;
  recordChecks(request: {
    operationId: string;
    actorId: string;
    checks: IncidentCheckResult[];
    acceptedArtifactDigest: string;
    currentArtifactDigest: string;
    processSecrets: ProcessSecretIdentity;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; incident: IncidentEvidence }
    | { outcome: 'sequence_required' }
    | { outcome: 'operation_reused' }
  >;
  authorizeResume(request: {
    operationId: string;
    actorId: string;
    processSecrets: ProcessSecretIdentity;
    occurredAt: Date;
  }): Promise<
    | { outcome: 'applied' | 'replayed'; incident: IncidentEvidence }
    | { outcome: 'not_authorized' }
    | { outcome: 'blocked'; code: IncidentResumeBlockedError['code'] }
    | { outcome: 'operation_reused' }
  >;
};

export type OperationalReadiness = {
  readBackupConfiguration(): Promise<BackupConfigurationStatus | undefined>;
  recordBackupConfiguration(command: {
    operationId: string;
    actorId: string;
    evidence: BackupProviderEvidence;
  }): Promise<BackupConfigurationStatus>;
  readRestoreReadiness(): Promise<{
    backup: BackupConfigurationStatus | undefined;
    restore: { succeeded: boolean; recordedAt: string } | undefined;
    purgeRestoreGate: 'not_required' | 'pending' | 'verified' | 'failed';
    resume: RestoreResumeDecision;
  }>;
  recordRestoreRun(command: {
    operationId: string;
    actorId: string;
    succeeded: boolean;
    source: 'automated_contract' | 'provider_restore';
  }): Promise<{ succeeded: boolean; recordedAt: string }>;
  listAlerts(): Promise<OperatorAlert[]>;
  emitAlert(draft: AlertDraft): Promise<OperatorAlert>;
  acknowledgeAlert(command: {
    operationId: string;
    alertId: string;
    actorId: string;
  }): Promise<OperatorAlert>;
  activityIsStopped(): Promise<boolean>;
  readIncident(): Promise<IncidentEvidence | undefined>;
  requestStop(command: {
    operationId: string;
    actorType: IncidentStopRequesterType;
    actorId: string;
  }): Promise<IncidentEvidence>;
  revokeAccess(command: {
    operationId: string;
    actorId: string;
    wrappingKeyId: string;
    deliveryKeyId: string;
  }): Promise<IncidentEvidence>;
  preserveEvidence(command: {
    operationId: string;
    actorId: string;
  }): Promise<IncidentEvidence>;
  recordRepair(command: {
    operationId: string;
    actorId: string;
  }): Promise<IncidentEvidence>;
  recordChecks(command: {
    operationId: string;
    actorId: string;
    checks: IncidentCheckResult[];
    acceptedArtifactDigest: string;
    currentArtifactDigest: string;
    processSecrets: ProcessSecretIdentity;
  }): Promise<IncidentEvidence>;
  authorizeResume(command: {
    operationId: string;
    actorId: string;
    actorType: 'technical_operator' | 'school_nurse';
    confirmation: string;
    processSecrets: ProcessSecretIdentity;
  }): Promise<IncidentEvidence>;
};

export function createOperationalReadiness(dependencies: {
  store: OperationalReadinessStore;
  clock: { now(): Date };
  ids: { create(): string };
}): OperationalReadiness {
  return {
    readBackupConfiguration() {
      return dependencies.store.readBackupConfiguration();
    },
    async recordBackupConfiguration(command) {
      const status = evaluateBackupConfiguration(command.evidence);
      const recorded = await dependencies.store.recordBackupConfiguration({
        operationId: command.operationId,
        actorId: command.actorId,
        evidence: command.evidence,
        status,
        occurredAt: dependencies.clock.now(),
      });
      if (recorded.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return recorded.status;
    },
    async readRestoreReadiness() {
      const [backup, restore, purgeRestoreGate] = await Promise.all([
        dependencies.store.readBackupConfiguration(),
        dependencies.store.readRestoreRun(),
        dependencies.store.readPurgeRestoreGate(),
      ]);
      const resume = backup
        ? evaluateRestoreResume({
            backup,
            purgeRestoreGate,
            restoreSucceeded: restore?.succeeded === true,
          })
        : {
            allowed: false as const,
            code: 'BACKUP_CONFIGURATION_UNSATISFIED' as const,
          };
      return { backup, restore, purgeRestoreGate, resume };
    },
    async recordRestoreRun(command) {
      const recorded = await dependencies.store.recordRestoreRun({
        ...command,
        occurredAt: dependencies.clock.now(),
      });
      if (recorded.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return { succeeded: recorded.succeeded, recordedAt: recorded.recordedAt };
    },
    listAlerts() {
      return dependencies.store.listAlerts();
    },
    async emitAlert(draft) {
      const sanitized = sanitizeAlert(draft);
      return dependencies.store.emitAlert({
        alertId: dependencies.ids.create(),
        kind: sanitized.kind,
        summary: sanitized.summary,
        occurredAt: dependencies.clock.now(),
      });
    },
    async acknowledgeAlert(command) {
      const acknowledged = await dependencies.store.acknowledgeAlert({
        ...command,
        occurredAt: dependencies.clock.now(),
      });
      if (acknowledged.outcome === 'not_found') {
        throw new OperatorAlertNotFoundError();
      }
      if (acknowledged.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return acknowledged.alert;
    },
    activityIsStopped() {
      return dependencies.store.activityIsStopped();
    },
    readIncident() {
      return dependencies.store.readIncident();
    },
    async requestStop(command) {
      if (!incidentStopRequesterTypes.includes(command.actorType)) {
        throw new IncidentStopRequesterDeniedError();
      }
      const requested = await dependencies.store.requestStop({
        operationId: command.operationId,
        incidentId: dependencies.ids.create(),
        actorType: command.actorType,
        actorId: command.actorId,
        occurredAt: dependencies.clock.now(),
      });
      if (requested.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return requested.incident;
    },
    async revokeAccess(command) {
      const revoked = await dependencies.store.revokeAccess({
        ...command,
        occurredAt: dependencies.clock.now(),
      });
      if (revoked.outcome === 'not_stopped') {
        throw new IncidentResumeBlockedError('INCIDENT_NOT_STOPPED');
      }
      if (revoked.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return revoked.incident;
    },
    async preserveEvidence(command) {
      const preserved = await dependencies.store.preserveEvidence({
        ...command,
        occurredAt: dependencies.clock.now(),
      });
      if (preserved.outcome === 'sequence_required') {
        throw new IncidentResumeBlockedError('INCIDENT_SEQUENCE_REQUIRED');
      }
      if (preserved.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return preserved.incident;
    },
    async recordRepair(command) {
      const repaired = await dependencies.store.recordRepair({
        ...command,
        occurredAt: dependencies.clock.now(),
      });
      if (repaired.outcome === 'sequence_required') {
        throw new IncidentResumeBlockedError('INCIDENT_SEQUENCE_REQUIRED');
      }
      if (repaired.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return repaired.incident;
    },
    async recordChecks(command) {
      const recorded = await dependencies.store.recordChecks({
        ...command,
        occurredAt: dependencies.clock.now(),
      });
      if (recorded.outcome === 'sequence_required') {
        throw new IncidentResumeBlockedError('INCIDENT_SEQUENCE_REQUIRED');
      }
      if (recorded.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return recorded.incident;
    },
    async authorizeResume(command) {
      if (command.actorType !== 'technical_operator') {
        throw new IncidentResumeNotAuthorizedError();
      }
      if (command.confirmation !== incidentResumeConfirmation) {
        throw new IncidentConfirmationRequiredError();
      }
      const resumed = await dependencies.store.authorizeResume({
        operationId: command.operationId,
        actorId: command.actorId,
        processSecrets: command.processSecrets,
        occurredAt: dependencies.clock.now(),
      });
      if (resumed.outcome === 'not_authorized') {
        throw new IncidentResumeNotAuthorizedError();
      }
      if (resumed.outcome === 'blocked') {
        throw new IncidentResumeBlockedError(resumed.code);
      }
      if (resumed.outcome === 'operation_reused') {
        throw new OperationalReadinessOperationReusedError();
      }
      return resumed.incident;
    },
  };
}
