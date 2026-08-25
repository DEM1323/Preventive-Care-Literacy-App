-- Clinical directory and current Intake Record reveal: PostgreSQL independently
-- allows School Nurses with Clinical Permission to locate Students and read
-- sealed current versions in their School Workspace. Application-layer
-- decryption stays outside this policy.

drop policy students_scope on identity_access.students;

create policy students_scope on identity_access.students
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    or (
      workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
      and identity_access.current_staff_has_permission('clinical')
    )
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy intake_record_versions_clinical_read
  on intake.intake_record_versions
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('clinical')
  );

create policy authored_revisions_clinical_read
  on school_configuration.authored_revisions
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('clinical')
    and lifecycle = 'frozen'
    and exists (
      select 1
        from intake.intake_record_versions version
       where version.workspace_id = authored_revisions.workspace_id
         and version.superseded_at is null
         and (
           (
             version.intake_form_resource_id = authored_revisions.resource_id
             and version.intake_form_revision_number =
               authored_revisions.revision_number
           )
           or (
             version.submission_attestation_resource_id =
               authored_revisions.resource_id
             and version.submission_attestation_revision_number =
               authored_revisions.revision_number
           )
         )
    )
  );
