create table records_governance.record_disposition_notices (
  notice_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  completed_at timestamptz not null,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_disposition_notice'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, student_id),
  unique (workspace_id, operation_id)
);

create table records_governance.record_disposition_copy_opportunities (
  copy_opportunity_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  completed_at timestamptz not null,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_disposition_copy_opportunity'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, student_id),
  unique (workspace_id, operation_id)
);

create table records_governance.record_dispositions (
  disposition_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  case_id uuid not null
    references records_governance.record_lifecycle_cases(case_id),
  policy_revision_id uuid not null
    references records_governance.records_policy_revisions(policy_revision_id),
  status text not null check (status in (
    'scheduled', 'executing', 'cancelled', 'failed', 'purged'
  )),
  version integer not null check (version > 0),
  scheduled_at timestamptz not null,
  cancellation_deadline_at timestamptz not null,
  cancelled_at timestamptz,
  execution_started_at timestamptz,
  completed_at timestamptz,
  authority_kind text not null check (authority_kind in (
    'school_administrator', 'school_nurse', 'legal_custodian'
  )),
  notice_id uuid not null
    references records_governance.record_disposition_notices(notice_id),
  copy_opportunity_id uuid not null
    references records_governance.record_disposition_copy_opportunities(copy_opportunity_id),
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_disposition'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, operation_id),
  check (cancellation_deadline_at = scheduled_at + interval '7 days')
);

create unique index record_dispositions_one_active
  on records_governance.record_dispositions(workspace_id, student_id)
  where status in ('scheduled', 'executing', 'failed');

create table records_governance.record_disposition_events (
  sequence bigint generated always as identity,
  disposition_event_id uuid primary key,
  disposition_id uuid not null
    references records_governance.record_dispositions(disposition_id),
  workspace_id uuid not null,
  student_id uuid not null,
  event_kind text not null check (event_kind in (
    'scheduled', 'cancelled', 'execution_started', 'adapter_purged',
    'adapter_failed', 'retry_started', 'failed', 'purged'
  )),
  occurred_at timestamptz not null,
  actor_staff_identity_id uuid,
  operation_id uuid not null,
  details jsonb not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_disposition_event')
);

create table records_governance.record_disposition_tasks (
  task_id uuid primary key,
  disposition_id uuid not null
    references records_governance.record_dispositions(disposition_id),
  workspace_id uuid not null,
  student_id uuid not null,
  adapter text not null,
  location text not null,
  status text not null check (status in ('pending', 'purged', 'failed')),
  purged_count integer not null default 0 check (purged_count >= 0),
  verification text not null check (verification in (
    'pending', 'verified', 'failed'
  )),
  last_error_code text,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_disposition_task'),
  unique (disposition_id, adapter)
);

create trigger record_disposition_notices_are_append_only
before update or delete on records_governance.record_disposition_notices
for each row execute function records_governance.reject_mutation();

create trigger record_disposition_copy_opportunities_are_append_only
before update or delete on records_governance.record_disposition_copy_opportunities
for each row execute function records_governance.reject_mutation();

create trigger record_disposition_events_are_append_only
before update or delete on records_governance.record_disposition_events
for each row execute function records_governance.reject_mutation();

create function records_governance.disposition_purge_authorized(
  requested_workspace_id uuid,
  requested_student_id uuid
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  return exists (
    select 1
      from records_governance.record_dispositions disposition
     where disposition.disposition_id = nullif(
             pg_catalog.current_setting('app.record_disposition_id', true),
             ''
           )::uuid
       and disposition.workspace_id = requested_workspace_id
       and disposition.student_id = requested_student_id
       and disposition.status in ('executing', 'failed')
  )
  and identity_access.current_staff_has_permission('administrative');
end;
$$;

create or replace function intake.reject_version_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if records_governance.disposition_purge_authorized(
         old.workspace_id, old.student_id
       ) then
      return old;
    end if;
    raise exception 'intake record versions are immutable';
  end if;
  if old.superseded_at is not null
     or new.superseded_at is null
     or new.intake_record_version_id is distinct from old.intake_record_version_id
     or new.student_id is distinct from old.student_id
     or new.workspace_id is distinct from old.workspace_id
     or new.version_number is distinct from old.version_number
     or new.school_configuration_release_id is distinct from old.school_configuration_release_id
     or new.intake_form_resource_id is distinct from old.intake_form_resource_id
     or new.intake_form_revision_number is distinct from old.intake_form_revision_number
     or new.submission_attestation_resource_id is distinct from old.submission_attestation_resource_id
     or new.submission_attestation_revision_number is distinct from old.submission_attestation_revision_number
     or new.locale is distinct from old.locale
     or new.wrapping_key_id is distinct from old.wrapping_key_id
     or new.wrapped_data_key is distinct from old.wrapped_data_key
     or new.ciphertext is distinct from old.ciphertext
     or new.accepted_at is distinct from old.accepted_at
     or new.record_owner is distinct from old.record_owner
     or new.record_classification is distinct from old.record_classification
     or new.disposal_class is distinct from old.disposal_class
  then
    raise exception 'intake record versions are immutable';
  end if;
  return new;
end;
$$;

create or replace function learning_progress.reject_completion_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE'
     and records_governance.disposition_purge_authorized(
           old.workspace_id, old.student_id
         ) then
    return old;
  end if;
  raise exception 'item completions are immutable';
end;
$$;

drop trigger record_amendments_are_append_only
  on records_governance.record_amendments;

create function records_governance.reject_amendment_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'records governance history is append-only';
  end if;
  if records_governance.disposition_purge_authorized(
       old.workspace_id, old.student_id
     )
     and new.amendment_id is not distinct from old.amendment_id
     and new.case_id is not distinct from old.case_id
     and new.workspace_id is not distinct from old.workspace_id
     and new.student_id is not distinct from old.student_id
     and new.challenged_fact_kind is not distinct from old.challenged_fact_kind
     and new.challenged_fact_id is not distinct from old.challenged_fact_id
     and new.decision is not distinct from old.decision
     and new.reason_code is not distinct from old.reason_code
     and new.authority_kind is not distinct from old.authority_kind
     and new.effective_correction is not distinct from old.effective_correction
     and new.requester_statement_preserved is not distinct from old.requester_statement_preserved
     and new.recorded_at is not distinct from old.recorded_at
     and new.actor_staff_identity_id is not distinct from old.actor_staff_identity_id
     and new.operation_id is not distinct from old.operation_id
     and new.statement_wrapping_key_id is null
     and new.statement_wrapped_data_key is null
     and new.statement_ciphertext is null
     and new.correction_wrapping_key_id is null
     and new.correction_wrapped_data_key is null
     and new.correction_ciphertext is null
  then
    return new;
  end if;
  raise exception 'records governance history is append-only';
end;
$$;

create trigger record_amendments_are_append_only
before update or delete on records_governance.record_amendments
for each row execute function records_governance.reject_amendment_mutation();

alter table records_governance.record_disposition_notices enable row level security;
alter table records_governance.record_disposition_copy_opportunities enable row level security;
alter table records_governance.record_dispositions enable row level security;
alter table records_governance.record_disposition_events enable row level security;
alter table records_governance.record_disposition_tasks enable row level security;
alter table records_governance.record_disposition_notices force row level security;
alter table records_governance.record_disposition_copy_opportunities force row level security;
alter table records_governance.record_dispositions force row level security;
alter table records_governance.record_disposition_events force row level security;
alter table records_governance.record_disposition_tasks force row level security;

create policy record_disposition_notices_administration_scope
  on records_governance.record_disposition_notices
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_disposition_copy_opportunities_administration_scope
  on records_governance.record_disposition_copy_opportunities
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_dispositions_administration_scope
  on records_governance.record_dispositions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_disposition_events_administration_scope
  on records_governance.record_disposition_events
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_disposition_tasks_administration_scope
  on records_governance.record_disposition_tasks
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy intake_drafts_disposition_administration
  on intake.intake_drafts
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
    and exists (
      select 1
        from records_governance.record_dispositions disposition
       where disposition.disposition_id = nullif(
               current_setting('app.record_disposition_id', true),
               ''
             )::uuid
         and disposition.workspace_id = intake_drafts.workspace_id
         and disposition.student_id = intake_drafts.student_id
         and disposition.status in ('executing', 'failed')
    )
  );

create policy intake_record_versions_disposition_administration
  on intake.intake_record_versions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
    and exists (
      select 1
        from records_governance.record_dispositions disposition
       where disposition.disposition_id = nullif(
               current_setting('app.record_disposition_id', true),
               ''
             )::uuid
         and disposition.workspace_id = intake_record_versions.workspace_id
         and disposition.student_id = intake_record_versions.student_id
         and disposition.status in ('executing', 'failed')
    )
  );

create policy intake_operation_receipts_disposition_administration
  on intake.intake_operation_receipts
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
    and exists (
      select 1
        from records_governance.record_dispositions disposition
       where disposition.disposition_id = nullif(
               current_setting('app.record_disposition_id', true),
               ''
             )::uuid
         and disposition.workspace_id = intake_operation_receipts.workspace_id
         and disposition.student_id = intake_operation_receipts.student_id
         and disposition.status in ('executing', 'failed')
    )
  );

create policy item_completions_disposition_administration
  on learning_progress.item_completions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
    and exists (
      select 1
        from records_governance.record_dispositions disposition
       where disposition.disposition_id = nullif(
               current_setting('app.record_disposition_id', true),
               ''
             )::uuid
         and disposition.workspace_id = item_completions.workspace_id
         and disposition.student_id = item_completions.student_id
         and disposition.status in ('executing', 'failed')
    )
  );

create policy item_completion_receipts_disposition_administration
  on learning_progress.item_completion_receipts
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
    and exists (
      select 1
        from records_governance.record_dispositions disposition
       where disposition.disposition_id = nullif(
               current_setting('app.record_disposition_id', true),
               ''
             )::uuid
         and disposition.workspace_id = item_completion_receipts.workspace_id
         and disposition.student_id = item_completion_receipts.student_id
         and disposition.status in ('executing', 'failed')
    )
  );

create policy sign_in_deliveries_disposition_administration
  on identity_access.sign_in_deliveries
  using (
    exists (
      select 1 from identity_access.sign_in_challenges challenge
       where challenge.sign_in_challenge_id = sign_in_deliveries.sign_in_challenge_id
         and challenge.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
         and identity_access.current_staff_has_permission('administrative')
         and exists (
           select 1
             from records_governance.record_dispositions disposition
            where disposition.disposition_id = nullif(
                    current_setting('app.record_disposition_id', true),
                    ''
                  )::uuid
              and disposition.workspace_id = challenge.workspace_id
              and disposition.student_id = challenge.student_id
              and disposition.status in ('executing', 'failed')
         )
    )
  );

create policy sign_in_send_attempts_disposition_administration
  on identity_access.sign_in_send_attempts
  using (
    identity_access.current_staff_has_permission('administrative')
    and recipient_digest in (
      select email.recipient_digest
        from identity_access.verified_email_addresses email
       where email.workspace_id = nullif(
               current_setting('app.workspace_id', true),
               ''
             )::uuid
         and exists (
           select 1
             from records_governance.record_dispositions disposition
            where disposition.disposition_id = nullif(
                    current_setting('app.record_disposition_id', true),
                    ''
                  )::uuid
              and disposition.workspace_id = email.workspace_id
              and disposition.student_id = email.student_id
              and disposition.status in ('executing', 'failed')
         )
    )
  );

revoke all on function records_governance.disposition_purge_authorized(uuid, uuid) from public;

do $$
declare
  statement_check text;
begin
  select con.conname into statement_check
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'records_governance'
     and rel.relname = 'record_amendments'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) like '%requester_statement_preserved%';
  if statement_check is not null then
    execute format(
      'alter table records_governance.record_amendments drop constraint %I',
      statement_check
    );
  end if;
end
$$;

alter table records_governance.record_amendments
  add constraint record_amendments_statement_state_check
  check (
    (
      requester_statement_preserved = false
      and statement_ciphertext is null
    )
    or (
      requester_statement_preserved = true
      and (
        statement_ciphertext is not null
        or statement_wrapping_key_id is null
      )
    )
  );
