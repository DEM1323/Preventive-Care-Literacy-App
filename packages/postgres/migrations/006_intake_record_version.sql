create schema if not exists intake;

create table intake.intake_drafts (
  student_id uuid not null,
  workspace_id uuid not null,
  school_configuration_release_id uuid not null,
  intake_form_resource_id uuid not null,
  intake_form_revision_number integer not null check (intake_form_revision_number > 0),
  locale text not null check (locale in ('en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT')),
  wrapping_key_id text not null,
  wrapped_data_key text not null,
  ciphertext text not null,
  updated_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'intake_draft'),
  primary key (student_id, workspace_id),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id)
);

create table intake.intake_record_versions (
  intake_record_version_id uuid primary key,
  student_id uuid not null,
  workspace_id uuid not null,
  version_number integer not null check (version_number > 0),
  school_configuration_release_id uuid not null,
  intake_form_resource_id uuid not null,
  intake_form_revision_number integer not null check (intake_form_revision_number > 0),
  submission_attestation_resource_id uuid not null,
  submission_attestation_revision_number integer not null
    check (submission_attestation_revision_number > 0),
  locale text not null check (locale in ('en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT')),
  wrapping_key_id text not null,
  wrapped_data_key text not null,
  ciphertext text not null,
  accepted_at timestamptz not null,
  superseded_at timestamptz,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'intake_record_version'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (student_id, version_number)
);

create unique index intake_record_versions_one_current
  on intake.intake_record_versions(student_id)
  where superseded_at is null;

create function intake.reject_version_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'intake record versions are immutable';
end;
$$;

create trigger intake_record_versions_are_immutable
before update or delete on intake.intake_record_versions
for each row execute function intake.reject_version_mutation();

alter table intake.intake_drafts enable row level security;
alter table intake.intake_record_versions enable row level security;
alter table intake.intake_drafts force row level security;
alter table intake.intake_record_versions force row level security;

create policy intake_drafts_student_scope on intake.intake_drafts
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy intake_record_versions_student_scope on intake.intake_record_versions
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  with check (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    and workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy configuration_states_student_read
  on school_configuration.configuration_states
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and nullif(current_setting('app.student_id', true), '') is not null
  );

create policy configuration_releases_student_active_read
  on school_configuration.configuration_releases
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and nullif(current_setting('app.student_id', true), '') is not null
    and exists (
      select 1 from school_configuration.configuration_states state
       where state.workspace_id = configuration_releases.workspace_id
         and state.active_release_id = configuration_releases.release_id
    )
  );

create policy release_components_student_active_read
  on school_configuration.release_components
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and nullif(current_setting('app.student_id', true), '') is not null
    and exists (
      select 1 from school_configuration.configuration_states state
       where state.workspace_id = release_components.workspace_id
         and state.active_release_id = release_components.release_id
    )
  );

create policy authored_revisions_student_active_read
  on school_configuration.authored_revisions
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and nullif(current_setting('app.student_id', true), '') is not null
    and lifecycle = 'frozen'
    and exists (
      select 1
        from school_configuration.release_components component
        join school_configuration.configuration_states state
          on state.workspace_id = component.workspace_id
         and state.active_release_id = component.release_id
       where component.workspace_id = authored_revisions.workspace_id
         and component.resource_id = authored_revisions.resource_id
         and component.revision_number = authored_revisions.revision_number
    )
  );
