import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Client, Pool } from 'pg';
import { listOperatorWorkspaces } from '../../packages/postgres/src/operator-workspaces.ts';
import { migrate } from '../../packages/postgres/src/migrate.ts';
import {
  countVisibleSchoolWorkspaces,
  createRuntimeDatabaseUser,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../packages/test-support/src/postgres.ts';

const uninitializedWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1101';
const draftWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1102';
const activeWorkspaceId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1103';
const releaseId = '018f1f5e-7b76-7f70-8f4d-9dc17ecf1104';

let postgres: EphemeralPostgres;
let runtimeDatabaseUrl: string;

beforeAll(async () => {
  postgres = await startEphemeralPostgres();
  await migrate(postgres.connectionString);
  runtimeDatabaseUrl = await createRuntimeDatabaseUser(
    postgres.connectionString,
  );

  const owner = new Client({ connectionString: postgres.connectionString });
  await owner.connect();
  try {
    await owner.query(
      `insert into identity_access.school_workspaces
         (workspace_id, display_name, created_at, record_owner, record_classification, disposal_class)
       values
         ($1, 'Uninitialized School', '2026-08-23T10:00:00Z', 'school', 'school_administrative', 'school_workspace'),
         ($2, 'Draft School', '2026-08-24T10:00:00Z', 'school', 'school_administrative', 'school_workspace'),
         ($3, 'Active School', '2026-08-25T10:00:00Z', 'school', 'school_administrative', 'school_workspace')`,
      [uninitializedWorkspaceId, draftWorkspaceId, activeWorkspaceId],
    );
    await owner.query(
      `insert into identity_access.staff_identities
         (staff_identity_id, workspace_id, display_name, email, supabase_user_id,
          status, school_approver, provisioning_reason, created_at,
          record_owner, record_classification, disposal_class)
       values
         ('018f1f5e-7b76-7f70-8f4d-9dc17ecf1111', $1, 'Draft Staff', 'draft@example.test',
          '018f1f5e-7b76-7f70-8f4d-9dc17ecf1121', 'active', 'Approver', 'Test', now(),
          'school', 'school_administrative', 'staff_identity'),
         ('018f1f5e-7b76-7f70-8f4d-9dc17ecf1112', $2, 'Active Staff One', 'active1@example.test',
          '018f1f5e-7b76-7f70-8f4d-9dc17ecf1122', 'active', 'Approver', 'Test', now(),
          'school', 'school_administrative', 'staff_identity'),
         ('018f1f5e-7b76-7f70-8f4d-9dc17ecf1113', $2, 'Active Staff Two', 'active2@example.test',
          '018f1f5e-7b76-7f70-8f4d-9dc17ecf1123', 'active', 'Approver', 'Test', now(),
          'school', 'school_administrative', 'staff_identity')`,
      [draftWorkspaceId, activeWorkspaceId],
    );
    await owner.query(
      `insert into school_configuration.configuration_releases
         (release_id, workspace_id, release_number, candidate_fingerprint,
          candidate_fingerprint_algorithm, change_description, published_by, published_at)
       values ($1, $2, 1, $3, 'school-configuration-candidate/v1', 'Initial release',
         '018f1f5e-7b76-7f70-8f4d-9dc17ecf1131', now())`,
      [releaseId, activeWorkspaceId, 'a'.repeat(64)],
    );
    await owner.query(
      `insert into school_configuration.configuration_states
         (workspace_id, draft_version, active_release_id, next_release_number)
       values ($1, 2, null, 1), ($2, 4, $3, 2)`,
      [draftWorkspaceId, activeWorkspaceId, releaseId],
    );
  } finally {
    await owner.end();
  }
});

afterAll(async () => {
  await postgres?.stop();
});

test('operator workspace catalog projects bounded non-sensitive summaries across forced RLS', async () => {
  const pool = new Pool({ connectionString: runtimeDatabaseUrl });
  try {
    expect(await countVisibleSchoolWorkspaces(runtimeDatabaseUrl)).toBe(0);
    expect(await listOperatorWorkspaces(pool)).toEqual([
      {
        workspaceId: activeWorkspaceId,
        displayName: 'Active School',
        createdAt: '2026-08-25T10:00:00.000Z',
        staffCount: 2,
        configurationState: 'active',
        draftVersion: 4,
        activeReleaseId: releaseId,
      },
      {
        workspaceId: draftWorkspaceId,
        displayName: 'Draft School',
        createdAt: '2026-08-24T10:00:00.000Z',
        staffCount: 1,
        configurationState: 'draft',
        draftVersion: 2,
        activeReleaseId: null,
      },
      {
        workspaceId: uninitializedWorkspaceId,
        displayName: 'Uninitialized School',
        createdAt: '2026-08-23T10:00:00.000Z',
        staffCount: 0,
        configurationState: 'uninitialized',
        draftVersion: null,
        activeReleaseId: null,
      },
    ]);
  } finally {
    await pool.end();
  }
});
