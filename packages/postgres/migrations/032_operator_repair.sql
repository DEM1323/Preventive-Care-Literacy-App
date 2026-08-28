create function infrastructure.operator_repair_authorized()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.operator_repair', true), '') = '1'
$$;

revoke all on function infrastructure.operator_repair_authorized() from public;

create policy record_productions_operator_repair
  on records_governance.record_productions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  );

create policy record_production_events_operator_repair
  on records_governance.record_production_events
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  );

create policy record_dispositions_operator_repair
  on records_governance.record_dispositions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  );

create policy record_disposition_events_operator_repair
  on records_governance.record_disposition_events
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  );

create policy record_disposition_tasks_operator_repair
  on records_governance.record_disposition_tasks
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and infrastructure.operator_repair_authorized()
  );

create function infrastructure.list_repairable_work()
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(jsonb_agg(item order by recorded_at, work_id), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'workspaceId', outbox.workspace_id,
               'kind', 'invitation_delivery',
               'workId', outbox.outbox_id,
               'failedOperationId', outbox.operation_id,
               'status', case
                 when outbox.status = 'failed' then 'failed'
                 else 'delayed'
               end,
               'recordedAt', to_char(
                 outbox.recorded_at at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'guidance', case
                 when outbox.status = 'failed'
                   then 'RESUME_FAILED_INVITATION_DELIVERY'
                 else 'RESUME_DELAYED_INVITATION_DELIVERY'
               end
             ) as item,
             outbox.recorded_at,
             outbox.outbox_id as work_id
        from infrastructure.outbox outbox
        join identity_access.invitations invitation
          on invitation.invitation_id = (outbox.payload->>'invitationId')::uuid
         and invitation.workspace_id = outbox.workspace_id
        join identity_access.invitation_deliveries delivery
          on delivery.invitation_id = invitation.invitation_id
         and delivery.generation = (outbox.payload->>'generation')::integer
       where outbox.topic = 'invitation.delivery_requested'
         and (
           outbox.status = 'failed'
           or (
             outbox.status in ('pending', 'enqueued')
             and delivery.status = 'sending'
           )
         )
      union all
      select jsonb_build_object(
               'workspaceId', outbox.workspace_id,
               'kind', 'sign_in_delivery',
               'workId', outbox.outbox_id,
               'failedOperationId', outbox.operation_id,
               'status', case
                 when outbox.status = 'failed' then 'failed'
                 else 'delayed'
               end,
               'recordedAt', to_char(
                 outbox.recorded_at at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'guidance', case
                 when outbox.status = 'failed'
                   then 'RESUME_FAILED_SIGN_IN_DELIVERY'
                 else 'RESUME_DELAYED_SIGN_IN_DELIVERY'
               end
             ),
             outbox.recorded_at,
             outbox.outbox_id
        from infrastructure.outbox outbox
        join identity_access.sign_in_deliveries delivery
          on delivery.sign_in_challenge_id = (outbox.payload->>'challengeId')::uuid
         and delivery.generation = (outbox.payload->>'generation')::integer
       where outbox.topic = 'sign_in.delivery_requested'
         and (
           outbox.status = 'failed'
           or (
             outbox.status in ('pending', 'enqueued')
             and delivery.status = 'sending'
           )
         )
      union all
      select jsonb_build_object(
               'workspaceId', outbox.workspace_id,
               'kind', 'record_production_delivery',
               'workId', outbox.outbox_id,
               'failedOperationId', outbox.operation_id,
               'status', case
                 when outbox.status = 'failed' then 'failed'
                 else 'delayed'
               end,
               'recordedAt', to_char(
                 outbox.recorded_at at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'guidance', case
                 when outbox.status = 'failed'
                   then 'RESUME_FAILED_RECORD_PRODUCTION_DELIVERY'
                 else 'RESUME_DELAYED_RECORD_PRODUCTION_DELIVERY'
               end
             ),
             outbox.recorded_at,
             outbox.outbox_id
        from infrastructure.outbox outbox
        join records_governance.record_productions production
          on production.production_id = (outbox.payload->>'productionId')::uuid
         and production.workspace_id = outbox.workspace_id
       where outbox.topic = 'record_production.delivery_requested'
         and outbox.status = 'failed'
         and production.status in ('pending_delivery', 'delivery_failed')
      union all
      select jsonb_build_object(
               'workspaceId', production.workspace_id,
               'kind', 'record_production_cleanup',
               'workId', production.production_id,
               'failedOperationId', production.operation_id,
               'status', 'cleanup_failed',
               'recordedAt', to_char(
                 coalesce(production.removed_at, production.expires_at)
                   at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'guidance', 'RESUME_FAILED_RECORD_PRODUCTION_CLEANUP'
             ),
             coalesce(production.removed_at, production.expires_at),
             production.production_id
        from records_governance.record_productions production
       where production.cleanup_status = 'failed'
      union all
      select jsonb_build_object(
               'workspaceId', task.workspace_id,
               'kind', 'disposition_task',
               'workId', task.task_id,
               'failedOperationId', disposition.operation_id,
               'status', 'failed',
               'recordedAt', to_char(
                 coalesce(
                   disposition.completed_at,
                   disposition.execution_started_at,
                   disposition.scheduled_at
                 ) at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'guidance', 'RESUME_FAILED_DISPOSITION_TASK'
             ),
             coalesce(
               disposition.completed_at,
               disposition.execution_started_at,
               disposition.scheduled_at
             ),
             task.task_id
        from records_governance.record_disposition_tasks task
        join records_governance.record_dispositions disposition
          on disposition.disposition_id = task.disposition_id
       where task.status = 'failed'
          or task.verification = 'failed'
      union all
      select jsonb_build_object(
               'workspaceId', location.workspace_id,
               'kind', 'purge_verification',
               'workId', location.location_id,
               'failedOperationId', disposition.operation_id,
               'status', 'failed',
               'recordedAt', to_char(
                 coalesce(
                   disposition.completed_at,
                   disposition.execution_started_at,
                   disposition.scheduled_at
                 ) at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'guidance', 'RESUME_FAILED_PURGE_VERIFICATION'
             ),
             coalesce(
               disposition.completed_at,
               disposition.execution_started_at,
               disposition.scheduled_at
             ),
             location.location_id
        from records_governance.purge_verification_locations location
        join records_governance.record_dispositions disposition
          on disposition.disposition_id = location.disposition_id
       where location.verification = 'failed'
          or location.deletion = 'failed'
      union all
      select jsonb_build_object(
               'workspaceId', attempt.workspace_id,
               'kind', 'publication_attempt',
               'workId', attempt.operation_id,
               'failedOperationId', attempt.operation_id,
               'status', case
                 when attempt.status = 'failed' then 'failed'
                 else 'delayed'
               end,
               'recordedAt', to_char(
                 attempt.updated_at at time zone 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'guidance', 'RETRY_PUBLICATION_WITH_NEW_OPERATION'
             ),
             attempt.updated_at,
             attempt.operation_id
        from school_configuration.publication_attempts attempt
       where attempt.status in ('preparing', 'failed')
    ) listed
$$;

revoke all on function infrastructure.list_repairable_work() from public;

create function infrastructure.repair_operator_work(
  requested_workspace_id uuid,
  requested_operation_id uuid,
  requested_kind text,
  requested_work_id uuid,
  requested_failed_operation_id uuid,
  requested_actor_id text,
  requested_audit_id uuid,
  requested_repair_outbox_id uuid,
  requested_at timestamptz,
  requested_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  existing jsonb;
  outbox_row infrastructure.outbox%rowtype;
  invitation_row identity_access.invitations%rowtype;
  challenge_row identity_access.invitation_challenges%rowtype;
  delivery_row identity_access.invitation_deliveries%rowtype;
  sign_in_delivery identity_access.sign_in_deliveries%rowtype;
  production_row records_governance.record_productions%rowtype;
  task_row records_governance.record_disposition_tasks%rowtype;
  location_row records_governance.purge_verification_locations%rowtype;
  guidance text;
begin
  if requested_kind not in (
    'invitation_delivery', 'sign_in_delivery', 'record_production_delivery',
    'record_production_cleanup', 'disposition_task', 'purge_verification',
    'publication_attempt'
  ) then
    return jsonb_build_object('outcome', 'not_repairable');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(requested_workspace_id::text || ':' || requested_operation_id::text, 0)
  );

  select result into existing
    from infrastructure.operation_receipts
   where workspace_id = requested_workspace_id
     and operation_id = requested_operation_id
     and command_name = 'repairOperatorWork';
  if found then
    if existing->>'kind' is distinct from requested_kind
       or existing->>'workId' is distinct from requested_work_id::text
       or existing->>'failedOperationId' is distinct from requested_failed_operation_id::text
       or existing->>'workspaceId' is distinct from requested_workspace_id::text then
      return jsonb_build_object('outcome', 'operation_reused');
    end if;
    return jsonb_build_object('outcome', 'replayed', 'result', existing);
  end if;

  if requested_kind = 'publication_attempt' then
    return jsonb_build_object('outcome', 'not_repairable');
  end if;

  if requested_kind in (
    'invitation_delivery', 'sign_in_delivery', 'record_production_delivery'
  ) then
    select * into outbox_row
      from infrastructure.outbox
     where outbox_id = requested_work_id
     for update;
    if not found then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if outbox_row.workspace_id <> requested_workspace_id then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if outbox_row.operation_id <> requested_failed_operation_id then
      return jsonb_build_object('outcome', 'conflict');
    end if;
  end if;

  if requested_kind = 'invitation_delivery' then
    if outbox_row.topic <> 'invitation.delivery_requested' then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    select * into invitation_row
      from identity_access.invitations
     where invitation_id = (outbox_row.payload->>'invitationId')::uuid
     for update;
    select * into challenge_row
      from identity_access.invitation_challenges
     where invitation_id = invitation_row.invitation_id
       and generation = (outbox_row.payload->>'generation')::integer;
    select * into delivery_row
      from identity_access.invitation_deliveries
     where invitation_id = invitation_row.invitation_id
       and generation = (outbox_row.payload->>'generation')::integer
     for update;
    if invitation_row.invitation_id is null
       or challenge_row.invitation_id is null
       or delivery_row.invitation_id is null then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if challenge_row.expires_at <= requested_at
       or challenge_row.completed_at is not null
       or invitation_row.current_generation <> challenge_row.generation
       or invitation_row.status not in ('pending_delivery', 'delivery_failed')
       or delivery_row.status = 'delivered' then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    if outbox_row.status <> 'failed'
       and not (
         outbox_row.status in ('pending', 'enqueued')
         and delivery_row.status = 'sending'
       ) then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    update identity_access.invitation_deliveries
       set status = 'pending', provider_message_id = null, delivered_at = null
     where invitation_id = invitation_row.invitation_id
       and generation = challenge_row.generation;
    update identity_access.invitations
       set status = 'pending_delivery'
     where invitation_id = invitation_row.invitation_id
       and status = 'delivery_failed';
    update infrastructure.outbox
       set status = 'pending'
     where outbox_id = outbox_row.outbox_id;
    guidance := case
      when outbox_row.status = 'failed' then 'RESUME_FAILED_INVITATION_DELIVERY'
      else 'RESUME_DELAYED_INVITATION_DELIVERY'
    end;
  elsif requested_kind = 'sign_in_delivery' then
    if outbox_row.topic <> 'sign_in.delivery_requested' then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    select * into sign_in_delivery
      from identity_access.sign_in_deliveries
     where sign_in_challenge_id = (outbox_row.payload->>'challengeId')::uuid
       and generation = (outbox_row.payload->>'generation')::integer
     for update;
    if sign_in_delivery.sign_in_challenge_id is null then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if sign_in_delivery.status = 'delivered'
       or (
         outbox_row.status <> 'failed'
         and not (
           outbox_row.status in ('pending', 'enqueued')
           and sign_in_delivery.status = 'sending'
         )
       ) then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    update identity_access.sign_in_deliveries
       set status = 'pending', provider_message_id = null, delivered_at = null
     where sign_in_challenge_id = sign_in_delivery.sign_in_challenge_id
       and generation = sign_in_delivery.generation;
    update infrastructure.outbox
       set status = 'pending'
     where outbox_id = outbox_row.outbox_id;
    guidance := case
      when outbox_row.status = 'failed' then 'RESUME_FAILED_SIGN_IN_DELIVERY'
      else 'RESUME_DELAYED_SIGN_IN_DELIVERY'
    end;
  elsif requested_kind = 'record_production_delivery' then
    if outbox_row.topic <> 'record_production.delivery_requested' then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    select * into production_row
      from records_governance.record_productions
     where production_id = (outbox_row.payload->>'productionId')::uuid
     for update;
    if production_row.production_id is null then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if production_row.status not in ('pending_delivery', 'delivery_failed')
       or (
         outbox_row.status <> 'failed'
         and outbox_row.status not in ('pending', 'enqueued')
       ) then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    update records_governance.record_productions
       set status = 'pending_delivery'
     where production_id = production_row.production_id
       and status = 'delivery_failed';
    update infrastructure.outbox
       set status = 'pending'
     where outbox_id = outbox_row.outbox_id;
    guidance := case
      when outbox_row.status = 'failed'
        then 'RESUME_FAILED_RECORD_PRODUCTION_DELIVERY'
      else 'RESUME_DELAYED_RECORD_PRODUCTION_DELIVERY'
    end;
  elsif requested_kind = 'record_production_cleanup' then
    select * into production_row
      from records_governance.record_productions
     where production_id = requested_work_id
       and workspace_id = requested_workspace_id
     for update;
    if production_row.production_id is null then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if production_row.operation_id <> requested_failed_operation_id then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if production_row.cleanup_status <> 'failed' then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    update records_governance.record_productions
       set wrapping_key_id = null,
           wrapped_data_key = null,
           ciphertext = null,
           delivery_key_id = null,
           delivery_ciphertext = null,
           cleanup_status = 'removed',
           removed_at = coalesce(removed_at, requested_at)
     where production_id = production_row.production_id;
    insert into records_governance.record_production_events (
      production_event_id, production_id, workspace_id, student_id, event_kind,
      occurred_at, actor_staff_identity_id, operation_id, details, record_owner,
      record_classification, disposal_class
    ) values (
      gen_random_uuid(), production_row.production_id, production_row.workspace_id,
      production_row.student_id, 'removed', requested_at, null,
      requested_operation_id, jsonb_build_object('outcome', 'removed'),
      'school', 'student_record', 'record_production_event'
    );
    guidance := 'RESUME_FAILED_RECORD_PRODUCTION_CLEANUP';
  elsif requested_kind = 'disposition_task' then
    select * into task_row
      from records_governance.record_disposition_tasks
     where task_id = requested_work_id
       and workspace_id = requested_workspace_id
     for update;
    if task_row.task_id is null then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if task_row.status <> 'failed' and task_row.verification <> 'failed' then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    perform 1
      from records_governance.record_dispositions disposition
     where disposition.disposition_id = task_row.disposition_id
       and disposition.operation_id = requested_failed_operation_id
     for update;
    if not found then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    update records_governance.record_disposition_tasks
       set status = case when status = 'failed' then 'pending' else status end,
           verification = case
             when verification = 'failed' then 'pending' else verification
           end,
           last_error_code = null
     where task_id = task_row.task_id;
    update records_governance.record_dispositions
       set status = 'failed'
     where disposition_id = task_row.disposition_id
       and status = 'failed';
    insert into records_governance.record_disposition_events (
      disposition_event_id, disposition_id, workspace_id, student_id, event_kind,
      occurred_at, actor_staff_identity_id, operation_id, details, record_owner,
      record_classification, disposal_class
    )
    select gen_random_uuid(), task_row.disposition_id, task_row.workspace_id,
           task_row.student_id, 'retry_started', requested_at, null,
           requested_operation_id, jsonb_build_object('taskId', task_row.task_id),
           'school', 'student_record', 'record_disposition_event';
    guidance := 'RESUME_FAILED_DISPOSITION_TASK';
  elsif requested_kind = 'purge_verification' then
    select * into location_row
      from records_governance.purge_verification_locations
     where location_id = requested_work_id
       and workspace_id = requested_workspace_id
     for update;
    if location_row.location_id is null then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    perform 1
      from records_governance.record_dispositions disposition
     where disposition.disposition_id = location_row.disposition_id
       and disposition.operation_id = requested_failed_operation_id
     for update;
    if not found then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if location_row.verification <> 'failed'
       and location_row.deletion <> 'failed' then
      return jsonb_build_object('outcome', 'not_repairable');
    end if;
    update records_governance.purge_verification_locations
       set verification = case
             when verification = 'failed' then 'pending' else verification
           end,
           deletion = case
             when deletion = 'failed' then 'pending' else deletion
           end
     where location_id = location_row.location_id;
    guidance := 'RESUME_FAILED_PURGE_VERIFICATION';
  end if;

  insert into infrastructure.operation_receipts (
    workspace_id, operation_id, command_name, result, recorded_at,
    record_owner, record_classification, disposal_class
  ) values (
    requested_workspace_id, requested_operation_id, 'repairOperatorWork',
    requested_result || jsonb_build_object('guidance', guidance),
    requested_at, 'school', 'operational_evidence', 'operation_receipt'
  );
  insert into audit.evidence (
    audit_id, workspace_id, operation_id, event_type, actor_type, actor_id,
    occurred_at, details, record_owner, record_classification, disposal_class
  ) values (
    requested_audit_id, requested_workspace_id, requested_operation_id,
    'operator.work_repaired', 'technical_operator', requested_actor_id,
    requested_at,
    jsonb_build_object(
      'kind', requested_kind,
      'workId', requested_work_id,
      'failedOperationId', requested_failed_operation_id,
      'guidance', guidance
    ),
    'school', 'audit_evidence', 'workspace_audit_evidence'
  );
  insert into infrastructure.outbox (
    outbox_id, workspace_id, operation_id, topic, payload, status, recorded_at,
    record_owner, record_classification, disposal_class
  ) values (
    requested_repair_outbox_id, requested_workspace_id, requested_operation_id,
    'operator.work_repaired',
    jsonb_build_object(
      'kind', requested_kind,
      'workId', requested_work_id,
      'failedOperationId', requested_failed_operation_id
    ),
    'pending', requested_at,
    'school', 'operational_evidence', 'transactional_outbox'
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'result', requested_result || jsonb_build_object('guidance', guidance)
  );
end
$$;

revoke all on function infrastructure.repair_operator_work(
  uuid, uuid, text, uuid, uuid, text, uuid, uuid, timestamptz, jsonb
) from public;
