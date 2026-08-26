import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date, never>;
type MutableTimestamp = ColumnType<Date, Date, Date>;

export type Database = {
  'identity_access.classes': {
    class_id: string;
    workspace_id: string;
    name: string;
    created_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'identity_access.invitations': {
    invitation_id: string;
    workspace_id: string;
    class_id: string;
    purpose: string;
    recipient_digest: string;
    current_generation: number;
    status: string;
    created_at: Timestamp;
    authorization_expires_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'identity_access.invitation_challenges': {
    invitation_id: string;
    generation: number;
    purpose: string;
    code_digest: string;
    lookup_digest: ColumnType<string | null, string | null, string | null>;
    expires_at: Timestamp;
    completed_at: ColumnType<Date | null, Date | null, Date | null>;
    failed_attempts: number;
  };
  'identity_access.invitation_deliveries': {
    invitation_id: string;
    generation: number;
    key_id: string;
    ciphertext: string;
    status: string;
    provider_idempotency_key: string;
    provider_message_id: ColumnType<
      string | null,
      string | null,
      string | null
    >;
    delivered_at: ColumnType<Date | null, Date | null, Date | null>;
  };
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
    last_seen_at: MutableTimestamp;
    idle_expires_at: MutableTimestamp;
    expires_at: Timestamp;
    revoked_at: ColumnType<Date | null, Date | null, Date | null>;
    created_at: Timestamp;
    record_owner: string;
    record_classification: string;
    disposal_class: string;
  };
  'identity_access.staff_session_freshness': {
    session_id: string;
    workspace_id: string;
    staff_identity_id: string;
    refreshed_at: MutableTimestamp;
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
    request_fingerprint: ColumnType<
      string | null,
      string | null | undefined,
      string | null
    >;
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
    details: ColumnType<
      unknown | null,
      unknown | null | undefined,
      unknown | null
    >;
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
  'school_configuration.configuration_states': {
    workspace_id: string;
    draft_version: ColumnType<number, number | undefined, number>;
    active_release_id: ColumnType<
      string | null,
      string | null | undefined,
      string | null
    >;
    next_release_number: ColumnType<number, number | undefined, number>;
  };
  'school_configuration.authored_resources': {
    workspace_id: string;
    resource_id: string;
    resource_kind: string;
    archived_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  };
  'school_configuration.authored_revisions': {
    workspace_id: string;
    resource_id: string;
    revision_number: number;
    lifecycle: string;
    payload_schema_version: number;
    payload: unknown;
    predecessor_revision_number: ColumnType<
      number | null,
      number | null | undefined,
      number | null
    >;
    authored_by: string;
    authored_at: Timestamp;
  };
  'school_configuration.draft_candidates': {
    workspace_id: string;
    candidate: unknown;
    candidate_fingerprint: string;
    updated_by: string;
    updated_at: Timestamp;
  };
  'school_configuration.draft_components': {
    workspace_id: string;
    resource_id: string;
    revision_number: number;
    slot: string;
    position: ColumnType<
      number | null,
      number | null | undefined,
      number | null
    >;
  };
  'school_configuration.publication_attempts': {
    workspace_id: string;
    operation_id: string;
    request_fingerprint: string;
    proposed_release_id: string;
    status: string;
    result: ColumnType<
      unknown | null,
      unknown | null | undefined,
      unknown | null
    >;
    created_at: Timestamp;
    updated_at: Timestamp;
  };
  'school_configuration.configuration_releases': {
    release_id: string;
    workspace_id: string;
    release_number: number;
    candidate_fingerprint: string;
    candidate_fingerprint_algorithm: string;
    change_description: string;
    published_by: string;
    published_at: Timestamp;
  };
  'school_configuration.release_components': {
    release_id: string;
    workspace_id: string;
    resource_id: string;
    revision_number: number;
    slot: string;
    position: ColumnType<
      number | null,
      number | null | undefined,
      number | null
    >;
  };
  'school_configuration.release_packages': {
    release_id: string;
    workspace_id: string;
    package_format: string;
    minimum_client_contract_version: number;
    candidate_fingerprint: string;
    package_digest: string;
    bucket: string;
    object_key: string;
    media_type: string;
    canonical_byte_length: number;
    operation_id: string;
    created_at: Timestamp;
  };
};
