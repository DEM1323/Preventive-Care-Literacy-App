import { expect, test } from 'bun:test';
import { Client } from 'pg';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  queryGoldenJourneyOperatorEvidence,
  recordInvitationDeliveryAttestation,
  recordWorkerArtifactHeartbeat,
} from '../../packages/postgres/src/golden-journey-evidence.ts';
import { startEphemeralPostgres } from '../../packages/test-support/src/postgres.ts';
import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../packages/application-keys/src/index.ts';

const workspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9001';
const isolationWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9014';
const invitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9002';
const otherInvitationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9099';
const publishOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9003';
const invitationOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9006';
const intakeOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9004';
const learningOperationId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9005';
const studentId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf9007';
const startedAt = '2026-08-25T16:00:00.000Z';
const digest = 'a'.repeat(64);

function queryInput() {
  return {
    workspaceId,
    invitationId,
    publishOperationId,
    invitationOperationId,
    intakeOperationId,
    learningOperationId,
    isolationWorkspaceId,
    studentId,
    startedAt,
  };
}

test('operator evidence ignores startup heartbeats, other Invitations, stale timestamps, and generic audit rows', async () => {
  const postgres = await startEphemeralPostgres();
  try {
    await migrate(postgres.connectionString);
    const client = new Client({ connectionString: postgres.connectionString });
    await client.connect();
    const pool = {
      query: (text: string, values?: unknown[]) => client.query(text, values),
    };
    try {
      await client.query(
        `insert into identity_access.school_workspaces
           (workspace_id, display_name, created_at, record_owner,
            record_classification, disposal_class)
         values ($1, 'golden', $2, 'school', 'school_administrative',
                 'school_workspace'),
                ($3, 'isolation', $2, 'school', 'school_administrative',
                 'school_workspace')`,
        [workspaceId, startedAt, isolationWorkspaceId],
      );
      await client.query(
        `insert into audit.evidence
           (audit_id, workspace_id, operation_id, event_type, actor_type,
            actor_id, occurred_at, details, record_owner, record_classification,
            disposal_class)
         values
           ($1, $2, $3, 'school_workspace.created', 'technical_operator',
            'operator', $4, '{}'::jsonb, 'school', 'audit_evidence',
            'workspace_audit_evidence'),
           ($5, $2, $6, 'school_configuration_release.published', 'staff',
            'staff', $4, '{"releaseId":"018f1f5e-7b76-7f70-8f4d-9dc17ecf9111"}'::jsonb,
            'school', 'audit_evidence', 'workspace_audit_evidence')`,
        [
          '018f1f5e-7b76-7f70-8f4d-9dc17ecf9101',
          workspaceId,
          '018f1f5e-7b76-7f70-8f4d-9dc17ecf9102',
          startedAt,
          '018f1f5e-7b76-7f70-8f4d-9dc17ecf9103',
          publishOperationId,
        ],
      );

      await recordWorkerArtifactHeartbeat(pool as never, {
        artifactDigest: digest,
        envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
        recordedAt: new Date(startedAt),
      });
      const heartbeatOnly = (await queryGoldenJourneyOperatorEvidence(
        pool as never,
        queryInput(),
      )) as Record<string, unknown>;
      expect(heartbeatOnly.workerArtifactDigest).toBeNull();
      expect(heartbeatOnly.publishAuditCount).toBe(1);
      expect(JSON.stringify(heartbeatOnly)).not.toContain(
        'school_workspace.created',
      );
      expect(JSON.stringify(heartbeatOnly)).not.toContain('answers');
      expect(JSON.stringify(heartbeatOnly)).not.toContain('@');

      await recordInvitationDeliveryAttestation(pool as never, {
        invitationId: otherInvitationId,
        artifactDigest: digest,
        envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
        recordedAt: new Date(startedAt),
      });
      const otherInvitation = (await queryGoldenJourneyOperatorEvidence(
        pool as never,
        queryInput(),
      )) as Record<string, unknown>;
      expect(otherInvitation.workerArtifactDigest).toBeNull();

      await recordInvitationDeliveryAttestation(pool as never, {
        invitationId,
        artifactDigest: digest,
        envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
        recordedAt: new Date('2026-08-25T15:00:00.000Z'),
      });
      const stale = (await queryGoldenJourneyOperatorEvidence(
        pool as never,
        queryInput(),
      )) as Record<string, unknown>;
      expect(stale.workerArtifactDigest).toBeNull();

      await recordInvitationDeliveryAttestation(pool as never, {
        invitationId,
        artifactDigest: digest,
        envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
        recordedAt: new Date(startedAt),
      });
      const matching = (await queryGoldenJourneyOperatorEvidence(
        pool as never,
        queryInput(),
      )) as Record<string, unknown>;
      expect(matching.workerArtifactDigest).toBe(digest);
      expect(matching.workerRecordedAt).toBe('2026-08-25T16:00:00.000Z');
      expect(Object.keys(matching).sort()).toEqual([
        'clinicalDenialAuditCount',
        'clinicalDenialOccurredAt',
        'clinicalRevealAuditCount',
        'clinicalRevealOccurredAt',
        'intakeEntityId',
        'intakeOccurredAt',
        'intakeReceiptCount',
        'invitationAuditCount',
        'invitationOccurredAt',
        'invitationOutboxCount',
        'invitationReceiptCount',
        'invitationStatus',
        'learningEntityId',
        'learningOccurredAt',
        'learningReceiptCount',
        'publishAuditCount',
        'publishOccurredAt',
        'publishOutboxCount',
        'publishPackageDigest',
        'publishReceiptCount',
        'publishReleaseId',
        'publishReleaseNumber',
        'unattributedDenialCount',
        'unattributedDenialOccurredAt',
        'workerArtifactDigest',
        'workerEnvelopeAdapter',
        'workerRecordedAt',
      ]);
    } finally {
      await client.end();
    }
  } finally {
    await postgres.stop();
  }
});
