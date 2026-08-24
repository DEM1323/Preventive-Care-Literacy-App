import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date, never>;

export type Database = {
  'identity_access.school_workspaces': {
    workspace_id: string;
    display_name: string;
    created_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'identity_access.staff_identities': {
    staff_identity_id: string;
    workspace_id: string;
    display_name: string;
    email: string;
    supabase_user_id: string;
    status: string;
    school_approver: string;
    provisioning_reason: string;
    created_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'identity_access.staff_permission_grants': {
    workspace_id: string;
    staff_identity_id: string;
    permission: string;
    granted_at: Timestamp;
    grant_reason: string;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'identity_access.staff_sessions': {
    session_id: string;
    workspace_id: string;
    staff_identity_id: string;
    session_handle_hash: string;
    authentication_assurance: string;
    authenticated_at: Timestamp;
    expires_at: Timestamp;
    revoked_at: ColumnType<Date | null, Date | null, Date | null>;
    created_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'identity_access.staff_auth_flows': {
    flow_id: string;
    workspace_id: string;
    staff_identity_id: string;
    flow_handle_hash: string;
    supabase_access_token: string;
    factor_id: string;
    challenge_id: string;
    expires_at: Timestamp;
    consumed_at: ColumnType<Date | null, Date | null, Date | null>;
    created_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'infrastructure.operation_receipts': {
    workspace_id: string;
    operation_id: string;
    command_name: string;
    result: unknown;
    recorded_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'audit.evidence': {
    sequence: Generated<number>;
    audit_id: string;
    workspace_id: string;
    operation_id: string;
    event_type: string;
    actor_type: string;
    actor_id: string;
    occurred_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'infrastructure.outbox': {
    sequence: Generated<number>;
    outbox_id: string;
    workspace_id: string;
    operation_id: string;
    topic: string;
    payload: unknown;
    status: string;
    recorded_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
};
