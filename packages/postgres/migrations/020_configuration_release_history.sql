create table school_configuration.release_assemblies (
  release_id uuid primary key
    references school_configuration.configuration_releases(release_id),
  workspace_id uuid not null
    references identity_access.school_workspaces(workspace_id),
  candidate jsonb not null,
  recorded_at timestamptz not null,
  unique (release_id, workspace_id)
);

create trigger release_assemblies_are_immutable
before update or delete on school_configuration.release_assemblies
for each row execute function school_configuration.reject_immutable_mutation();

alter table school_configuration.release_assemblies enable row level security;
alter table school_configuration.release_assemblies force row level security;

create policy release_assemblies_administrator_scope
  on school_configuration.release_assemblies
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

insert into school_configuration.release_assemblies
  (release_id, workspace_id, candidate, recorded_at)
select release.release_id,
       release.workspace_id,
       draft.candidate,
       release.published_at
  from school_configuration.configuration_releases release
  join school_configuration.draft_candidates draft
    on draft.workspace_id = release.workspace_id
   and draft.candidate_fingerprint = release.candidate_fingerprint
 where not exists (
   select 1
     from school_configuration.release_assemblies assembly
    where assembly.release_id = release.release_id
 );
