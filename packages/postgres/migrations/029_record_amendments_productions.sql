create table records_governance.record_amendments (
  sequence bigint generated always as identity,
  amendment_id uuid primary key,
  case_id uuid not null
    references records_governance.record_lifecycle_cases(case_id),
  workspace_id uuid not null,
  student_id uuid not null,
  challenged_fact_kind text not null check (challenged_fact_kind in (
    'identity', 'intake_record_version', 'membership', 'learning_progress'
  )),
  challenged_fact_id uuid not null,
  decision text not null check (decision in (
    'correction_authorized', 'challenge_denied'
  )),
  reason_code text not null check (reason_code in (
    'factual_inaccuracy', 'identity_dispute', 'intake_inaccuracy',
    'requester_statement_only', 'insufficient_evidence', 'outside_authority'
  )),
  authority_kind text not null check (authority_kind in (
    'school_administrator', 'school_nurse', 'legal_custodian'
  )),
  effective_correction jsonb,
  requester_statement_preserved boolean not null,
  statement_wrapping_key_id text,
  statement_wrapped_data_key text,
  statement_ciphertext text,
  correction_wrapping_key_id text,
  correction_wrapped_data_key text,
  correction_ciphertext text,
  recorded_at timestamptz not null,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_amendment'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, operation_id),
  check (
    (requester_statement_preserved = false
      and statement_ciphertext is null)
    or (requester_statement_preserved = true
      and statement_ciphertext is not null)
  )
);

create table records_governance.record_conflict_reviews (
  review_id uuid primary key,
  workspace_id uuid not null,
  conflict_kind text not null check (conflict_kind in (
    'student_identity', 'intake_record'
  )),
  subject_student_id uuid not null,
  conflicting_student_id uuid not null,
  status text not null check (status in ('open', 'resolved')),
  outcome text check (outcome in ('keep_distinct', 'referred_for_amendment')),
  opened_at timestamptz not null,
  resolved_at timestamptz,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_conflict_review'),
  foreign key (subject_student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  foreign key (conflicting_student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, operation_id),
  check (subject_student_id <> conflicting_student_id),
  check (
    (status = 'open' and resolved_at is null and outcome is null)
    or (status = 'resolved' and resolved_at is not null and outcome is not null)
  )
);

create table records_governance.record_conflict_review_events (
  sequence bigint generated always as identity,
  review_event_id uuid primary key,
  review_id uuid not null
    references records_governance.record_conflict_reviews(review_id),
  workspace_id uuid not null,
  event_kind text not null check (event_kind in ('opened', 'resolved')),
  outcome text check (outcome in ('keep_distinct', 'referred_for_amendment')),
  occurred_at timestamptz not null,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  details jsonb not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_conflict_review_event'),
  unique (workspace_id, operation_id)
);

create table records_governance.record_productions (
  production_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  case_id uuid not null
    references records_governance.record_lifecycle_cases(case_id),
  status text not null check (status in (
    'pending_delivery', 'delivered', 'retrieved', 'expired', 'delivery_failed'
  )),
  cleanup_status text not null check (cleanup_status in (
    'pending', 'removed', 'failed'
  )),
  portions jsonb not null,
  purpose text not null,
  recipient_digest text not null,
  capability_digest text not null,
  failed_attempts integer not null default 0
    check (failed_attempts between 0 and 5),
  wrapping_key_id text,
  wrapped_data_key text,
  ciphertext text,
  delivery_key_id text,
  delivery_ciphertext text,
  expires_at timestamptz not null,
  authorized_at timestamptz not null,
  delivered_at timestamptz,
  retrieved_at timestamptz,
  removed_at timestamptz,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_production'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, operation_id),
  unique (capability_digest)
);

create table records_governance.record_production_events (
  sequence bigint generated always as identity,
  production_event_id uuid primary key,
  production_id uuid not null
    references records_governance.record_productions(production_id),
  workspace_id uuid not null,
  student_id uuid not null,
  event_kind text not null check (event_kind in (
    'authorized', 'delivered', 'delivery_failed', 'retrieved', 'expired',
    'removed', 'cleanup_failed'
  )),
  occurred_at timestamptz not null,
  actor_staff_identity_id uuid,
  operation_id uuid not null,
  details jsonb not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'record_production_event')
);

create trigger record_amendments_are_append_only
before update or delete on records_governance.record_amendments
for each row execute function records_governance.reject_mutation();

create trigger record_conflict_review_events_are_append_only
before update or delete on records_governance.record_conflict_review_events
for each row execute function records_governance.reject_mutation();

create trigger record_production_events_are_append_only
before update or delete on records_governance.record_production_events
for each row execute function records_governance.reject_mutation();

alter table records_governance.record_amendments enable row level security;
alter table records_governance.record_conflict_reviews enable row level security;
alter table records_governance.record_conflict_review_events enable row level security;
alter table records_governance.record_productions enable row level security;
alter table records_governance.record_production_events enable row level security;
alter table records_governance.record_amendments force row level security;
alter table records_governance.record_conflict_reviews force row level security;
alter table records_governance.record_conflict_review_events force row level security;
alter table records_governance.record_productions force row level security;
alter table records_governance.record_production_events force row level security;

create policy record_amendments_administration_scope
  on records_governance.record_amendments
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_conflict_reviews_administration_scope
  on records_governance.record_conflict_reviews
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_conflict_review_events_administration_scope
  on records_governance.record_conflict_review_events
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_productions_administration_scope
  on records_governance.record_productions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_productions_retrieval_scope
  on records_governance.record_productions
  using (
    capability_digest = nullif(
      current_setting('app.record_production_capability_digest', true),
      ''
    )
  );

create policy record_production_events_administration_scope
  on records_governance.record_production_events
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy record_production_events_retrieval_scope
  on records_governance.record_production_events
  using (
    exists (
      select 1
        from records_governance.record_productions production
       where production.production_id = record_production_events.production_id
         and production.capability_digest = nullif(
           current_setting('app.record_production_capability_digest', true),
           ''
         )
    )
  )
  with check (
    exists (
      select 1
        from records_governance.record_productions production
       where production.production_id = record_production_events.production_id
         and production.capability_digest = nullif(
           current_setting('app.record_production_capability_digest', true),
           ''
         )
    )
  );

create policy intake_record_versions_authorized_production_read
  on intake.intake_record_versions
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
    and exists (
      select 1
        from records_governance.record_lifecycle_cases lifecycle
       where lifecycle.case_id = nullif(
               current_setting('app.record_production_case_id', true),
               ''
             )::uuid
         and lifecycle.workspace_id = intake_record_versions.workspace_id
         and lifecycle.student_id = intake_record_versions.student_id
         and lifecycle.decision = 'authorized'
         and lifecycle.outcome = 'open'
         and lifecycle.case_type in ('access', 'transfer', 'disclosure')
         and (
           lifecycle.scope->'portions' ? 'intake'
           or lifecycle.scope->'portions' ? 'complete_bundle'
         )
    )
  );

create policy intake_drafts_authorized_production_read
  on intake.intake_drafts
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
    and exists (
      select 1
        from records_governance.record_lifecycle_cases lifecycle
       where lifecycle.case_id = nullif(
               current_setting('app.record_production_case_id', true),
               ''
             )::uuid
         and lifecycle.workspace_id = intake_drafts.workspace_id
         and lifecycle.student_id = intake_drafts.student_id
         and lifecycle.decision = 'authorized'
         and lifecycle.outcome = 'open'
         and lifecycle.case_type in ('access', 'transfer', 'disclosure')
         and lifecycle.scope->'portions' ? 'complete_bundle'
    )
  );

create policy item_completions_authorized_production_read
  on learning_progress.item_completions
  for select using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
    and exists (
      select 1
        from records_governance.record_lifecycle_cases lifecycle
       where lifecycle.case_id = nullif(
               current_setting('app.record_production_case_id', true),
               ''
             )::uuid
         and lifecycle.workspace_id = item_completions.workspace_id
         and lifecycle.student_id = item_completions.student_id
         and lifecycle.decision = 'authorized'
         and lifecycle.outcome = 'open'
         and lifecycle.case_type in ('access', 'transfer', 'disclosure')
         and (
           lifecycle.scope->'portions' ? 'learning_progress'
           or lifecycle.scope->'portions' ? 'complete_bundle'
         )
    )
  );

create function infrastructure.pending_record_production_outbox()
returns table (outbox_id uuid)
language sql security definer set search_path = '' as $$
  select outbox.outbox_id
    from infrastructure.outbox outbox
   where outbox.topic = 'record_production.delivery_requested'
     and outbox.status = 'pending'
   order by outbox.sequence
   limit 20
$$;

create function infrastructure.claim_record_production_delivery(
  requested_outbox_id uuid,
  requested_at timestamptz
) returns table (
  outcome text,
  production_id uuid,
  key_id text,
  ciphertext text,
  provider_idempotency_key text
) language plpgsql security definer set search_path = '' as $$
declare
  requested_production_id uuid;
  production_row records_governance.record_productions%rowtype;
begin
  select (payload->>'productionId')::uuid
    into requested_production_id
    from infrastructure.outbox
   where outbox_id = requested_outbox_id
     and topic = 'record_production.delivery_requested';
  if requested_production_id is null then
    return query select 'suppressed'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;
  select * into production_row
    from records_governance.record_productions
   where records_governance.record_productions.production_id = requested_production_id
   for update;
  if production_row.production_id is null
     or production_row.status not in ('pending_delivery')
     or production_row.expires_at <= requested_at
     or production_row.delivery_ciphertext is null then
    if production_row.production_id is not null
       and production_row.expires_at <= requested_at
       and production_row.ciphertext is not null then
      update records_governance.record_productions
         set wrapping_key_id = null,
             wrapped_data_key = null,
             ciphertext = null,
             delivery_key_id = null,
             delivery_ciphertext = null,
             status = 'expired',
             cleanup_status = 'removed',
             removed_at = requested_at
       where production_id = requested_production_id;
    end if;
    update infrastructure.outbox set status = 'completed'
     where outbox_id = requested_outbox_id;
    return query select 'suppressed'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;
  return query select
    'deliver'::text,
    requested_production_id,
    production_row.delivery_key_id,
    production_row.delivery_ciphertext,
    requested_production_id::text;
end
$$;

create function infrastructure.complete_record_production_delivery(
  requested_outbox_id uuid,
  requested_production_id uuid,
  requested_provider_message_id text,
  requested_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from infrastructure.outbox outbox
     where outbox.outbox_id = requested_outbox_id
       and outbox.topic = 'record_production.delivery_requested'
       and (outbox.payload->>'productionId')::uuid = requested_production_id
  ) then
    return;
  end if;
  update records_governance.record_productions
     set status = 'delivered', delivered_at = requested_at
   where production_id = requested_production_id
     and status = 'pending_delivery';
  if found then
    insert into records_governance.record_production_events (
      production_event_id, production_id, workspace_id, student_id, event_kind,
      occurred_at, actor_staff_identity_id, operation_id, details, record_owner,
      record_classification, disposal_class
    )
    select gen_random_uuid(), production.production_id, production.workspace_id,
           production.student_id, 'delivered', requested_at, null,
           production.operation_id,
           jsonb_build_object('providerMessagePresent', true),
           'school', 'student_record', 'record_production_event'
      from records_governance.record_productions production
     where production.production_id = requested_production_id;
    update infrastructure.outbox set status = 'completed'
     where outbox_id = requested_outbox_id;
  end if;
end
$$;

create function infrastructure.suppress_record_production_delivery(
  requested_outbox_id uuid,
  requested_production_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from infrastructure.outbox outbox
     where outbox.outbox_id = requested_outbox_id
       and outbox.topic = 'record_production.delivery_requested'
       and (outbox.payload->>'productionId')::uuid = requested_production_id
  ) then
    return;
  end if;
  update records_governance.record_productions
     set status = 'delivery_failed'
   where production_id = requested_production_id
     and status = 'pending_delivery';
  insert into records_governance.record_production_events (
    production_event_id, production_id, workspace_id, student_id, event_kind,
    occurred_at, actor_staff_identity_id, operation_id, details, record_owner,
    record_classification, disposal_class
  )
  select gen_random_uuid(), production.production_id, production.workspace_id,
         production.student_id, 'delivery_failed', clock_timestamp(), null,
         production.operation_id, '{}'::jsonb,
         'school', 'student_record', 'record_production_event'
    from records_governance.record_productions production
   where production.production_id = requested_production_id
     and not exists (
       select 1 from records_governance.record_production_events event
        where event.production_id = production.production_id
          and event.event_kind = 'delivery_failed'
          and event.operation_id = production.operation_id
     );
  update infrastructure.outbox set status = 'failed'
   where outbox_id = requested_outbox_id;
end
$$;

create function infrastructure.expire_record_productions(
  requested_at timestamptz
) returns table (expired integer, cleanup_failed integer)
language plpgsql security definer set search_path = '' as $$
declare
  expired_count integer := 0;
  failed_count integer := 0;
  production_row records_governance.record_productions%rowtype;
begin
  for production_row in
    select * from records_governance.record_productions
     where expires_at <= requested_at
       and status in ('pending_delivery', 'delivered')
       and cleanup_status in ('pending', 'failed')
     for update
  loop
    begin
      update records_governance.record_productions
         set wrapping_key_id = null,
             wrapped_data_key = null,
             ciphertext = null,
             delivery_key_id = null,
             delivery_ciphertext = null,
             status = 'expired',
             cleanup_status = 'removed',
             removed_at = requested_at
       where production_id = production_row.production_id;
      insert into records_governance.record_production_events (
        production_event_id, production_id, workspace_id, student_id,
        event_kind, occurred_at, actor_staff_identity_id, operation_id,
        details, record_owner, record_classification, disposal_class
      ) values (
        gen_random_uuid(), production_row.production_id,
        production_row.workspace_id, production_row.student_id, 'expired',
        requested_at, null, production_row.operation_id, '{}'::jsonb,
        'school', 'student_record', 'record_production_event'
      );
      expired_count := expired_count + 1;
    exception when others then
      update records_governance.record_productions
         set cleanup_status = 'failed'
       where production_id = production_row.production_id;
      failed_count := failed_count + 1;
    end;
  end loop;
  return query select expired_count, failed_count;
end
$$;

revoke all on function infrastructure.pending_record_production_outbox() from public;
revoke all on function infrastructure.claim_record_production_delivery(uuid, timestamptz) from public;
revoke all on function infrastructure.complete_record_production_delivery(uuid, uuid, text, timestamptz) from public;
revoke all on function infrastructure.suppress_record_production_delivery(uuid, uuid) from public;
revoke all on function infrastructure.expire_record_productions(timestamptz) from public;
