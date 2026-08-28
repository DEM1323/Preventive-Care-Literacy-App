import { expect, test } from 'bun:test';
import { Client } from 'pg';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import { startEphemeralPostgres } from '../../packages/test-support/src/postgres.ts';

test('migrations apply in order and are repeatable', async () => {
  const postgres = await startEphemeralPostgres();
  try {
    await migrate(postgres.connectionString);
    await migrate(postgres.connectionString);

    const client = new Client({ connectionString: postgres.connectionString });
    await client.connect();
    try {
      const applied = await client.query<{ name: string }>(
        'select name from public.schema_migrations order by name',
      );
      expect(applied.rows).toEqual([
        { name: '001_audited_spine.sql' },
        { name: '002_staff_authentication.sql' },
        { name: '003_class_invitation.sql' },
        { name: '004_student_access.sql' },
        { name: '005_school_configuration_release.sql' },
        { name: '006_intake_record_version.sql' },
        { name: '007_intake_operation_receipts.sql' },
        { name: '008_item_completion.sql' },
        { name: '009_clinical_intake_reveal.sql' },
        { name: '010_unattributed_reveal_attempts.sql' },
        { name: '011_clinical_reveal_boundary_audit.sql' },
        { name: '012_clinical_reveal_authority_locks.sql' },
        { name: '013_golden_journey_operator_evidence.sql' },
        { name: '014_invitation_delivery_attestation.sql' },
        { name: '015_golden_journey_outbox_filters.sql' },
        { name: '016_operator_workspace_catalog.sql' },
        { name: '017_staff_session_inactivity.sql' },
        { name: '018_staff_lifecycle.sql' },
        { name: '019_invitation_lifecycle.sql' },
        { name: '020_configuration_release_history.sql' },
        { name: '021_student_sign_in.sql' },
        { name: '022_student_access_administration.sql' },
        { name: '023_intake_draft_revision.sql' },
        { name: '024_intake_successor_pointer.sql' },
        { name: '025_intake_release_reconciliation.sql' },
        { name: '026_learning_release_evolution.sql' },
        { name: '027_clinical_review_workspace.sql' },
        { name: '028_student_record_lifecycle.sql' },
        { name: '029_record_amendments_productions.sql' },
        { name: '030_record_disposition.sql' },
      ]);
    } finally {
      await client.end();
    }
  } finally {
    await postgres.stop();
  }
});
