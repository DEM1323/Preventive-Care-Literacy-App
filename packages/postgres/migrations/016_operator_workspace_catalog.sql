create function identity_access.operator_workspace_catalog()
returns table (
  workspace_id uuid,
  display_name text,
  created_at timestamptz,
  staff_count bigint,
  configuration_state text,
  draft_version bigint,
  active_release_id uuid
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
    configuration.active_release_id
  from identity_access.school_workspaces workspace
  left join school_configuration.configuration_states configuration
    on configuration.workspace_id = workspace.workspace_id
  order by workspace.created_at desc, workspace.workspace_id
  limit 500;
$$;

revoke all on function identity_access.operator_workspace_catalog() from public;
