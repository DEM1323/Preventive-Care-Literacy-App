create schema if not exists identity_access;
create schema if not exists audit;
create schema if not exists infrastructure;

create table identity_access.school_workspaces (
  workspace_id uuid primary key,
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'school_administrative'),
  disposal_class text not null check (disposal_class = 'school_workspace')
);

create table infrastructure.operation_receipts (
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  operation_id uuid not null,
  command_name text not null,
  result jsonb not null,
  recorded_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'operation_receipt'),
  primary key (workspace_id, operation_id)
);

create table audit.evidence (
  sequence bigint generated always as identity primary key,
  audit_id uuid not null unique,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  operation_id uuid not null,
  event_type text not null,
  actor_type text not null,
  actor_id text not null,
  occurred_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'audit_evidence'),
  disposal_class text not null check (disposal_class = 'workspace_audit_evidence')
);

create table infrastructure.outbox (
  sequence bigint generated always as identity primary key,
  outbox_id uuid not null unique,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  operation_id uuid not null,
  topic text not null,
  payload jsonb not null,
  status text not null check (status in ('pending', 'enqueued', 'completed', 'failed')),
  recorded_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'transactional_outbox')
);

alter table identity_access.school_workspaces enable row level security;
alter table infrastructure.operation_receipts enable row level security;
alter table audit.evidence enable row level security;
alter table infrastructure.outbox enable row level security;
alter table identity_access.school_workspaces force row level security;
alter table infrastructure.operation_receipts force row level security;
alter table audit.evidence force row level security;
alter table infrastructure.outbox force row level security;

create policy school_workspaces_workspace_scope on identity_access.school_workspaces
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy operation_receipts_workspace_scope on infrastructure.operation_receipts
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy audit_evidence_workspace_scope on audit.evidence
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
create policy outbox_workspace_scope on infrastructure.outbox
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create function audit.reject_evidence_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit evidence is append-only';
end;
$$;

create trigger evidence_is_append_only
before update or delete on audit.evidence
for each row execute function audit.reject_evidence_mutation();
