create schema if not exists school_configuration;

alter table infrastructure.operation_receipts
  add column request_fingerprint text;
alter table audit.evidence add column details jsonb;

create table identity_access.staff_session_freshness (
  session_id uuid primary key references identity_access.staff_sessions(session_id),
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  staff_identity_id uuid not null,
  refreshed_at timestamptz not null,
  foreign key (staff_identity_id, workspace_id)
    references identity_access.staff_identities(staff_identity_id, workspace_id)
);

create table school_configuration.configuration_states (
  workspace_id uuid primary key references identity_access.school_workspaces(workspace_id),
  draft_version bigint not null default 0 check (draft_version >= 0),
  active_release_id uuid,
  next_release_number bigint not null default 1 check (next_release_number > 0)
);

create table school_configuration.authored_resources (
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  resource_id uuid not null,
  resource_kind text not null,
  archived_at timestamptz,
  primary key (workspace_id, resource_id)
);

create table school_configuration.authored_revisions (
  workspace_id uuid not null,
  resource_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  lifecycle text not null check (lifecycle in ('working', 'frozen')),
  payload_schema_version integer not null check (payload_schema_version > 0),
  payload jsonb not null,
  predecessor_revision_number integer,
  authored_by uuid not null,
  authored_at timestamptz not null,
  primary key (workspace_id, resource_id, revision_number),
  foreign key (workspace_id, resource_id)
    references school_configuration.authored_resources(workspace_id, resource_id),
  foreign key (workspace_id, resource_id, predecessor_revision_number)
    references school_configuration.authored_revisions(workspace_id, resource_id, revision_number)
);

create unique index authored_revisions_one_working
  on school_configuration.authored_revisions(workspace_id, resource_id)
  where lifecycle = 'working';

create table school_configuration.draft_candidates (
  workspace_id uuid primary key references identity_access.school_workspaces(workspace_id),
  candidate jsonb not null,
  candidate_fingerprint text not null,
  updated_by uuid not null,
  updated_at timestamptz not null
);

create table school_configuration.draft_components (
  workspace_id uuid not null,
  resource_id uuid not null,
  revision_number integer not null,
  slot text not null,
  position integer check (position is null or position > 0),
  primary key (workspace_id, resource_id, revision_number),
  foreign key (workspace_id, resource_id, revision_number)
    references school_configuration.authored_revisions(workspace_id, resource_id, revision_number)
);

create table school_configuration.managed_translation_reviews (
  workspace_id uuid not null,
  source_resource_id uuid not null,
  source_revision_number integer not null,
  translation_resource_id uuid not null,
  translation_revision_number integer not null,
  locale text not null check (locale in ('es-US', 'pt-BR', 'fr-CA', 'ht-HT')),
  review_provenance_id uuid not null,
  reviewer text not null,
  reviewed_at timestamptz not null,
  primary key (
    workspace_id, source_resource_id, source_revision_number,
    translation_resource_id, translation_revision_number
  ),
  foreign key (workspace_id, source_resource_id, source_revision_number)
    references school_configuration.authored_revisions(workspace_id, resource_id, revision_number),
  foreign key (workspace_id, translation_resource_id, translation_revision_number)
    references school_configuration.authored_revisions(workspace_id, resource_id, revision_number)
);

create table school_configuration.publication_attempts (
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  operation_id uuid not null,
  request_fingerprint text not null,
  proposed_release_id uuid not null,
  status text not null check (status in ('preparing', 'succeeded', 'failed')),
  result jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (workspace_id, operation_id)
);

create table school_configuration.configuration_releases (
  release_id uuid primary key,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  release_number bigint not null check (release_number > 0),
  candidate_fingerprint text not null,
  candidate_fingerprint_algorithm text not null
    check (candidate_fingerprint_algorithm = 'school-configuration-candidate/v1'),
  change_description text not null check (length(trim(change_description)) > 0),
  published_by uuid not null,
  published_at timestamptz not null,
  unique (workspace_id, release_number),
  unique (release_id, workspace_id)
);

alter table school_configuration.configuration_states
  add constraint configuration_states_active_release_fkey
  foreign key (active_release_id, workspace_id)
  references school_configuration.configuration_releases(release_id, workspace_id);

create table school_configuration.release_components (
  release_id uuid not null references school_configuration.configuration_releases(release_id),
  workspace_id uuid not null,
  resource_id uuid not null,
  revision_number integer not null,
  slot text not null,
  position integer check (position is null or position > 0),
  primary key (release_id, resource_id, revision_number),
  foreign key (workspace_id, resource_id, revision_number)
    references school_configuration.authored_revisions(workspace_id, resource_id, revision_number)
);

create table school_configuration.release_packages (
  release_id uuid primary key references school_configuration.configuration_releases(release_id),
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  package_format text not null check (package_format = 'school-configuration-package/v1'),
  minimum_client_contract_version integer not null check (minimum_client_contract_version > 0),
  candidate_fingerprint text not null,
  package_digest text not null check (package_digest ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket = 'school-configuration-releases'),
  object_key text not null,
  media_type text not null check (media_type = 'application/json'),
  canonical_byte_length bigint not null check (canonical_byte_length > 0),
  operation_id uuid not null,
  created_at timestamptz not null,
  unique (workspace_id, package_digest),
  unique (bucket, object_key)
);

create function school_configuration.reject_immutable_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'published School Configuration records are immutable';
end;
$$;

create trigger configuration_releases_are_immutable
before update or delete on school_configuration.configuration_releases
for each row execute function school_configuration.reject_immutable_mutation();
create trigger release_components_are_immutable
before update or delete on school_configuration.release_components
for each row execute function school_configuration.reject_immutable_mutation();
create trigger release_packages_are_immutable
before update or delete on school_configuration.release_packages
for each row execute function school_configuration.reject_immutable_mutation();
create trigger managed_translation_reviews_are_immutable
before update or delete on school_configuration.managed_translation_reviews
for each row execute function school_configuration.reject_immutable_mutation();

create function school_configuration.reject_frozen_revision_mutation() returns trigger
language plpgsql as $$
begin
  if old.lifecycle = 'frozen' then
    raise exception 'frozen School Configuration revisions are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger frozen_revisions_are_immutable
before update or delete on school_configuration.authored_revisions
for each row execute function school_configuration.reject_frozen_revision_mutation();

alter table identity_access.staff_session_freshness enable row level security;
alter table identity_access.staff_session_freshness force row level security;
create policy staff_session_freshness_scope on identity_access.staff_session_freshness
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and staff_identity_id = nullif(current_setting('app.staff_identity_id', true), '')::uuid
  ) with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and staff_identity_id = nullif(current_setting('app.staff_identity_id', true), '')::uuid
  );

alter table school_configuration.configuration_states enable row level security;
alter table school_configuration.authored_resources enable row level security;
alter table school_configuration.authored_revisions enable row level security;
alter table school_configuration.draft_candidates enable row level security;
alter table school_configuration.draft_components enable row level security;
alter table school_configuration.managed_translation_reviews enable row level security;
alter table school_configuration.publication_attempts enable row level security;
alter table school_configuration.configuration_releases enable row level security;
alter table school_configuration.release_components enable row level security;
alter table school_configuration.release_packages enable row level security;
alter table school_configuration.configuration_states force row level security;
alter table school_configuration.authored_resources force row level security;
alter table school_configuration.authored_revisions force row level security;
alter table school_configuration.draft_candidates force row level security;
alter table school_configuration.draft_components force row level security;
alter table school_configuration.managed_translation_reviews force row level security;
alter table school_configuration.publication_attempts force row level security;
alter table school_configuration.configuration_releases force row level security;
alter table school_configuration.release_components force row level security;
alter table school_configuration.release_packages force row level security;

do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'configuration_states', 'authored_resources', 'authored_revisions',
    'draft_candidates', 'draft_components', 'managed_translation_reviews', 'publication_attempts',
    'configuration_releases', 'release_components', 'release_packages'
  ] loop
    execute format(
      'create policy %I on school_configuration.%I using (
         workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid
         and identity_access.current_staff_has_permission(''administrative'')
       ) with check (
         workspace_id = nullif(current_setting(''app.workspace_id'', true), '''')::uuid
         and identity_access.current_staff_has_permission(''administrative'')
       )', relation_name || '_administrator_scope', relation_name
    );
  end loop;
end
$$;
