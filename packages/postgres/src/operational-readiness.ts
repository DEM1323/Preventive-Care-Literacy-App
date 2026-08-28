import type { Pool } from 'pg';
import type {
  BackupConfigurationStatus,
  IncidentEvidence,
  OperationalReadinessStore,
  OperatorAlert,
} from '../../../modules/operational-readiness/index.ts';

function parseJson<T>(value: T | string | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

export function createPostgresOperationalReadinessStore(options: {
  pool: Pool;
}): OperationalReadinessStore {
  return {
    async readBackupConfiguration() {
      const listed = await options.pool.query<{
        read_backup_configuration: BackupConfigurationStatus | string | null;
      }>('select infrastructure.read_backup_configuration()');
      return parseJson(listed.rows[0]?.read_backup_configuration ?? undefined);
    },

    async recordBackupConfiguration(request) {
      const recorded = await options.pool.query<{
        record_backup_configuration: {
          outcome: 'applied' | 'replayed' | 'operation_reused';
          result?: BackupConfigurationStatus;
        };
      }>(
        'select infrastructure.record_backup_configuration($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          request.operationId,
          request.actorId,
          request.evidence.dailyBackupsEnabled,
          request.evidence.pointInTimeRecoveryDays,
          request.evidence.source,
          request.evidence.evidenceDigest,
          request.status.status,
          request.occurredAt,
        ],
      );
      const payload = recorded.rows[0]?.record_backup_configuration;
      if (!payload || payload.outcome === 'operation_reused') {
        return { outcome: 'operation_reused' };
      }
      if (!payload.result) return { outcome: 'operation_reused' };
      return { outcome: payload.outcome, status: payload.result };
    },

    async readRestoreRun() {
      const listed = await options.pool.query<{
        read_restore_run:
          { succeeded: boolean; recordedAt: string } | string | null;
      }>('select infrastructure.read_restore_run()');
      return parseJson(listed.rows[0]?.read_restore_run ?? undefined);
    },

    async recordRestoreRun(request) {
      const recorded = await options.pool.query<{
        record_restore_run: {
          outcome: 'applied' | 'replayed' | 'operation_reused';
          result?: { succeeded: boolean; recordedAt: string };
        };
      }>('select infrastructure.record_restore_run($1,$2,$3,$4,$5)', [
        request.operationId,
        request.actorId,
        request.succeeded,
        request.source,
        request.occurredAt,
      ]);
      const payload = recorded.rows[0]?.record_restore_run;
      if (
        !payload ||
        payload.outcome === 'operation_reused' ||
        !payload.result
      ) {
        return { outcome: 'operation_reused' };
      }
      return {
        outcome: payload.outcome,
        succeeded: payload.result.succeeded,
        recordedAt: payload.result.recordedAt,
      };
    },

    async readPurgeRestoreGate() {
      const listed = await options.pool.query<{
        read_purge_restore_gate: { status: string } | string | null;
      }>('select infrastructure.read_purge_restore_gate()');
      const value = parseJson(
        listed.rows[0]?.read_purge_restore_gate ?? undefined,
      );
      const status = value?.status;
      if (
        status === 'pending' ||
        status === 'verified' ||
        status === 'failed' ||
        status === 'not_required'
      ) {
        return status;
      }
      return 'not_required';
    },

    async listAlerts() {
      const listed = await options.pool.query<{
        list_operator_alerts: OperatorAlert[] | string;
      }>('select infrastructure.list_operator_alerts()');
      return parseJson(listed.rows[0]?.list_operator_alerts ?? []) ?? [];
    },

    async emitAlert(request) {
      const emitted = await options.pool.query<{
        emit_operator_alert: OperatorAlert | string;
      }>('select infrastructure.emit_operator_alert($1,$2,$3,$4)', [
        request.alertId,
        request.kind,
        request.summary,
        request.occurredAt,
      ]);
      const alert = parseJson(emitted.rows[0]?.emit_operator_alert);
      if (!alert) {
        throw new Error('Operator alert was not recorded');
      }
      return alert;
    },

    async acknowledgeAlert(request) {
      const acknowledged = await options.pool.query<{
        acknowledge_operator_alert: {
          outcome: 'applied' | 'replayed' | 'not_found' | 'operation_reused';
          result?: OperatorAlert;
        };
      }>('select infrastructure.acknowledge_operator_alert($1,$2,$3,$4)', [
        request.operationId,
        request.alertId,
        request.actorId,
        request.occurredAt,
      ]);
      const payload = acknowledged.rows[0]?.acknowledge_operator_alert;
      if (!payload || payload.outcome === 'not_found') {
        return { outcome: 'not_found' };
      }
      if (payload.outcome === 'operation_reused' || !payload.result) {
        return { outcome: 'operation_reused' };
      }
      return { outcome: payload.outcome, alert: payload.result };
    },

    async activityIsStopped() {
      const listed = await options.pool.query<{ activity_is_stopped: boolean }>(
        'select infrastructure.activity_is_stopped()',
      );
      return listed.rows[0]?.activity_is_stopped === true;
    },

    async readIncident() {
      const listed = await options.pool.query<{
        read_incident_drill: IncidentEvidence | string | null;
      }>('select infrastructure.read_incident_drill()');
      return parseJson(listed.rows[0]?.read_incident_drill ?? undefined);
    },

    async requestStop(request) {
      const requested = await options.pool.query<{
        request_incident_stop: {
          outcome: 'applied' | 'replayed' | 'operation_reused';
          result?: IncidentEvidence;
        };
      }>('select infrastructure.request_incident_stop($1,$2,$3,$4,$5)', [
        request.operationId,
        request.incidentId,
        request.actorType,
        request.actorId,
        request.occurredAt,
      ]);
      const payload = requested.rows[0]?.request_incident_stop;
      if (
        !payload ||
        payload.outcome === 'operation_reused' ||
        !payload.result
      ) {
        return { outcome: 'operation_reused' };
      }
      return { outcome: payload.outcome, incident: payload.result };
    },

    async revokeAccess(request) {
      const revoked = await options.pool.query<{
        revoke_incident_access: {
          outcome: 'applied' | 'replayed' | 'not_stopped' | 'operation_reused';
          result?: IncidentEvidence;
        };
      }>('select infrastructure.revoke_incident_access($1,$2,$3,$4,$5)', [
        request.operationId,
        request.actorId,
        request.wrappingKeyId,
        request.deliveryKeyId,
        request.occurredAt,
      ]);
      const payload = revoked.rows[0]?.revoke_incident_access;
      if (!payload || payload.outcome === 'not_stopped') {
        return { outcome: 'not_stopped' };
      }
      if (payload.outcome === 'operation_reused' || !payload.result) {
        return { outcome: 'operation_reused' };
      }
      return { outcome: payload.outcome, incident: payload.result };
    },

    async preserveEvidence(request) {
      const preserved = await options.pool.query<{
        preserve_incident_evidence: {
          outcome:
            'applied' | 'replayed' | 'sequence_required' | 'operation_reused';
          result?: IncidentEvidence;
        };
      }>('select infrastructure.preserve_incident_evidence($1,$2,$3)', [
        request.operationId,
        request.actorId,
        request.occurredAt,
      ]);
      const payload = preserved.rows[0]?.preserve_incident_evidence;
      if (!payload || payload.outcome === 'sequence_required') {
        return { outcome: 'sequence_required' };
      }
      if (payload.outcome === 'operation_reused' || !payload.result) {
        return { outcome: 'operation_reused' };
      }
      return { outcome: payload.outcome, incident: payload.result };
    },

    async recordRepair(request) {
      const repaired = await options.pool.query<{
        record_incident_repair: {
          outcome:
            'applied' | 'replayed' | 'sequence_required' | 'operation_reused';
          result?: IncidentEvidence;
        };
      }>('select infrastructure.record_incident_repair($1,$2,$3)', [
        request.operationId,
        request.actorId,
        request.occurredAt,
      ]);
      const payload = repaired.rows[0]?.record_incident_repair;
      if (!payload || payload.outcome === 'sequence_required') {
        return { outcome: 'sequence_required' };
      }
      if (payload.outcome === 'operation_reused' || !payload.result) {
        return { outcome: 'operation_reused' };
      }
      return { outcome: payload.outcome, incident: payload.result };
    },

    async recordChecks(request) {
      const recorded = await options.pool.query<{
        record_incident_checks: {
          outcome:
            'applied' | 'replayed' | 'sequence_required' | 'operation_reused';
          result?: IncidentEvidence;
        };
      }>(
        'select infrastructure.record_incident_checks($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)',
        [
          request.operationId,
          request.actorId,
          JSON.stringify(request.checks),
          request.acceptedArtifactDigest,
          request.currentArtifactDigest,
          request.processSecrets.wrappingKeyId,
          request.processSecrets.deliveryKeyId,
          request.processSecrets.secretGeneration,
          request.occurredAt,
        ],
      );
      const payload = recorded.rows[0]?.record_incident_checks;
      if (!payload || payload.outcome === 'sequence_required') {
        return { outcome: 'sequence_required' };
      }
      if (payload.outcome === 'operation_reused' || !payload.result) {
        return { outcome: 'operation_reused' };
      }
      return { outcome: payload.outcome, incident: payload.result };
    },

    async authorizeResume(request) {
      const resumed = await options.pool.query<{
        authorize_incident_resume: {
          outcome:
            | 'applied'
            | 'replayed'
            | 'blocked'
            | 'not_authorized'
            | 'operation_reused';
          result?: IncidentEvidence;
          code?: string;
        };
      }>('select infrastructure.authorize_incident_resume($1,$2,$3,$4,$5,$6)', [
        request.operationId,
        request.actorId,
        request.processSecrets.wrappingKeyId,
        request.processSecrets.deliveryKeyId,
        request.processSecrets.secretGeneration,
        request.occurredAt,
      ]);
      const payload = resumed.rows[0]?.authorize_incident_resume;
      if (!payload) return { outcome: 'blocked', code: 'INCIDENT_NOT_STOPPED' };
      if (payload.outcome === 'blocked') {
        return {
          outcome: 'blocked',
          code:
            payload.code === 'INCIDENT_SECRETS_NOT_REVOKED' ||
            payload.code === 'INCIDENT_EVIDENCE_NOT_PRESERVED' ||
            payload.code === 'INCIDENT_NOT_REPAIRED' ||
            payload.code === 'INCIDENT_CHECKS_FAILED' ||
            payload.code === 'INCIDENT_STALE_SECRETS' ||
            payload.code === 'INCIDENT_PURGE_OBLIGATION' ||
            payload.code === 'INCIDENT_ARTIFACT_MISMATCH' ||
            payload.code === 'INCIDENT_SEQUENCE_REQUIRED' ||
            payload.code === 'INCIDENT_NOT_STOPPED'
              ? payload.code
              : 'INCIDENT_NOT_STOPPED',
        };
      }
      if (payload.outcome === 'operation_reused' || !payload.result) {
        return { outcome: 'operation_reused' };
      }
      return { outcome: payload.outcome, incident: payload.result };
    },
  };
}
