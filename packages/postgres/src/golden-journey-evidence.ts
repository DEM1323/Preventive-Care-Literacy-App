import type { Pool } from 'pg';

export async function recordWorkerArtifactHeartbeat(
  pool: Pool,
  input: {
    artifactDigest: string;
    envelopeAdapter: 'application-layer-envelope/v1';
    invitationId?: string;
    recordedAt: Date;
  },
): Promise<void> {
  await pool.query(
    'select infrastructure.record_worker_artifact_heartbeat($1, $2, $3, $4)',
    [
      input.artifactDigest,
      input.envelopeAdapter,
      input.invitationId ?? null,
      input.recordedAt,
    ],
  );
}

export async function recordInvitationDeliveryAttestation(
  pool: Pool,
  input: {
    invitationId: string;
    artifactDigest: string;
    envelopeAdapter: 'application-layer-envelope/v1';
    recordedAt: Date;
  },
): Promise<void> {
  await pool.query(
    'select infrastructure.record_invitation_delivery_attestation($1, $2, $3, $4)',
    [
      input.invitationId,
      input.artifactDigest,
      input.envelopeAdapter,
      input.recordedAt,
    ],
  );
}

export async function queryGoldenJourneyOperatorEvidence(
  pool: Pool,
  input: {
    workspaceId: string;
    invitationId: string;
    publishOperationId: string;
    invitationOperationId: string;
    intakeOperationId: string;
    learningOperationId: string;
    isolationWorkspaceId: string;
    studentId: string;
    startedAt: string;
  },
): Promise<unknown> {
  const result = await pool.query<{ evidence: unknown }>(
    'select infrastructure.golden_journey_operator_evidence($1, $2, $3, $4, $5, $6, $7, $8, $9) as evidence',
    [
      input.workspaceId,
      input.invitationId,
      input.publishOperationId,
      input.invitationOperationId,
      input.intakeOperationId,
      input.learningOperationId,
      input.isolationWorkspaceId,
      input.studentId,
      input.startedAt,
    ],
  );
  return result.rows[0]?.evidence;
}
