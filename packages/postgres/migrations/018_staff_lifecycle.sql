drop function identity_access.operator_workspace_catalog();

create function identity_access.operator_workspace_catalog()
returns table (
  workspace_id uuid,
  display_name text,
  created_at timestamptz,
  staff_count bigint,
  configuration_state text,
  draft_version bigint,
  active_release_id uuid,
  staff_identities jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    workspace.workspace_id,
    workspace.display_name,
    workspace.created_at,
    (
      select count(*)
      from identity_access.staff_identities staff
      where staff.workspace_id = workspace.workspace_id
    ) as staff_count,
    case
      when configuration.workspace_id is null then 'uninitialized'
      when configuration.active_release_id is not null then 'active'
      else 'draft'
    end as configuration_state,
    configuration.draft_version,
    configuration.active_release_id,
    coalesce((
      select jsonb_agg(staff_row.staff_identity order by staff_row.created_at, staff_row.staff_identity_id)
      from (
        select
          staff.staff_identity_id,
          staff.created_at,
          jsonb_build_object(
            'staffIdentityId', staff.staff_identity_id,
            'displayName', staff.display_name,
            'email', staff.email,
            'permissions', coalesce((
              select jsonb_agg(grant_row.permission order by grant_row.permission)
              from identity_access.staff_permission_grants grant_row
              where grant_row.staff_identity_id = staff.staff_identity_id
            ), '[]'::jsonb),
            'status', staff.status,
            'createdAt', staff.created_at,
            'activatedAt', (
              select min(session.authenticated_at)
              from identity_access.staff_sessions session
              where session.staff_identity_id = staff.staff_identity_id
            )
          ) as staff_identity
        from identity_access.staff_identities staff
        where staff.workspace_id = workspace.workspace_id
      ) staff_row
    ), '[]'::jsonb) as staff_identities
  from identity_access.school_workspaces workspace
  left join school_configuration.configuration_states configuration
    on configuration.workspace_id = workspace.workspace_id
  order by workspace.created_at desc, workspace.workspace_id
  limit 500;
$$;

revoke all on function identity_access.operator_workspace_catalog() from public;

create function identity_access.read_staff_identity(
  p_workspace_id uuid,
  p_staff_identity_id uuid
)
returns table (
  status text,
  supabase_user_id uuid,
  display_name text,
  email text,
  permissions text[]
)
language sql
stable
security definer
set search_path = identity_access
as $$
  select
    identity.status,
    identity.supabase_user_id,
    identity.display_name,
    identity.email,
    coalesce((
      select array_agg(grant_row.permission order by grant_row.permission)
      from staff_permission_grants grant_row
      where grant_row.staff_identity_id = identity.staff_identity_id
    ), array[]::text[])
  from staff_identities identity
  where identity.workspace_id = p_workspace_id
    and identity.staff_identity_id = p_staff_identity_id
$$;

revoke all on function identity_access.read_staff_identity(uuid, uuid) from public;

create function identity_access.apply_staff_lifecycle(
  p_workspace_id uuid,
  p_staff_identity_id uuid,
  p_change text,
  p_permissions text[],
  p_at timestamptz
)
returns table (
  outcome text,
  revoked_session_count integer,
  status text,
  permissions text[],
  supabase_user_id uuid,
  display_name text,
  email text
)
language plpgsql
security definer
set search_path = identity_access, pg_temp
as $$
declare
  v_status text;
  v_display_name text;
  v_email text;
  v_supabase_user_id uuid;
  v_permissions text[];
  v_remaining_admins integer;
  v_holds_admin boolean;
  v_will_hold_admin boolean;
  v_revoked integer := 0;
begin
  if p_change not in ('disable', 'replace_permissions', 'revoke_sessions') then
    raise exception 'unknown staff lifecycle change';
  end if;

  perform set_config('app.workspace_id', p_workspace_id::text, true);
  perform set_config('app.staff_identity_id', p_staff_identity_id::text, true);

  select identity.status, identity.display_name, identity.email,
         identity.supabase_user_id
    into v_status, v_display_name, v_email, v_supabase_user_id
    from staff_identities identity
   where identity.staff_identity_id = p_staff_identity_id
     and identity.workspace_id = p_workspace_id
   for update of identity;
  if v_status is null then
    outcome := 'not_found';
    revoked_session_count := 0;
    return next;
    return;
  end if;

  perform 1
    from staff_permission_grants grant_row
   where grant_row.staff_identity_id = p_staff_identity_id
     and grant_row.workspace_id = p_workspace_id
   for update of grant_row;
  select coalesce(array_agg(grant_row.permission order by grant_row.permission), array[]::text[])
    into v_permissions
    from staff_permission_grants grant_row
   where grant_row.staff_identity_id = p_staff_identity_id
     and grant_row.workspace_id = p_workspace_id;
  perform 1
    from staff_sessions session
   where session.staff_identity_id = p_staff_identity_id
     and session.workspace_id = p_workspace_id
   for update of session;

  v_holds_admin := 'administrative' = any(v_permissions);
  v_will_hold_admin := case
    when p_change = 'replace_permissions' then 'administrative' = any(p_permissions)
    when p_change = 'disable' then false
    else v_holds_admin
  end;

  if v_status = 'active' and v_holds_admin and not v_will_hold_admin then
    select count(*)::integer
      into v_remaining_admins
      from staff_identities identity
      join staff_permission_grants grant_row
        on grant_row.staff_identity_id = identity.staff_identity_id
       and grant_row.permission = 'administrative'
     where identity.workspace_id = p_workspace_id
       and identity.status = 'active'
       and identity.staff_identity_id <> p_staff_identity_id;
    if v_remaining_admins = 0 then
      outcome := 'last_administrator';
      revoked_session_count := 0;
      status := v_status;
      permissions := v_permissions;
      supabase_user_id := v_supabase_user_id;
      display_name := v_display_name;
      email := v_email;
      return next;
      return;
    end if;
  end if;

  if p_change = 'disable' then
    update staff_identities
       set status = 'disabled'
     where staff_identities.staff_identity_id = p_staff_identity_id
       and staff_identities.workspace_id = p_workspace_id
       and staff_identities.status = 'active';
    v_status := 'disabled';
  elsif p_change = 'replace_permissions' then
    delete from staff_permission_grants
     where staff_identity_id = p_staff_identity_id
       and workspace_id = p_workspace_id;
    if p_permissions is not null then
      insert into staff_permission_grants (
        workspace_id, staff_identity_id, permission, granted_at, grant_reason,
        record_owner, record_classification, disposal_class
      )
      select p_workspace_id, p_staff_identity_id, permission, p_at,
             'staff permission replacement',
             'school', 'school_administrative', 'staff_permission_grant'
        from unnest(p_permissions) as permission;
    end if;
    select coalesce(array_agg(grant_row.permission order by grant_row.permission), array[]::text[])
      into v_permissions
      from staff_permission_grants grant_row
     where grant_row.staff_identity_id = p_staff_identity_id
       and grant_row.workspace_id = p_workspace_id;
  end if;

  update staff_sessions
     set revoked_at = p_at
   where staff_identity_id = p_staff_identity_id
     and workspace_id = p_workspace_id
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  outcome := 'applied';
  revoked_session_count := v_revoked;
  status := v_status;
  permissions := v_permissions;
  supabase_user_id := v_supabase_user_id;
  display_name := v_display_name;
  email := v_email;
  return next;
end;
$$;

revoke all on function identity_access.apply_staff_lifecycle(uuid, uuid, text, text[], timestamptz)
  from public;
