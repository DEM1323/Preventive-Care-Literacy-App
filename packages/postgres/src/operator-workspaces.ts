import type { Pool } from 'pg';
import type { StaffPermission } from '../../../modules/identity-access/index.ts';

export type OperatorStaffIdentitySummary = {
  staffIdentityId: string;
  displayName: string;
  email: string;
  permissions: StaffPermission[];
  status: 'active' | 'disabled';
  createdAt: string;
  activatedAt: string | null;
};

export type OperatorWorkspaceSummary = {
  workspaceId: string;
  displayName: string;
  createdAt: string;
  staffCount: number;
  configurationState: 'uninitialized' | 'draft' | 'active';
  draftVersion: number | null;
  activeReleaseId: string | null;
  staffIdentities: OperatorStaffIdentitySummary[];
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
    staff_identities: OperatorStaffIdentitySummary[] | string;
  }>('select * from identity_access.operator_workspace_catalog()');

  return result.rows.map((row) => ({
    workspaceId: row.workspace_id,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
    staffCount: Number(row.staff_count),
    configurationState: row.configuration_state,
    draftVersion: row.draft_version === null ? null : Number(row.draft_version),
    activeReleaseId: row.active_release_id,
    staffIdentities: (typeof row.staff_identities === 'string'
      ? (JSON.parse(row.staff_identities) as OperatorStaffIdentitySummary[])
      : row.staff_identities
    ).map((staff) => ({
      staffIdentityId: staff.staffIdentityId,
      displayName: staff.displayName,
      email: staff.email,
      permissions: staff.permissions,
      status: staff.status,
      createdAt: new Date(staff.createdAt).toISOString(),
      activatedAt: staff.activatedAt
        ? new Date(staff.activatedAt).toISOString()
        : null,
    })),
  }));
}
