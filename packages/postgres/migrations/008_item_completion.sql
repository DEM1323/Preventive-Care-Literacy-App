create schema if not exists learning_progress;

create table learning_progress.item_completions (
  item_completion_id uuid primary key,
  student_id uuid not null,
  workspace_id uuid not null,
  item_id uuid not null,
  item_revision_number integer not null check (item_revision_number > 0),
  school_configuration_release_id uuid not null,
  operation_id uuid not null,
  completed_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'item_completion'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (student_id, workspace_id, item_id, item_revision_number)
);

create table learning_progress.item_completion_receipts (
  workspace_id uuid not null,
  student_id uuid not null,
  operation_id uuid not null,
  command_name text not null,
  result jsonb not null,
  request_binding text not null,
  recorded_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'operation_receipt'),
  primary key (workspace_id, student_id, operation_id),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id)
);

create function learning_progress.reject_completion_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'item completions are immutable';
end;
$$;

create trigger item_completions_are_immutable
before update or delete on learning_progress.item_completions
for each row execute function learning_progress.reject_completion_mutation();

create trigger item_completion_receipts_are_immutable
before update or delete on learning_progress.item_completion_receipts
for each row execute function learning_progress.reject_completion_mutation();

alter table learning_progress.item_completions enable row level security;
alter table learning_progress.item_completion_receipts enable row level security;
alter table learning_progress.item_completions force row level security;
alter table learning_progress.item_completion_receipts force row level security;

create policy item_completions_student_scope on learning_progress.item_completions
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy item_completion_receipts_student_scope
  on learning_progress.item_completion_receipts
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
