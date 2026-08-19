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
