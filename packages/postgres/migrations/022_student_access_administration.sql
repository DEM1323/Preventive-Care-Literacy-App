create policy students_administration_scope
  on identity_access.students
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy student_sessions_administration_scope
  on identity_access.student_sessions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy sign_in_challenges_administration_scope
  on identity_access.sign_in_challenges
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy sign_in_challenge_codes_administration_scope
  on identity_access.sign_in_challenge_codes
  using (
    exists (
      select 1 from identity_access.sign_in_challenges challenge
       where challenge.sign_in_challenge_id = sign_in_challenge_codes.sign_in_challenge_id
         and challenge.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
         and identity_access.current_staff_has_permission('administrative')
    )
  )
  with check (
    exists (
      select 1 from identity_access.sign_in_challenges challenge
       where challenge.sign_in_challenge_id = sign_in_challenge_codes.sign_in_challenge_id
         and challenge.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
         and identity_access.current_staff_has_permission('administrative')
    )
  );
