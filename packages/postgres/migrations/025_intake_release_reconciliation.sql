alter table intake.intake_drafts
  add column review_field_ids uuid[] not null default '{}';

create policy authored_revisions_student_own_intake_read
  on school_configuration.authored_revisions
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and nullif(current_setting('app.student_id', true), '') is not null
    and lifecycle = 'frozen'
    and (
      exists (
        select 1
          from intake.intake_drafts draft
         where draft.workspace_id = authored_revisions.workspace_id
           and draft.student_id =
             nullif(current_setting('app.student_id', true), '')::uuid
           and draft.intake_form_resource_id = authored_revisions.resource_id
           and draft.intake_form_revision_number =
             authored_revisions.revision_number
      )
      or exists (
        select 1
          from intake.intake_record_versions version
         where version.workspace_id = authored_revisions.workspace_id
           and version.student_id =
             nullif(current_setting('app.student_id', true), '')::uuid
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
    )
  );

create policy configuration_states_clinical_read
  on school_configuration.configuration_states
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('clinical')
  );

create policy configuration_releases_clinical_active_read
  on school_configuration.configuration_releases
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('clinical')
    and exists (
      select 1 from school_configuration.configuration_states state
       where state.workspace_id = configuration_releases.workspace_id
         and state.active_release_id = configuration_releases.release_id
    )
  );

create policy release_components_clinical_active_read
  on school_configuration.release_components
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('clinical')
    and exists (
      select 1 from school_configuration.configuration_states state
       where state.workspace_id = release_components.workspace_id
         and state.active_release_id = release_components.release_id
    )
  );

create policy authored_revisions_clinical_active_read
  on school_configuration.authored_revisions
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('clinical')
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
