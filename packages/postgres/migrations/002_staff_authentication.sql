create table identity_access.staff_identities (
  staff_identity_id uuid primary key,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  display_name text not null check (length(trim(display_name)) > 0),
  email text not null,
  supabase_user_id uuid not null unique,
  status text not null check (status in ('active', 'disabled')),
  school_approver text not null check (length(trim(school_approver)) > 0),
  provisioning_reason text not null check (length(trim(provisioning_reason)) > 0),
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'school_administrative'),
  disposal_class text not null check (disposal_class = 'staff_identity'),
  unique (staff_identity_id, workspace_id),
  unique (workspace_id, email)
);

create table identity_access.staff_permission_grants (
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  staff_identity_id uuid not null,
  permission text not null check (permission in ('administrative', 'clinical')),
  granted_at timestamptz not null,
  grant_reason text not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'school_administrative'),
  disposal_class text not null check (disposal_class = 'staff_permission_grant'),
  primary key (staff_identity_id, permission),
  foreign key (staff_identity_id, workspace_id)
    references identity_access.staff_identities(staff_identity_id, workspace_id)
);

create table identity_access.staff_sessions (
  session_id uuid primary key,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  staff_identity_id uuid not null,
  session_handle_hash text not null unique,
  authentication_assurance text not null check (authentication_assurance = 'aal2'),
  authenticated_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'staff_session'),
  foreign key (staff_identity_id, workspace_id)
    references identity_access.staff_identities(staff_identity_id, workspace_id)
);

create table identity_access.staff_auth_flows (
  flow_id uuid primary key,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  staff_identity_id uuid not null,
  flow_handle_hash text not null unique,
  supabase_access_token text not null,
  factor_id text not null,
  challenge_id text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'staff_auth_flow'),
  foreign key (staff_identity_id, workspace_id)
    references identity_access.staff_identities(staff_identity_id, workspace_id)
);

-- Reads the caller's own permission grants as the table owner so RLS policies
-- can test Administrative Permission without recursive self-reference. The
-- grants table is enabled but not forced so the owner bypasses RLS inside
-- this function; the restricted runtime role never owns it.
create function identity_access.current_staff_has_permission(required_permission text)
returns boolean
language sql
security definer
stable
set search_path = identity_access
as $$
  select exists (
    select 1
    from staff_permission_grants grant_row
    where grant_row.staff_identity_id =
      nullif(current_setting('app.staff_identity_id', true), '')::uuid
      and grant_row.workspace_id =
        nullif(current_setting('app.workspace_id', true), '')::uuid
      and grant_row.permission = required_permission
  );
$$;

revoke execute on function identity_access.current_staff_has_permission(text) from public;

alter table identity_access.staff_identities enable row level security;
alter table identity_access.staff_permission_grants enable row level security;
alter table identity_access.staff_sessions enable row level security;
alter table identity_access.staff_auth_flows enable row level security;
alter table identity_access.staff_identities force row level security;
alter table identity_access.staff_sessions force row level security;
alter table identity_access.staff_auth_flows force row level security;

-- Staff Identities are visible to the identity itself, to holders of
-- Administrative Permission in the same School Workspace, and to the
-- server-side sign-in seam holding a freshly verified Supabase user link.
-- PostgreSQL independently denies every other read.
create policy staff_identities_scope on identity_access.staff_identities
  using (
    (
      workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
      and (
        staff_identity_id =
          nullif(current_setting('app.staff_identity_id', true), '')::uuid
        or identity_access.current_staff_has_permission('administrative')
      )
    )
    or supabase_user_id =
      nullif(current_setting('app.supabase_user_id', true), '')::uuid
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy staff_permission_grants_scope on identity_access.staff_permission_grants
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and (
      staff_identity_id =
        nullif(current_setting('app.staff_identity_id', true), '')::uuid
      or identity_access.current_staff_has_permission('administrative')
    )
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

-- Sessions and intermediate MFA flow state are reachable only through the
-- opaque handle hash the request presented; writes stay workspace-scoped.
create policy staff_sessions_handle_scope on identity_access.staff_sessions
  using (
    session_handle_hash =
      nullif(current_setting('app.session_handle_hash', true), '')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create policy staff_auth_flows_handle_scope on identity_access.staff_auth_flows
  using (
    flow_handle_hash =
      nullif(current_setting('app.flow_handle_hash', true), '')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
