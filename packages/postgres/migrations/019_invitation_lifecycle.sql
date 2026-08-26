alter table identity_access.classes
  add column status text not null default 'open',
  add column closed_at timestamptz,
  add column closed_by uuid;

alter table identity_access.classes
  add constraint classes_status_check
  check (status in ('open', 'closed'));

alter table identity_access.classes
  add constraint classes_closed_state_check
  check (
    (status = 'open' and closed_at is null and closed_by is null)
    or (status = 'closed' and closed_at is not null)
  );

create policy class_memberships_administration_scope
  on identity_access.class_memberships
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy verified_email_addresses_administration_scope
  on identity_access.verified_email_addresses
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );
