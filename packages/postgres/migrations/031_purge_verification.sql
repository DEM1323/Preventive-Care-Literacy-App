alter table records_governance.record_disposition_events
  drop constraint record_disposition_events_event_kind_check;

alter table records_governance.record_disposition_events
  add constraint record_disposition_events_event_kind_check
  check (event_kind in (
    'scheduled', 'cancelled', 'execution_started', 'adapter_purged',
    'adapter_failed', 'retry_started', 'failed', 'purged',
    'restore_reapplied', 'verification_recorded', 'backup_expiry_verified',
    'certificate_issued', 'residue_discarded'
  ));

create table records_governance.purge_tombstones (
  tombstone_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  disposition_id uuid not null,
  completed_at timestamptz not null,
  adapters text[] not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'purge_tombstone'),
  unique (workspace_id, student_id),
  unique (disposition_id),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id)
);

create table records_governance.purge_verification_locations (
  location_id uuid primary key,
  disposition_id uuid not null
    references records_governance.record_dispositions(disposition_id),
  workspace_id uuid not null,
  student_id uuid not null,
  adapter text not null,
  location text not null,
  deletion text not null check (deletion in (
    'requested', 'deleted', 'pending', 'failed'
  )),
  verification text not null check (verification in (
    'pending', 'verified', 'failed'
  )),
  residual_retention_deadline_at timestamptz not null,
  evidence_digest text,
  last_error_code text,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'purge_verification_location'),
  unique (disposition_id, adapter),
  check (
    evidence_digest is null
    or evidence_digest ~ '^[0-9a-f]{64}$'
  ),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id)
);

create table records_governance.purge_identifying_residue (
  residue_id uuid primary key,
  disposition_id uuid not null
    references records_governance.record_dispositions(disposition_id),
  workspace_id uuid not null,
  student_id uuid,
  kind text not null check (kind = 'verification_workflow'),
  discarded_at timestamptz,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'student_record'),
  disposal_class text not null check (disposal_class = 'purge_identifying_residue'),
  unique (disposition_id),
  check (
    (discarded_at is null and student_id is not null)
    or (discarded_at is not null and student_id is null)
  )
);

create table records_governance.destruction_certificates (
  certificate_id uuid primary key,
  disposition_id uuid not null unique
    references records_governance.record_dispositions(disposition_id),
  workspace_id uuid not null,
  issued_at timestamptz not null,
  policy_revision_id uuid not null
    references records_governance.records_policy_revisions(policy_revision_id),
  locations jsonb not null,
  actor_staff_identity_id uuid not null,
  operation_id uuid not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'destruction_certificate'),
  unique (workspace_id, operation_id),
  check (jsonb_typeof(locations) = 'array')
);

create table infrastructure.purge_restore_gate (
  gate_id text primary key check (gate_id = 'default'),
  status text not null check (status in (
    'not_required', 'pending', 'verified', 'failed'
  )),
  last_operation_id uuid,
  last_command text,
  last_result jsonb,
  verified_at timestamptz,
  failed_code text,
  actor_id text,
  updated_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'purge_restore_gate')
);

insert into infrastructure.purge_restore_gate (
  gate_id, status, updated_at, record_owner, record_classification, disposal_class
) values (
  'default', 'not_required', clock_timestamp(),
  'school', 'operational_evidence', 'purge_restore_gate'
);

create trigger purge_tombstones_are_append_only
before update or delete on records_governance.purge_tombstones
for each row execute function records_governance.reject_mutation();

create trigger destruction_certificates_are_append_only
before update or delete on records_governance.destruction_certificates
for each row execute function records_governance.reject_mutation();

create table records_governance.purge_restore_in_progress (
  workspace_id uuid not null,
  student_id uuid not null,
  primary key (workspace_id, student_id)
);

revoke all on table records_governance.purge_restore_in_progress from public;

create or replace function records_governance.disposition_purge_authorized(
  requested_workspace_id uuid,
  requested_student_id uuid
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  return (
    exists (
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
    and identity_access.current_staff_has_permission('administrative')
  )
  or exists (
    select 1
      from records_governance.purge_restore_in_progress progress
     where progress.workspace_id = requested_workspace_id
       and progress.student_id = requested_student_id
  );
end;
$$;

create function records_governance.reapply_purge_tombstone(
  requested_workspace_id uuid,
  requested_student_id uuid
) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  removed integer := 0;
  step integer := 0;
  invitation_ids uuid[];
  challenge_ids uuid[];
begin
  if not exists (
    select 1 from records_governance.purge_tombstones tombstone
     where tombstone.workspace_id = requested_workspace_id
       and tombstone.student_id = requested_student_id
  ) then
    raise exception 'purge tombstone is required';
  end if;
  insert into records_governance.purge_restore_in_progress (
    workspace_id, student_id
  ) values (requested_workspace_id, requested_student_id);
  perform pg_catalog.set_config(
    'app.workspace_id', requested_workspace_id::text, true
  );

  begin

  select coalesce(array_agg(invitation.invitation_id), array[]::uuid[])
    into invitation_ids
    from identity_access.invitations invitation
   where invitation.workspace_id = requested_workspace_id
     and invitation.recipient_digest in (
       select email.recipient_digest
         from identity_access.verified_email_addresses email
        where email.student_id = requested_student_id
          and email.workspace_id = requested_workspace_id
     );

  delete from identity_access.class_memberships
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;
  get diagnostics step = row_count;
  removed := removed + step;

  if coalesce(array_length(invitation_ids, 1), 0) > 0 then
    delete from identity_access.invitation_deliveries
     where invitation_id = any(invitation_ids);
    get diagnostics step = row_count;
    removed := removed + step;
    delete from identity_access.invitation_challenges
     where invitation_id = any(invitation_ids);
    get diagnostics step = row_count;
    removed := removed + step;
    delete from identity_access.invitations
     where invitation_id = any(invitation_ids);
    get diagnostics step = row_count;
    removed := removed + step;
  end if;

  select coalesce(array_agg(challenge.sign_in_challenge_id), array[]::uuid[])
    into challenge_ids
    from identity_access.sign_in_challenges challenge
   where challenge.student_id = requested_student_id
     and challenge.workspace_id = requested_workspace_id;

  if coalesce(array_length(challenge_ids, 1), 0) > 0 then
    delete from identity_access.sign_in_deliveries
     where sign_in_challenge_id = any(challenge_ids);
    get diagnostics step = row_count;
    removed := removed + step;
    delete from identity_access.sign_in_challenge_codes
     where sign_in_challenge_id = any(challenge_ids);
    get diagnostics step = row_count;
    removed := removed + step;
    delete from identity_access.sign_in_challenges
     where sign_in_challenge_id = any(challenge_ids);
    get diagnostics step = row_count;
    removed := removed + step;
  end if;

  delete from identity_access.sign_in_send_attempts
   where recipient_digest in (
     select email.recipient_digest
       from identity_access.verified_email_addresses email
      where email.student_id = requested_student_id
        and email.workspace_id = requested_workspace_id
   );
  get diagnostics step = row_count;
  removed := removed + step;

  delete from identity_access.student_sessions
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;
  get diagnostics step = row_count;
  removed := removed + step;

  delete from identity_access.verified_email_addresses
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;
  get diagnostics step = row_count;
  removed := removed + step;

  delete from intake.intake_drafts
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;
  get diagnostics step = row_count;
  removed := removed + step;

  delete from intake.intake_record_versions
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;
  get diagnostics step = row_count;
  removed := removed + step;

  delete from learning_progress.item_completions
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;
  get diagnostics step = row_count;
  removed := removed + step;

  update records_governance.record_productions
     set wrapping_key_id = null, wrapped_data_key = null, ciphertext = null,
         delivery_key_id = null, delivery_ciphertext = null,
         cleanup_status = 'removed',
         removed_at = coalesce(removed_at, clock_timestamp())
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id
     and (ciphertext is not null or delivery_ciphertext is not null);
  get diagnostics step = row_count;
  removed := removed + step;

  update records_governance.record_amendments
     set statement_wrapping_key_id = null, statement_wrapped_data_key = null,
         statement_ciphertext = null, correction_wrapping_key_id = null,
         correction_wrapped_data_key = null, correction_ciphertext = null
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id
     and (statement_ciphertext is not null or correction_ciphertext is not null);
  get diagnostics step = row_count;
  removed := removed + step;

  delete from intake.intake_operation_receipts
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;
  get diagnostics step = row_count;
  removed := removed + step;

  delete from learning_progress.item_completion_receipts
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;
  get diagnostics step = row_count;
  removed := removed + step;

  update identity_access.students
     set language_choice = 'en-US', status = 'disabled'
   where student_id = requested_student_id
     and workspace_id = requested_workspace_id;

  delete from records_governance.purge_restore_in_progress
   where workspace_id = requested_workspace_id
     and student_id = requested_student_id;
  return removed;
  exception when others then
    delete from records_governance.purge_restore_in_progress
     where workspace_id = requested_workspace_id
       and student_id = requested_student_id;
    raise;
  end;
end;
$$;

create function records_governance.disposed_student_is_suppressed(
  requested_workspace_id uuid,
  requested_student_id uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from identity_access.verified_email_addresses
     where student_id = requested_student_id and workspace_id = requested_workspace_id
    union all
    select 1 from identity_access.student_sessions
     where student_id = requested_student_id and workspace_id = requested_workspace_id
    union all
    select 1 from identity_access.class_memberships
     where student_id = requested_student_id and workspace_id = requested_workspace_id
    union all
    select 1 from intake.intake_drafts
     where student_id = requested_student_id and workspace_id = requested_workspace_id
    union all
    select 1 from intake.intake_record_versions
     where student_id = requested_student_id and workspace_id = requested_workspace_id
    union all
    select 1 from learning_progress.item_completions
     where student_id = requested_student_id and workspace_id = requested_workspace_id
    union all
    select 1 from intake.intake_operation_receipts
     where student_id = requested_student_id and workspace_id = requested_workspace_id
    union all
    select 1 from learning_progress.item_completion_receipts
     where student_id = requested_student_id and workspace_id = requested_workspace_id
    union all
    select 1 from records_governance.record_productions
     where student_id = requested_student_id and workspace_id = requested_workspace_id
       and (ciphertext is not null or delivery_ciphertext is not null)
    union all
    select 1 from records_governance.record_amendments
     where student_id = requested_student_id and workspace_id = requested_workspace_id
       and (statement_ciphertext is not null or correction_ciphertext is not null)
  );
$$;

create function records_governance.export_purge_tombstones()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'dispositionId', tombstone.disposition_id,
    'workspaceId', tombstone.workspace_id,
    'studentId', tombstone.student_id,
    'completedAt', to_char(
      tombstone.completed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'adapters', to_jsonb(tombstone.adapters)
  ) order by tombstone.completed_at, tombstone.disposition_id), '[]'::jsonb)
    from records_governance.purge_tombstones tombstone;
$$;

create function records_governance.import_purge_tombstone(
  requested_tombstone_id uuid,
  requested_workspace_id uuid,
  requested_student_id uuid,
  requested_disposition_id uuid,
  requested_completed_at timestamptz,
  requested_adapters text[]
) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into records_governance.purge_tombstones (
    tombstone_id, workspace_id, student_id, disposition_id, completed_at,
    adapters, record_owner, record_classification, disposal_class
  ) values (
    requested_tombstone_id, requested_workspace_id, requested_student_id,
    requested_disposition_id, requested_completed_at, requested_adapters,
    'school', 'operational_evidence', 'purge_tombstone'
  )
  on conflict (workspace_id, student_id) do nothing;
end;
$$;

create function infrastructure.read_purge_restore_gate()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', gate.status,
    'lastOperationId', gate.last_operation_id,
    'lastCommand', gate.last_command,
    'lastResult', gate.last_result,
    'verifiedAt', case when gate.verified_at is null then null
      else to_char(gate.verified_at at time zone 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'failedCode', gate.failed_code
  )
    from infrastructure.purge_restore_gate gate
   where gate.gate_id = 'default';
$$;

create function infrastructure.begin_purge_restore_gate(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_at timestamptz,
  requested_result jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  current infrastructure.purge_restore_gate%rowtype;
begin
  select * into strict current
    from infrastructure.purge_restore_gate
   where gate_id = 'default'
     for update;
  if current.last_operation_id = requested_operation_id
     and current.last_command = 'beginPurgeRestoreGate' then
    return current.last_result;
  end if;
  update infrastructure.purge_restore_gate
     set status = 'pending',
         last_operation_id = requested_operation_id,
         last_command = 'beginPurgeRestoreGate',
         last_result = requested_result,
         verified_at = null,
         failed_code = null,
         actor_id = requested_actor_id,
         updated_at = requested_at
   where gate_id = 'default';
  return requested_result;
end;
$$;

create function infrastructure.complete_purge_restore_gate(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_at timestamptz,
  requested_status text,
  requested_failed_code text,
  requested_result jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  current infrastructure.purge_restore_gate%rowtype;
begin
  if requested_status not in ('verified', 'failed') then
    raise exception 'restore gate outcome is invalid';
  end if;
  select * into strict current
    from infrastructure.purge_restore_gate
   where gate_id = 'default'
     for update;
  if current.last_operation_id = requested_operation_id
     and current.last_command = 'runPurgeRestoreGate' then
    return current.last_result;
  end if;
  update infrastructure.purge_restore_gate
     set status = requested_status,
         last_operation_id = requested_operation_id,
         last_command = 'runPurgeRestoreGate',
         last_result = requested_result,
         verified_at = case when requested_status = 'verified'
           then requested_at else null end,
         failed_code = requested_failed_code,
         actor_id = requested_actor_id,
         updated_at = requested_at
   where gate_id = 'default';
  return requested_result;
end;
$$;

create function records_governance.unsuppressed_disposed_students()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from records_governance.purge_tombstones tombstone
     where not records_governance.disposed_student_is_suppressed(
             tombstone.workspace_id, tombstone.student_id
           )
  );
$$;

alter table records_governance.purge_tombstones enable row level security;
alter table records_governance.purge_verification_locations enable row level security;
alter table records_governance.purge_identifying_residue enable row level security;
alter table records_governance.destruction_certificates enable row level security;
alter table infrastructure.purge_restore_gate enable row level security;
alter table records_governance.purge_tombstones force row level security;
alter table records_governance.purge_verification_locations force row level security;
alter table records_governance.purge_identifying_residue force row level security;
alter table records_governance.destruction_certificates force row level security;
alter table infrastructure.purge_restore_gate force row level security;

create policy purge_tombstones_administration_scope
  on records_governance.purge_tombstones
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy purge_verification_locations_administration_scope
  on records_governance.purge_verification_locations
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy purge_identifying_residue_administration_scope
  on records_governance.purge_identifying_residue
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

create policy destruction_certificates_administration_scope
  on records_governance.destruction_certificates
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative')
  );

revoke all on function records_governance.disposition_purge_authorized(uuid, uuid) from public;
revoke all on function records_governance.reapply_purge_tombstone(uuid, uuid) from public;
revoke all on function records_governance.disposed_student_is_suppressed(uuid, uuid) from public;
revoke all on function records_governance.export_purge_tombstones() from public;
revoke all on function records_governance.import_purge_tombstone(uuid, uuid, uuid, uuid, timestamptz, text[]) from public;
revoke all on function records_governance.unsuppressed_disposed_students() from public;
revoke all on function infrastructure.read_purge_restore_gate() from public;
revoke all on function infrastructure.begin_purge_restore_gate(uuid, text, timestamptz, jsonb) from public;
revoke all on function infrastructure.complete_purge_restore_gate(uuid, text, timestamptz, text, text, jsonb) from public;
