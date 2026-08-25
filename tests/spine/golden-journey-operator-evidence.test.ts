import { expect, test } from 'bun:test';
import { Client } from 'pg';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  queryGoldenJourneyOperatorEvidence,
  recordWorkerArtifactHeartbeat,
} from '../../packages/postgres/src/golden-journey-evidence.ts';
import { startEphemeralPostgres } from '../../packages/test-support/src/postgres.ts';
import { APPLICATION_LAYER_ENVELOPE_V1 } from '../../packages/application-keys/src/index.ts';

test('operator evidence returns only counts, statuses, and digests', async () => {
  const postgres = await startEphemeralPostgres();
  try {
    await migrate(postgres.connectionString);
    const client = new Client({ connectionString: postgres.connectionString });
    await client.connect();
    const pool = {
      query: (text: string, values?: unknown[]) => client.query(text, values),
    };
    try {
      const digest = 'a'.repeat(64);
      await recordWorkerArtifactHeartbeat(pool as never, {
        artifactDigest: digest,
        envelopeAdapter: APPLICATION_LAYER_ENVELOPE_V1,
        recordedAt: new Date('2026-08-25T16:00:00.000Z'),
      });
      const evidence = (await queryGoldenJourneyOperatorEvidence(
        pool as never,
        {
          workspaceId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9001',
          invitationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9002',
          publishOperationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9003',
          intakeOperationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9004',
          learningOperationId: '018f1f5e-7b76-7f70-8f4d-9dc17ecf9005',
        },
      )) as Record<string, unknown>;
      expect(Object.keys(evidence).sort()).toEqual([
        'auditRowCount',
        'intakeReceiptPresent',
        'invitationStatus',
        'learningReceiptPresent',
        'outboxCompletedCount',
        'packageDigest',
        'releaseId',
        'releaseNumber',
        'workerArtifactDigest',
        'workerEnvelopeAdapter',
        'workerRecordedAt',
      ]);
      expect(evidence.workerArtifactDigest).toBe(digest);
      expect(JSON.stringify(evidence)).not.toContain('answers');
      expect(JSON.stringify(evidence)).not.toContain('ciphertext');
      expect(JSON.stringify(evidence)).not.toContain('@');
    } finally {
      await client.end();
    }
  } finally {
    await postgres.stop();
  }
});
