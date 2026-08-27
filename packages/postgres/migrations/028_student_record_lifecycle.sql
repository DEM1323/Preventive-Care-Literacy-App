create schema if not exists records_governance;

alter table identity_access.students
  add column presence text not null default 'enrolled';

alter table identity_access.students
  add constraint students_presence_check
  check (presence in ('enrolled', 'departed'));

create table records_governance.records_policy_revisions (
  policy_revision_id uuid primary key,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  revision_number integer not null check (revision_number > 0),
  payload jsonb not null,
  activated_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'school_administrative'),
  disposal_class text not null check (disposal_class = 'records_policy_revision'),
  unique (workspace_id, revision_number)
);

create table records_governance.student_departure_facts (
  sequence bigint generated always as identity,
  departure_fact_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  kind text not null check (kind in ('departed', 'reversed')),
  reason text check (
    (kind = 'departed' and reason in ('transferred', 'graduated', 'withdrew'))
    or (kind = 'reversed' and reason is null)
  ),
  effective_on date,
  occurred_at timestamptz not null,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'student_departure_fact'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, operation_id)
);

create table records_governance.record_lifecycle_cases (
  case_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  case_type text not null check (case_type in (
    'access', 'amendment', 'transfer', 'disclosure', 'hold', 'disposition'
  )),
  request_code text not null check (request_code in (
    'lawful_access', 'amendment_challenge', 'transfer', 'disclosure',
    'preservation', 'scheduled_destruction'
  )),
  requester_kind text not null check (requester_kind in (
    'school_administrator', 'school_nurse', 'legal_custodian', 'student',
    'parent_guardian'
  )),
  authority_kind text not null check (authority_kind in (
    'school_administrator', 'school_nurse', 'legal_custodian'
  )),
  scope jsonb not null,
  deadline_at timestamptz not null,
  policy_revision_id uuid not null
    references records_governance.records_policy_revisions(policy_revision_id),
  decision text not null check (decision in (
    'pending', 'authorized', 'denied', 'withdrawn'
  )),
  outcome text not null check (outcome in ('open', 'completed', 'cancelled')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_lifecycle_case'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  check (
    (outcome = 'open' and closed_at is null)
    or (outcome <> 'open' and closed_at is not null)
  )
);

create table records_governance.record_lifecycle_case_events (
  sequence bigint generated always as identity,
  case_event_id uuid primary key,
  case_id uuid not null
    references records_governance.record_lifecycle_cases(case_id),
  workspace_id uuid not null,
  student_id uuid not null,
  event_kind text not null check (event_kind in (
    'opened', 'decided', 'outcome_recorded'
  )),
  decision text not null check (decision in (
    'pending', 'authorized', 'denied', 'withdrawn'
  )),
  outcome text not null check (outcome in ('open', 'completed', 'cancelled')),
  occurred_at timestamptz not null,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  details jsonb not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_lifecycle_case_event'),
  unique (workspace_id, operation_id)
);

create table records_governance.record_holds (
  hold_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  source text not null check (source in (
    'manual', 'automatic_access_case', 'automatic_amendment_case', 'hold_case'
  )),
  reason text not null check (reason in (
    'open_access_case', 'open_amendment_case', 'school_preservation', 'hold_case'
  )),
  case_id uuid references records_governance.record_lifecycle_cases(case_id),
  status text not null check (status in ('active', 'released')),
  established_at timestamptz not null,
  released_at timestamptz,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_hold'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  check (
    (status = 'active' and released_at is null)
    or (status = 'released' and released_at is not null)
  )
);

create unique index record_holds_one_automatic_per_case
  on records_governance.record_holds(case_id)
  where case_id is not null
    and source in ('automatic_access_case', 'automatic_amendment_case', 'hold_case');

create function records_governance.reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'records governance history is append-only';
end;
$$;

create trigger records_policy_revisions_are_append_only
before update or delete on records_governance.records_policy_revisions
for each row execute function records_governance.reject_mutation();

create trigger student_departure_facts_are_append_only
before update or delete on records_governance.student_departure_facts
for each row execute function records_governance.reject_mutation();

create trigger record_lifecycle_case_events_are_append_only
before update or delete on records_governance.record_lifecycle_case_events
for each row execute function records_governance.reject_mutation();

alter table records_governance.records_policy_revisions enable row level security;
alter table records_governance.student_departure_facts enable row level security;
alter table records_governance.record_lifecycle_cases enable row level security;
alter table records_governance.record_lifecycle_case_events enable row level security;
alter table records_governance.record_holds enable row level security;
alter table records_governance.records_policy_revisions force row level security;
alter table records_governance.student_departure_facts force row level security;
alter table records_governance.record_lifecycle_cases force row level security;
alter table records_governance.record_lifecycle_case_events force row level security;
alter table records_governance.record_holds force row level security;

create policy records_policy_administration_scope
  on records_governance.records_policy_revisions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy student_departure_facts_administration_scope
  on records_governance.student_departure_facts
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_lifecycle_cases_administration_scope
  on records_governance.record_lifecycle_cases
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_lifecycle_case_events_administration_scope
  on records_governance.record_lifecycle_case_events
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_holds_administration_scope
  on records_governance.record_holds
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );
