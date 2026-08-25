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

export async function queryGoldenJourneyOperatorEvidence(
  pool: Pool,
  input: {
    workspaceId: string;
    invitationId: string;
    publishOperationId: string;
    intakeOperationId: string;
    learningOperationId: string;
  },
): Promise<unknown> {
  const result = await pool.query<{ evidence: unknown }>(
    'select infrastructure.golden_journey_operator_evidence($1, $2, $3, $4, $5) as evidence',
    [
      input.workspaceId,
      input.invitationId,
      input.publishOperationId,
      input.intakeOperationId,
      input.learningOperationId,
    ],
  );
  return result.rows[0]?.evidence;
}
