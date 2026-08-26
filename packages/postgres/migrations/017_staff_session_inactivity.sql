alter table identity_access.staff_sessions
  add column last_seen_at timestamptz,
  add column idle_expires_at timestamptz;

update identity_access.staff_sessions
   set last_seen_at = authenticated_at,
       idle_expires_at = least(
         authenticated_at + interval '15 minutes',
         expires_at
       )
 where last_seen_at is null;

alter table identity_access.staff_sessions
  alter column last_seen_at set not null,
  alter column idle_expires_at set not null;

drop function identity_access.lock_clinical_reveal_authority(text);

create function identity_access.lock_clinical_reveal_authority(
  p_session_handle_hash text
)
returns table (
  session_id uuid,
  workspace_id uuid,
  staff_identity_id uuid,
  authenticated_at timestamptz,
  expires_at timestamptz,
  idle_expires_at timestamptz,
  revoked_at timestamptz,
  identity_status text,
  authentication_fresh_at timestamptz,
  has_clinical_permission boolean,
  workspace_found boolean
)
language plpgsql
security definer
set search_path = identity_access, pg_temp
as $$
declare
  v_session_id uuid;
  v_workspace_id uuid;
  v_staff_identity_id uuid;
  v_authenticated_at timestamptz;
  v_expires_at timestamptz;
  v_idle_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_identity_status text;
  v_authentication_fresh_at timestamptz;
  v_has_clinical_permission boolean;
  v_workspace_found boolean;
begin
  select session.session_id, session.workspace_id, session.staff_identity_id
    into v_session_id, v_workspace_id, v_staff_identity_id
    from staff_sessions session
   where session.session_handle_hash = p_session_handle_hash;
  if v_session_id is null then
    return;
  end if;

  perform set_config('app.workspace_id', v_workspace_id::text, true);
  perform set_config('app.staff_identity_id', v_staff_identity_id::text, true);

  select identity.status
    into v_identity_status
    from staff_identities identity
   where identity.staff_identity_id = v_staff_identity_id
   for share of identity;

  select true
    into v_has_clinical_permission
    from staff_permission_grants grant_row
   where grant_row.staff_identity_id = v_staff_identity_id
     and grant_row.permission = 'clinical'
   for share of grant_row;
  v_has_clinical_permission := coalesce(v_has_clinical_permission, false);

  select session.session_id, session.workspace_id, session.staff_identity_id,
         session.authenticated_at, session.expires_at, session.idle_expires_at,
         session.revoked_at
    into v_session_id, v_workspace_id, v_staff_identity_id,
         v_authenticated_at, v_expires_at, v_idle_expires_at, v_revoked_at
    from staff_sessions session
   where session.session_id = v_session_id
     and session.session_handle_hash = p_session_handle_hash
   for share of session;
  if v_session_id is null then
    return;
  end if;

  select true
    into v_workspace_found
    from school_workspaces workspace
   where workspace.workspace_id = v_workspace_id
   for share of workspace;
  v_workspace_found := coalesce(v_workspace_found, false);

  select coalesce(freshness.refreshed_at, v_authenticated_at)
    into v_authentication_fresh_at
    from staff_identities identity
    left join staff_session_freshness freshness
      on freshness.session_id = v_session_id
   where identity.staff_identity_id = v_staff_identity_id;

  session_id := v_session_id;
  workspace_id := v_workspace_id;
  staff_identity_id := v_staff_identity_id;
  authenticated_at := v_authenticated_at;
  expires_at := v_expires_at;
  idle_expires_at := v_idle_expires_at;
  revoked_at := v_revoked_at;
  identity_status := v_identity_status;
  authentication_fresh_at := v_authentication_fresh_at;
  has_clinical_permission := v_has_clinical_permission;
  workspace_found := v_workspace_found;
  return next;
end;
$$;

revoke all on function identity_access.lock_clinical_reveal_authority(text)
  from public;

-- Runtime provisioning is workspace-scoped but is not a Staff Identity, so it
-- cannot count identities through forced RLS. The table owner counts them.
create function identity_access.workspace_staff_count()
returns bigint
language sql
stable
security definer
set search_path = identity_access
as $$
  select count(*)
    from staff_identities
   where workspace_id =
     nullif(current_setting('app.workspace_id', true), '')::uuid
$$;

revoke all on function identity_access.workspace_staff_count() from public;
