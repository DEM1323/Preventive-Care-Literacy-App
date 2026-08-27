create function learning_progress.prior_release_items(
  p_workspace_id uuid,
  p_current_release_id uuid
)
returns table (item_id uuid, revision_number integer)
language sql
stable
security definer
set search_path = ''
as $$
  with current_release as (
    select release.release_number
      from school_configuration.configuration_releases release
     where release.workspace_id = p_workspace_id
       and release.release_id = p_current_release_id
  ),
  prior as (
    select assembly.candidate
      from school_configuration.configuration_releases release
      join school_configuration.release_assemblies assembly
        on assembly.release_id = release.release_id
     where release.workspace_id = p_workspace_id
       and release.release_number = (
         select max(previous.release_number)
           from school_configuration.configuration_releases previous
          where previous.workspace_id = p_workspace_id
            and previous.release_number <
              (select current_release.release_number from current_release)
       )
  )
  select distinct (item.value->>'id')::uuid,
         (item.value->>'revision')::integer
    from prior
    cross join lateral jsonb_array_elements(
      coalesce(prior.candidate #> '{release,modules}', '[]'::jsonb)
    ) as module(value)
    cross join lateral (
      select jsonb_array_elements(
        coalesce(module.value->'knowledgeItems', '[]'::jsonb)
      )
      union all
      select jsonb_array_elements(
        coalesce(module.value->'skillItems', '[]'::jsonb)
      )
      union all
      select jsonb_array_elements(
        coalesce(module.value->'applicationItems', '[]'::jsonb)
      )
    ) as item(value)
   where p_workspace_id =
           nullif(current_setting('app.workspace_id', true), '')::uuid
     and nullif(current_setting('app.student_id', true), '') is not null
     and item.value->>'id' is not null
     and (item.value->>'revision') ~ '^[0-9]+$';
$$;

revoke all on function learning_progress.prior_release_items(uuid, uuid)
  from public;
