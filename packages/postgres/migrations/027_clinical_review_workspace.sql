-- Complete the School Nurse workspace: Class-aware non-clinical directory
-- metadata, historical Intake Record Version reveal against frozen source
-- revisions, and independent selection evidence.

create policy class_memberships_clinical_read
  on identity_access.class_memberships
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('clinical')
  );

create policy classes_clinical_read
  on identity_access.classes
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('clinical')
  );

drop policy authored_revisions_clinical_read
  on school_configuration.authored_revisions;

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
