create table infrastructure.worker_artifact_heartbeats (
  worker_kind text primary key check (worker_kind = 'invitation-delivery'),
  artifact_digest text not null check (artifact_digest ~ '^[0-9a-f]{64}$'),
  envelope_adapter text not null check (envelope_adapter = 'application-layer-envelope/v1'),
  invitation_id uuid,
  recorded_at timestamptz not null
);

alter table infrastructure.worker_artifact_heartbeats enable row level security;
alter table infrastructure.worker_artifact_heartbeats force row level security;

create function infrastructure.record_worker_artifact_heartbeat(
  requested_digest text,
  requested_adapter text,
  requested_invitation_id uuid,
  requested_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'worker artifact digest is malformed';
  end if;
  if requested_adapter <> 'application-layer-envelope/v1' then
    raise exception 'worker envelope adapter is unexpected';
  end if;
  insert into infrastructure.worker_artifact_heartbeats (
    worker_kind, artifact_digest, envelope_adapter, invitation_id, recorded_at
  ) values (
    'invitation-delivery', requested_digest, requested_adapter,
    requested_invitation_id, requested_at
  )
  on conflict (worker_kind) do update set
    artifact_digest = excluded.artifact_digest,
    envelope_adapter = excluded.envelope_adapter,
    invitation_id = excluded.invitation_id,
    recorded_at = excluded.recorded_at;
end;
$$;

create function infrastructure.golden_journey_operator_evidence(
  requested_workspace_id uuid,
  requested_invitation_id uuid,
  requested_publish_operation_id uuid,
  requested_intake_operation_id uuid,
  requested_learning_operation_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'auditRowCount', (
      select count(*)::int from audit.evidence
       where workspace_id = requested_workspace_id
    ),
    'outboxCompletedCount', (
      select count(*)::int from infrastructure.outbox
       where workspace_id = requested_workspace_id
         and status = 'completed'
    ),
    'invitationStatus', (
      select status from identity_access.invitations
       where invitation_id = requested_invitation_id
         and workspace_id = requested_workspace_id
    ),
    'workerArtifactDigest', (
      select artifact_digest from infrastructure.worker_artifact_heartbeats
       where worker_kind = 'invitation-delivery'
    ),
    'workerEnvelopeAdapter', (
      select envelope_adapter from infrastructure.worker_artifact_heartbeats
       where worker_kind = 'invitation-delivery'
    ),
    'workerRecordedAt', (
      select to_char(recorded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from infrastructure.worker_artifact_heartbeats
       where worker_kind = 'invitation-delivery'
    ),
    'releaseId', (
      select active_release_id::text from school_configuration.configuration_states
       where workspace_id = requested_workspace_id
    ),
    'packageDigest', (
      select package_digest from school_configuration.release_packages
       where workspace_id = requested_workspace_id
         and operation_id = requested_publish_operation_id
    ),
    'releaseNumber', (
      select releases.release_number::int
        from school_configuration.release_packages packages
        join school_configuration.configuration_releases releases
          on releases.release_id = packages.release_id
       where packages.workspace_id = requested_workspace_id
         and packages.operation_id = requested_publish_operation_id
    ),
    'intakeReceiptPresent', exists(
      select 1 from infrastructure.operation_receipts
       where workspace_id = requested_workspace_id
         and operation_id = requested_intake_operation_id
    ),
    'learningReceiptPresent', exists(
      select 1 from infrastructure.operation_receipts
       where workspace_id = requested_workspace_id
         and operation_id = requested_learning_operation_id
    )
  );
$$;

revoke all on table infrastructure.worker_artifact_heartbeats from public;
revoke all on function infrastructure.record_worker_artifact_heartbeat(text, text, uuid, timestamptz) from public;
revoke all on function infrastructure.golden_journey_operator_evidence(uuid, uuid, uuid, uuid, uuid) from public;
