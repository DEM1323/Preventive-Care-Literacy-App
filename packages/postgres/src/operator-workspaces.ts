import type { Pool } from 'pg';

export type OperatorWorkspaceSummary = {
  workspaceId: string;
  displayName: string;
  createdAt: string;
  staffCount: number;
  configurationState: 'uninitialized' | 'draft' | 'active';
  draftVersion: number | null;
  activeReleaseId: string | null;
};

export async function listOperatorWorkspaces(
  pool: Pool,
): Promise<OperatorWorkspaceSummary[]> {
  const result = await pool.query<{
    workspace_id: string;
    display_name: string;
    created_at: Date;
    staff_count: string;
    configuration_state: OperatorWorkspaceSummary['configurationState'];
    draft_version: string | null;
    active_release_id: string | null;
  }>('select * from identity_access.operator_workspace_catalog()');

  return result.rows.map((row) => ({
    workspaceId: row.workspace_id,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
    staffCount: Number(row.staff_count),
    configurationState: row.configuration_state,
    draftVersion: row.draft_version === null ? null : Number(row.draft_version),
    activeReleaseId: row.active_release_id,
  }));
}
