create table intake.intake_operation_receipts (
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

alter table intake.intake_operation_receipts enable row level security;
alter table intake.intake_operation_receipts force row level security;

create policy intake_operation_receipts_student_scope
  on intake.intake_operation_receipts
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
