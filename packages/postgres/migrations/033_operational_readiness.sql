create table infrastructure.operational_readiness_receipts (
  operation_id uuid primary key,
  command_name text not null,
  request_fingerprint text not null,
  result jsonb not null,
  recorded_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'operation_receipt')
);

alter table infrastructure.operational_readiness_receipts enable row level security;
alter table infrastructure.operational_readiness_receipts force row level security;

create table infrastructure.backup_configuration (
  configuration_id text primary key check (configuration_id = 'default'),
  daily_backups_enabled boolean not null,
  point_in_time_recovery_days integer not null,
  source text not null check (source in ('automated_contract', 'provider_dashboard')),
  evidence_digest text not null,
  status text not null check (status in ('satisfied', 'unsatisfied')),
  actor_id text not null,
  recorded_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'backup_configuration')
);

insert into infrastructure.backup_configuration (
  configuration_id, daily_backups_enabled, point_in_time_recovery_days,
  source, evidence_digest, status, actor_id, recorded_at,
  record_owner, record_classification, disposal_class
) values (
  'default', false, 0, 'automated_contract', '', 'unsatisfied', 'system',
  timestamptz '2026-01-01 00:00:00+00',
  'school', 'operational_evidence', 'backup_configuration'
);

create table infrastructure.restore_runs (
  restore_id uuid primary key,
  succeeded boolean not null,
  source text not null check (source in ('automated_contract', 'provider_restore')),
  actor_id text not null,
  recorded_at timestamptz not null,
  recorded_sequence bigint generated always as identity,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'restore_run')
);

create table infrastructure.operator_alerts (
  alert_id uuid primary key,
  kind text not null check (kind in (
    'uptime', 'application_error', 'database_capacity', 'failed_email'
  )),
  summary text not null,
  destination text not null check (destination = 'technical_operator'),
  acknowledged boolean not null default false,
  acknowledged_by text,
  acknowledged_at timestamptz,
  recorded_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'operator_alert')
);

alter table infrastructure.operator_alerts enable row level security;
alter table infrastructure.operator_alerts force row level security;

create table infrastructure.service_secret_generation (
  singleton boolean primary key check (singleton),
  generation integer not null default 0,
  wrapping_key_id text,
  delivery_key_id text,
  revoked_through integer not null default 0,
  rotated_at timestamptz
);

insert into infrastructure.service_secret_generation (singleton)
values (true);

create table infrastructure.incident_drills (
  incident_id uuid primary key,
  status text not null check (status in (
    'stopped', 'secrets_revoked', 'evidence_preserved', 'repaired',
    'checks_recorded', 'resumed'
  )),
  stopped boolean not null,
  requested_by_type text not null check (requested_by_type in (
    'technical_operator', 'school_nurse'
  )),
  requested_by_id text not null,
  generation_at_stop integer not null default 0,
  secrets_revoked boolean not null default false,
  secret_generation integer not null default 0,
  wrapping_key_id text,
  delivery_key_id text,
  revoked_staff_session_count integer not null default 0,
  revoked_student_session_count integer not null default 0,
  evidence_preserved boolean not null default false,
  repaired boolean not null default false,
  checks jsonb not null default '[]'::jsonb,
  accepted_artifact_digest text,
  current_artifact_digest text,
  resume_authorized_by text,
  resume_authorized_at timestamptz,
  recorded_at timestamptz not null,
  updated_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'incident_drill')
);

alter table infrastructure.incident_drills enable row level security;
alter table infrastructure.incident_drills force row level security;

create table infrastructure.incident_drill_events (
  sequence bigint generated always as identity primary key,
  event_id uuid not null unique,
  incident_id uuid not null references infrastructure.incident_drills(incident_id),
  event_kind text not null,
  actor_type text not null,
  actor_id text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'incident_drill_event')
);

alter table infrastructure.incident_drill_events enable row level security;
alter table infrastructure.incident_drill_events force row level security;

create function infrastructure.reject_incident_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'incident drill events are append-only';
end;
$$;

create trigger incident_drill_events_are_append_only
before update or delete on infrastructure.incident_drill_events
for each row execute function infrastructure.reject_incident_event_mutation();

create function infrastructure.utc_timestamp(value timestamptz)
returns text
language sql
immutable
as $$
  select to_char(value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create function infrastructure.present_incident_drill(
  drill infrastructure.incident_drills
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'incidentId', drill.incident_id,
    'status', drill.status,
    'stopped', drill.stopped,
    'requestedByType', drill.requested_by_type,
    'requestedById', drill.requested_by_id,
    'revokedStaffSessionCount', drill.revoked_staff_session_count,
    'revokedStudentSessionCount', drill.revoked_student_session_count,
    'secretsRevoked', drill.secrets_revoked,
    'secretGeneration', drill.secret_generation,
    'wrappingKeyId', drill.wrapping_key_id,
    'deliveryKeyId', drill.delivery_key_id,
    'acceptedArtifactDigest', drill.accepted_artifact_digest,
    'currentArtifactDigest', drill.current_artifact_digest,
    'checks', drill.checks,
    'resumeAuthorizedBy', drill.resume_authorized_by,
    'recordedAt', infrastructure.utc_timestamp(drill.recorded_at)
  )
$$;

create function infrastructure.claim_operational_receipt(
  requested_operation_id uuid,
  requested_command text,
  requested_fingerprint text,
  requested_result jsonb,
  requested_at timestamptz
) returns jsonb
language plpgsql
as $$
declare
  existing infrastructure.operational_readiness_receipts%rowtype;
begin
  select * into existing
    from infrastructure.operational_readiness_receipts
   where operation_id = requested_operation_id;
  if found then
    if existing.command_name is distinct from requested_command
       or existing.request_fingerprint is distinct from requested_fingerprint then
      return jsonb_build_object('outcome', 'operation_reused');
    end if;
    return jsonb_build_object('outcome', 'replayed', 'result', existing.result);
  end if;
  insert into infrastructure.operational_readiness_receipts (
    operation_id, command_name, request_fingerprint, result, recorded_at,
    record_owner, record_classification, disposal_class
  ) values (
    requested_operation_id, requested_command, requested_fingerprint,
    requested_result, requested_at, 'school', 'operational_evidence',
    'operation_receipt'
  );
  return jsonb_build_object('outcome', 'applied', 'result', requested_result);
end;
$$;

create function infrastructure.read_backup_configuration()
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select case
    when configuration.evidence_digest = '' then null
    else jsonb_build_object(
      'dailyBackupsEnabled', configuration.daily_backups_enabled,
      'pointInTimeRecoveryDays', configuration.point_in_time_recovery_days,
      'source', configuration.source,
      'evidenceDigest', configuration.evidence_digest,
      'status', configuration.status,
      'requiredPointInTimeRecoveryDays', 7
    )
  end
    from infrastructure.backup_configuration configuration
   where configuration.configuration_id = 'default'
$$;

revoke all on function infrastructure.read_backup_configuration() from public;

create function infrastructure.record_backup_configuration(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_daily boolean,
  requested_pitr_days integer,
  requested_source text,
  requested_digest text,
  requested_status text,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  status jsonb;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('backup-configuration', 0));
  status := jsonb_build_object(
    'dailyBackupsEnabled', requested_daily,
    'pointInTimeRecoveryDays', requested_pitr_days,
    'source', requested_source,
    'evidenceDigest', requested_digest,
    'status', requested_status,
    'requiredPointInTimeRecoveryDays', 7
  );
  claimed := infrastructure.claim_operational_receipt(
    requested_operation_id,
    'recordBackupConfiguration',
    requested_daily::text || ':' || requested_pitr_days::text || ':' ||
      requested_source || ':' || requested_digest || ':' || requested_status,
    status,
    requested_at
  );
  if claimed->>'outcome' <> 'applied' then
    return claimed;
  end if;
  update infrastructure.backup_configuration
     set daily_backups_enabled = requested_daily,
         point_in_time_recovery_days = requested_pitr_days,
         source = requested_source,
         evidence_digest = requested_digest,
         status = requested_status,
         actor_id = requested_actor_id,
         recorded_at = requested_at
   where configuration_id = 'default';
  return claimed;
end;
$$;

revoke all on function infrastructure.record_backup_configuration(
  uuid, text, boolean, integer, text, text, text, timestamptz
) from public;

create function infrastructure.read_restore_run()
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'succeeded', restore.succeeded,
    'recordedAt', infrastructure.utc_timestamp(restore.recorded_at)
  )
    from infrastructure.restore_runs restore
   order by restore.recorded_sequence desc
   limit 1
$$;

revoke all on function infrastructure.read_restore_run() from public;

create function infrastructure.record_restore_run(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_succeeded boolean,
  requested_source text,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  restore_id uuid := gen_random_uuid();
  payload jsonb;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('restore-run', 0));
  payload := jsonb_build_object(
    'succeeded', requested_succeeded,
    'recordedAt', infrastructure.utc_timestamp(requested_at)
  );
  claimed := infrastructure.claim_operational_receipt(
    requested_operation_id,
    'recordRestoreRun',
    requested_succeeded::text || ':' || requested_source,
    payload,
    requested_at
  );
  if claimed->>'outcome' <> 'applied' then
    return claimed;
  end if;
  insert into infrastructure.restore_runs (
    restore_id, succeeded, source, actor_id, recorded_at,
    record_owner, record_classification, disposal_class
  ) values (
    restore_id, requested_succeeded, requested_source, requested_actor_id,
    requested_at, 'school', 'operational_evidence', 'restore_run'
  );
  return claimed;
end;
$$;

revoke all on function infrastructure.record_restore_run(
  uuid, text, boolean, text, timestamptz
) from public;

create function infrastructure.list_operator_alerts()
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(jsonb_agg(item order by recorded_at, alert_id), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'alertId', alert.alert_id,
        'kind', alert.kind,
        'summary', alert.summary,
        'destination', alert.destination,
        'acknowledged', alert.acknowledged,
        'acknowledgedBy', alert.acknowledged_by,
        'recordedAt', infrastructure.utc_timestamp(alert.recorded_at)
      ) as item,
      alert.recorded_at,
      alert.alert_id
        from infrastructure.operator_alerts alert
    ) listed
$$;

revoke all on function infrastructure.list_operator_alerts() from public;

create function infrastructure.emit_operator_alert(
  requested_alert_id uuid,
  requested_kind text,
  requested_summary text,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  insert into infrastructure.operator_alerts (
    alert_id, kind, summary, destination, acknowledged, recorded_at,
    record_owner, record_classification, disposal_class
  ) values (
    requested_alert_id, requested_kind, requested_summary, 'technical_operator',
    false, requested_at, 'school', 'operational_evidence', 'operator_alert'
  );
  return jsonb_build_object(
    'alertId', requested_alert_id,
    'kind', requested_kind,
    'summary', requested_summary,
    'destination', 'technical_operator',
    'acknowledged', false,
    'recordedAt', infrastructure.utc_timestamp(requested_at)
  );
end;
$$;

revoke all on function infrastructure.emit_operator_alert(
  uuid, text, text, timestamptz
) from public;

create function infrastructure.acknowledge_operator_alert(
  requested_operation_id uuid,
  requested_alert_id uuid,
  requested_actor_id text,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  alert infrastructure.operator_alerts%rowtype;
  payload jsonb;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(requested_alert_id::text, 0));
  select * into alert
    from infrastructure.operator_alerts
   where alert_id = requested_alert_id
     for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  payload := jsonb_build_object(
    'alertId', alert.alert_id,
    'kind', alert.kind,
    'summary', alert.summary,
    'destination', 'technical_operator',
    'acknowledged', true,
    'acknowledgedBy', coalesce(alert.acknowledged_by, requested_actor_id),
    'recordedAt', infrastructure.utc_timestamp(alert.recorded_at)
  );
  claimed := infrastructure.claim_operational_receipt(
    requested_operation_id,
    'acknowledgeOperatorAlert',
    requested_alert_id::text,
    payload,
    requested_at
  );
  if claimed->>'outcome' <> 'applied' then
    return claimed;
  end if;
  if not alert.acknowledged then
    update infrastructure.operator_alerts
       set acknowledged = true,
           acknowledged_by = requested_actor_id,
           acknowledged_at = requested_at
     where alert_id = requested_alert_id;
    payload := jsonb_set(payload, '{acknowledgedBy}', to_jsonb(requested_actor_id));
    update infrastructure.operational_readiness_receipts
       set result = payload
     where operation_id = requested_operation_id;
  end if;
  return jsonb_build_object('outcome', 'applied', 'result', payload);
end;
$$;

revoke all on function infrastructure.acknowledge_operator_alert(
  uuid, uuid, text, timestamptz
) from public;

create function infrastructure.activity_is_stopped()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from infrastructure.incident_drills where stopped
  )
$$;

revoke all on function infrastructure.activity_is_stopped() from public;

create function infrastructure.read_incident_drill()
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select infrastructure.present_incident_drill(drill)
    from infrastructure.incident_drills drill
   order by drill.recorded_at desc
   limit 1
$$;

revoke all on function infrastructure.read_incident_drill() from public;

create function infrastructure.request_incident_stop(
  requested_operation_id uuid,
  requested_incident_id uuid,
  requested_actor_type text,
  requested_actor_id text,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  existing infrastructure.incident_drills%rowtype;
  secrets infrastructure.service_secret_generation%rowtype;
  payload jsonb;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('incident-drill', 0));
  select * into existing
    from infrastructure.incident_drills
   where stopped
   order by recorded_at desc
   limit 1
     for update;
  if existing.incident_id is not null then
    payload := infrastructure.present_incident_drill(existing);
    claimed := infrastructure.claim_operational_receipt(
      requested_operation_id,
      'requestIncidentStop',
      existing.incident_id::text || ':' || requested_actor_type || ':' ||
        requested_actor_id,
      payload,
      requested_at
    );
    if claimed->>'outcome' = 'operation_reused' then
      return claimed;
    end if;
    if claimed->>'outcome' = 'replayed' then
      return claimed;
    end if;
    return jsonb_build_object('outcome', 'applied', 'result', payload);
  end if;
  select * into secrets from infrastructure.service_secret_generation
   where singleton
     for update;
  insert into infrastructure.incident_drills (
    incident_id, status, stopped, requested_by_type, requested_by_id,
    generation_at_stop, recorded_at, updated_at,
    record_owner, record_classification, disposal_class
  ) values (
    requested_incident_id, 'stopped', true, requested_actor_type,
    requested_actor_id, secrets.generation, requested_at, requested_at,
    'school', 'operational_evidence', 'incident_drill'
  );
  insert into infrastructure.incident_drill_events (
    event_id, incident_id, event_kind, actor_type, actor_id, details,
    occurred_at, record_owner, record_classification, disposal_class
  ) values (
    gen_random_uuid(), requested_incident_id, 'stopped', requested_actor_type,
    requested_actor_id, jsonb_build_object('status', 'stopped'),
    requested_at, 'school', 'operational_evidence', 'incident_drill_event'
  );
  select * into existing
    from infrastructure.incident_drills
   where incident_id = requested_incident_id;
  payload := infrastructure.present_incident_drill(existing);
  return infrastructure.claim_operational_receipt(
    requested_operation_id,
    'requestIncidentStop',
    requested_incident_id::text || ':' || requested_actor_type || ':' ||
      requested_actor_id,
    payload,
    requested_at
  );
end;
$$;

revoke all on function infrastructure.request_incident_stop(
  uuid, uuid, text, text, timestamptz
) from public;

create function infrastructure.revoke_incident_access(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_wrapping_key_id text,
  requested_delivery_key_id text,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  drill infrastructure.incident_drills%rowtype;
  staff_count integer;
  student_count integer;
  next_generation integer;
  payload jsonb;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('incident-drill', 0));
  select * into drill
    from infrastructure.incident_drills
   where stopped
   order by recorded_at desc
   limit 1
     for update;
  if drill.incident_id is null then
    return jsonb_build_object('outcome', 'not_stopped');
  end if;
  payload := infrastructure.present_incident_drill(drill);
  claimed := infrastructure.claim_operational_receipt(
    requested_operation_id,
    'revokeIncidentAccess',
    drill.incident_id::text || ':' || requested_wrapping_key_id || ':' ||
      requested_delivery_key_id,
    payload,
    requested_at
  );
  if claimed->>'outcome' = 'replayed' then
    return claimed;
  end if;
  if claimed->>'outcome' = 'operation_reused' then
    return claimed;
  end if;
  update identity_access.staff_sessions
     set revoked_at = requested_at
   where revoked_at is null;
  get diagnostics staff_count = row_count;
  update identity_access.student_sessions
     set revoked_at = requested_at
   where revoked_at is null;
  get diagnostics student_count = row_count;
  update infrastructure.service_secret_generation
     set revoked_through = generation,
         generation = generation + 1,
         wrapping_key_id = requested_wrapping_key_id,
         delivery_key_id = requested_delivery_key_id,
         rotated_at = requested_at
   where singleton
   returning generation into next_generation;
  update infrastructure.incident_drills
     set status = 'secrets_revoked',
         secrets_revoked = true,
         secret_generation = next_generation,
         wrapping_key_id = requested_wrapping_key_id,
         delivery_key_id = requested_delivery_key_id,
         revoked_staff_session_count = staff_count,
         revoked_student_session_count = student_count,
         updated_at = requested_at
   where incident_id = drill.incident_id;
  insert into infrastructure.incident_drill_events (
    event_id, incident_id, event_kind, actor_type, actor_id, details,
    occurred_at, record_owner, record_classification, disposal_class
  ) values (
    gen_random_uuid(), drill.incident_id, 'secrets_revoked', 'technical_operator',
    requested_actor_id,
    jsonb_build_object(
      'revokedStaffSessionCount', staff_count,
      'revokedStudentSessionCount', student_count,
      'secretGeneration', next_generation
    ),
    requested_at, 'school', 'operational_evidence', 'incident_drill_event'
  );
  select * into drill from infrastructure.incident_drills
   where incident_id = drill.incident_id;
  payload := infrastructure.present_incident_drill(drill);
  update infrastructure.operational_readiness_receipts
     set result = payload
   where operation_id = requested_operation_id;
  return jsonb_build_object('outcome', 'applied', 'result', payload);
end;
$$;

revoke all on function infrastructure.revoke_incident_access(
  uuid, text, text, text, timestamptz
) from public;

create function infrastructure.preserve_incident_evidence(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  drill infrastructure.incident_drills%rowtype;
  payload jsonb;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('incident-drill', 0));
  select * into drill
    from infrastructure.incident_drills
   where stopped
   order by recorded_at desc
   limit 1
     for update;
  if drill.incident_id is null or drill.status not in (
    'secrets_revoked', 'evidence_preserved', 'repaired', 'checks_recorded'
  ) then
    return jsonb_build_object('outcome', 'sequence_required');
  end if;
  payload := infrastructure.present_incident_drill(drill);
  claimed := infrastructure.claim_operational_receipt(
    requested_operation_id,
    'preserveIncidentEvidence',
    drill.incident_id::text,
    payload,
    requested_at
  );
  if claimed->>'outcome' <> 'applied' then
    return claimed;
  end if;
  update infrastructure.incident_drills
     set status = 'evidence_preserved',
         evidence_preserved = true,
         updated_at = requested_at
   where incident_id = drill.incident_id;
  insert into infrastructure.incident_drill_events (
    event_id, incident_id, event_kind, actor_type, actor_id, details,
    occurred_at, record_owner, record_classification, disposal_class
  ) values (
    gen_random_uuid(), drill.incident_id, 'evidence_preserved',
    'technical_operator', requested_actor_id,
    jsonb_build_object(
      'incidentId', drill.incident_id,
      'revokedStaffSessionCount', drill.revoked_staff_session_count,
      'revokedStudentSessionCount', drill.revoked_student_session_count,
      'secretGeneration', drill.secret_generation
    ),
    requested_at, 'school', 'operational_evidence', 'incident_drill_event'
  );
  select * into drill from infrastructure.incident_drills
   where incident_id = drill.incident_id;
  payload := infrastructure.present_incident_drill(drill);
  update infrastructure.operational_readiness_receipts
     set result = payload
   where operation_id = requested_operation_id;
  return jsonb_build_object('outcome', 'applied', 'result', payload);
end;
$$;

revoke all on function infrastructure.preserve_incident_evidence(
  uuid, text, timestamptz
) from public;

create function infrastructure.record_incident_repair(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  drill infrastructure.incident_drills%rowtype;
  payload jsonb;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('incident-drill', 0));
  select * into drill
    from infrastructure.incident_drills
   where stopped
   order by recorded_at desc
   limit 1
     for update;
  if drill.incident_id is null or drill.status not in (
    'evidence_preserved', 'repaired', 'checks_recorded'
  ) then
    return jsonb_build_object('outcome', 'sequence_required');
  end if;
  payload := infrastructure.present_incident_drill(drill);
  claimed := infrastructure.claim_operational_receipt(
    requested_operation_id,
    'recordIncidentRepair',
    drill.incident_id::text,
    payload,
    requested_at
  );
  if claimed->>'outcome' <> 'applied' then
    return claimed;
  end if;
  update infrastructure.incident_drills
     set status = 'repaired',
         repaired = true,
         updated_at = requested_at
   where incident_id = drill.incident_id;
  insert into infrastructure.incident_drill_events (
    event_id, incident_id, event_kind, actor_type, actor_id, details,
    occurred_at, record_owner, record_classification, disposal_class
  ) values (
    gen_random_uuid(), drill.incident_id, 'repaired', 'technical_operator',
    requested_actor_id, jsonb_build_object('outcome', 'repaired'),
    requested_at, 'school', 'operational_evidence', 'incident_drill_event'
  );
  select * into drill from infrastructure.incident_drills
   where incident_id = drill.incident_id;
  payload := infrastructure.present_incident_drill(drill);
  update infrastructure.operational_readiness_receipts
     set result = payload
   where operation_id = requested_operation_id;
  return jsonb_build_object('outcome', 'applied', 'result', payload);
end;
$$;

revoke all on function infrastructure.record_incident_repair(
  uuid, text, timestamptz
) from public;

create function infrastructure.record_incident_checks(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_checks jsonb,
  requested_accepted_digest text,
  requested_current_digest text,
  requested_wrapping_key_id text,
  requested_delivery_key_id text,
  requested_secret_generation integer,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  drill infrastructure.incident_drills%rowtype;
  payload jsonb;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('incident-drill', 0));
  select * into drill
    from infrastructure.incident_drills
   where stopped
   order by recorded_at desc
   limit 1
     for update;
  if drill.incident_id is null or drill.status not in (
    'repaired', 'checks_recorded'
  ) then
    return jsonb_build_object('outcome', 'sequence_required');
  end if;
  payload := infrastructure.present_incident_drill(drill);
  claimed := infrastructure.claim_operational_receipt(
    requested_operation_id,
    'recordIncidentChecks',
    drill.incident_id::text || ':' || requested_checks::text,
    payload,
    requested_at
  );
  if claimed->>'outcome' <> 'applied' then
    return claimed;
  end if;
  update infrastructure.incident_drills
     set status = 'checks_recorded',
         checks = requested_checks,
         accepted_artifact_digest = requested_accepted_digest,
         current_artifact_digest = requested_current_digest,
         updated_at = requested_at
   where incident_id = drill.incident_id;
  insert into infrastructure.incident_drill_events (
    event_id, incident_id, event_kind, actor_type, actor_id, details,
    occurred_at, record_owner, record_classification, disposal_class
  ) values (
    gen_random_uuid(), drill.incident_id, 'checks_recorded',
    'technical_operator', requested_actor_id,
    jsonb_build_object(
      'checks', requested_checks,
      'acceptedArtifactDigest', requested_accepted_digest,
      'currentArtifactDigest', requested_current_digest,
      'processSecretGeneration', requested_secret_generation,
      'processWrappingKeyId', requested_wrapping_key_id,
      'processDeliveryKeyId', requested_delivery_key_id
    ),
    requested_at, 'school', 'operational_evidence', 'incident_drill_event'
  );
  select * into drill from infrastructure.incident_drills
   where incident_id = drill.incident_id;
  payload := infrastructure.present_incident_drill(drill);
  update infrastructure.operational_readiness_receipts
     set result = payload
   where operation_id = requested_operation_id;
  return jsonb_build_object('outcome', 'applied', 'result', payload);
end;
$$;

revoke all on function infrastructure.record_incident_checks(
  uuid, text, jsonb, text, text, text, text, integer, timestamptz
) from public;

create function infrastructure.authorize_incident_resume(
  requested_operation_id uuid,
  requested_actor_id text,
  requested_wrapping_key_id text,
  requested_delivery_key_id text,
  requested_secret_generation integer,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  drill infrastructure.incident_drills%rowtype;
  existing_receipt infrastructure.operational_readiness_receipts%rowtype;
  gate_status text;
  backup_status text;
  restore_succeeded boolean;
  payload jsonb;
  claimed jsonb;
  failed boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('incident-drill', 0));
  select * into existing_receipt
    from infrastructure.operational_readiness_receipts
   where operation_id = requested_operation_id
     and command_name = 'authorizeIncidentResume';
  if found then
    return jsonb_build_object('outcome', 'replayed', 'result', existing_receipt.result);
  end if;
  select * into drill
    from infrastructure.incident_drills
   where stopped
   order by recorded_at desc
   limit 1
     for update;
  if drill.incident_id is null then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_NOT_STOPPED');
  end if;
  payload := infrastructure.present_incident_drill(drill);
  claimed := infrastructure.claim_operational_receipt(
    requested_operation_id,
    'authorizeIncidentResume',
    drill.incident_id::text || ':' || requested_actor_id,
    payload,
    requested_at
  );
  if claimed->>'outcome' = 'replayed' then
    return claimed;
  end if;
  if claimed->>'outcome' = 'operation_reused' then
    return claimed;
  end if;
  if not drill.secrets_revoked then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_SECRETS_NOT_REVOKED');
  end if;
  if not drill.evidence_preserved then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_EVIDENCE_NOT_PRESERVED');
  end if;
  if not drill.repaired then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_NOT_REPAIRED');
  end if;
  if drill.status <> 'checks_recorded' then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_SEQUENCE_REQUIRED');
  end if;
  select exists (
    select 1
      from jsonb_array_elements(drill.checks) check_row
     where check_row->>'outcome' is distinct from 'passed'
  ) into failed;
  if failed or jsonb_array_length(drill.checks) < 4 then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_CHECKS_FAILED');
  end if;
  if drill.wrapping_key_id is distinct from requested_wrapping_key_id
     or drill.delivery_key_id is distinct from requested_delivery_key_id
     or drill.secret_generation is distinct from requested_secret_generation
     or drill.secret_generation <= drill.generation_at_stop then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_STALE_SECRETS');
  end if;
  if drill.accepted_artifact_digest is distinct from drill.current_artifact_digest
     or drill.accepted_artifact_digest is null then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_ARTIFACT_MISMATCH');
  end if;
  select gate.status into gate_status
    from infrastructure.purge_restore_gate gate
   where gate.gate_id = 'default';
  select configuration.status into backup_status
    from infrastructure.backup_configuration configuration
   where configuration.configuration_id = 'default';
  select restore.succeeded into restore_succeeded
    from infrastructure.restore_runs restore
   order by restore.recorded_sequence desc
   limit 1;
  if gate_status in ('pending', 'failed')
     or (restore_succeeded is true and gate_status is distinct from 'verified')
     or backup_status is distinct from 'satisfied' then
    return jsonb_build_object('outcome', 'blocked', 'code', 'INCIDENT_PURGE_OBLIGATION');
  end if;
  update infrastructure.incident_drills
     set status = 'resumed',
         stopped = false,
         resume_authorized_by = requested_actor_id,
         resume_authorized_at = requested_at,
         updated_at = requested_at
   where incident_id = drill.incident_id;
  insert into infrastructure.incident_drill_events (
    event_id, incident_id, event_kind, actor_type, actor_id, details,
    occurred_at, record_owner, record_classification, disposal_class
  ) values (
    gen_random_uuid(), drill.incident_id, 'resumed', 'technical_operator',
    requested_actor_id, jsonb_build_object('authorized', true),
    requested_at, 'school', 'operational_evidence', 'incident_drill_event'
  );
  select * into drill from infrastructure.incident_drills
   where incident_id = drill.incident_id;
  payload := infrastructure.present_incident_drill(drill);
  update infrastructure.operational_readiness_receipts
     set result = payload
   where operation_id = requested_operation_id;
  return jsonb_build_object('outcome', 'applied', 'result', payload);
end;
$$;

revoke all on function infrastructure.authorize_incident_resume(
  uuid, text, text, text, integer, timestamptz
) from public;
