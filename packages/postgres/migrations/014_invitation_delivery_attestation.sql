create table infrastructure.invitation_delivery_attestations (
  invitation_id uuid primary key,
  artifact_digest text not null check (artifact_digest ~ '^[0-9a-f]{64}$'),
  envelope_adapter text not null check (envelope_adapter = 'application-layer-envelope/v1'),
  recorded_at timestamptz not null
);

alter table infrastructure.invitation_delivery_attestations enable row level security;
alter table infrastructure.invitation_delivery_attestations force row level security;

create function infrastructure.record_invitation_delivery_attestation(
  requested_invitation_id uuid,
  requested_digest text,
  requested_adapter text,
  requested_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_invitation_id is null then
    raise exception 'invitation delivery attestation requires an invitation';
  end if;
  if requested_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'worker artifact digest is malformed';
  end if;
  if requested_adapter <> 'application-layer-envelope/v1' then
    raise exception 'worker envelope adapter is unexpected';
  end if;
  insert into infrastructure.invitation_delivery_attestations (
    invitation_id, artifact_digest, envelope_adapter, recorded_at
  ) values (
    requested_invitation_id, requested_digest, requested_adapter, requested_at
  )
  on conflict (invitation_id) do update set
    artifact_digest = excluded.artifact_digest,
    envelope_adapter = excluded.envelope_adapter,
    recorded_at = excluded.recorded_at;
end;
$$;

drop function if exists infrastructure.golden_journey_operator_evidence(uuid, uuid, uuid, uuid, uuid);

create function infrastructure.golden_journey_operator_evidence(
  requested_workspace_id uuid,
  requested_invitation_id uuid,
  requested_publish_operation_id uuid,
  requested_invitation_operation_id uuid,
  requested_intake_operation_id uuid,
  requested_learning_operation_id uuid,
  requested_isolation_workspace_id uuid,
  requested_student_id uuid,
  requested_started_at timestamptz
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select requested_started_at - interval '30 seconds' as earliest
  )
  select jsonb_build_object(
    'invitationStatus', (
      select status from identity_access.invitations
       where invitation_id = requested_invitation_id
         and workspace_id = requested_workspace_id
    ),
    'workerArtifactDigest', (
      select artifact_digest
        from infrastructure.invitation_delivery_attestations
       where invitation_id = requested_invitation_id
         and recorded_at >= (select earliest from bounds)
    ),
    'workerEnvelopeAdapter', (
      select envelope_adapter
        from infrastructure.invitation_delivery_attestations
       where invitation_id = requested_invitation_id
         and recorded_at >= (select earliest from bounds)
    ),
    'workerRecordedAt', (
      select to_char(recorded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from infrastructure.invitation_delivery_attestations
       where invitation_id = requested_invitation_id
         and recorded_at >= (select earliest from bounds)
    ),
    'publishReleaseId', (
      select result->>'releaseId'
        from infrastructure.operation_receipts
       where workspace_id = requested_workspace_id
         and operation_id = requested_publish_operation_id
         and command_name = 'publishSchoolConfigurationRelease'
         and recorded_at >= (select earliest from bounds)
    ),
    'publishPackageDigest', (
      select package_digest
        from school_configuration.release_packages
       where workspace_id = requested_workspace_id
         and operation_id = requested_publish_operation_id
    ),
    'publishReleaseNumber', (
      select releases.release_number::int
        from school_configuration.release_packages packages
        join school_configuration.configuration_releases releases
          on releases.release_id = packages.release_id
       where packages.workspace_id = requested_workspace_id
         and packages.operation_id = requested_publish_operation_id
    ),
    'publishAuditCount', (
      select count(*)::int from audit.evidence
       where workspace_id = requested_workspace_id
         and operation_id = requested_publish_operation_id
         and event_type = 'school_configuration_release.published'
         and occurred_at >= (select earliest from bounds)
    ),
    'publishOutboxCount', (
      select count(*)::int from infrastructure.outbox
       where workspace_id = requested_workspace_id
         and operation_id = requested_publish_operation_id
         and recorded_at >= (select earliest from bounds)
    ),
    'publishReceiptCount', (
      select count(*)::int from infrastructure.operation_receipts
       where workspace_id = requested_workspace_id
         and operation_id = requested_publish_operation_id
         and command_name = 'publishSchoolConfigurationRelease'
         and recorded_at >= (select earliest from bounds)
    ),
    'publishOccurredAt', (
      select to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from audit.evidence
       where workspace_id = requested_workspace_id
         and operation_id = requested_publish_operation_id
         and event_type = 'school_configuration_release.published'
         and occurred_at >= (select earliest from bounds)
       order by occurred_at desc
       limit 1
    ),
    'invitationAuditCount', (
      select count(*)::int from audit.evidence
       where workspace_id = requested_workspace_id
         and operation_id = requested_invitation_operation_id
         and event_type = 'class_invitation.created'
         and occurred_at >= (select earliest from bounds)
    ),
    'invitationOutboxCount', (
      select count(*)::int from infrastructure.outbox
       where workspace_id = requested_workspace_id
         and operation_id = requested_invitation_operation_id
         and recorded_at >= (select earliest from bounds)
    ),
    'invitationReceiptCount', (
      select count(*)::int from infrastructure.operation_receipts
       where workspace_id = requested_workspace_id
         and operation_id = requested_invitation_operation_id
         and command_name = 'createClassInvitation'
         and recorded_at >= (select earliest from bounds)
    ),
    'invitationOccurredAt', (
      select to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from audit.evidence
       where workspace_id = requested_workspace_id
         and operation_id = requested_invitation_operation_id
         and event_type = 'class_invitation.created'
         and occurred_at >= (select earliest from bounds)
       order by occurred_at desc
       limit 1
    ),
    'intakeReceiptCount', (
      select count(*)::int from intake.intake_operation_receipts
       where workspace_id = requested_workspace_id
         and student_id = requested_student_id
         and operation_id = requested_intake_operation_id
         and command_name = 'submitIntakeRecordVersion'
         and recorded_at >= (select earliest from bounds)
    ),
    'intakeEntityId', (
      select result->>'intakeRecordVersionId'
        from intake.intake_operation_receipts
       where workspace_id = requested_workspace_id
         and student_id = requested_student_id
         and operation_id = requested_intake_operation_id
         and command_name = 'submitIntakeRecordVersion'
         and recorded_at >= (select earliest from bounds)
    ),
    'intakeOccurredAt', (
      select to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from audit.evidence
       where workspace_id = requested_workspace_id
         and operation_id = requested_intake_operation_id
         and event_type = 'intake_record_version.accepted'
         and occurred_at >= (select earliest from bounds)
       order by occurred_at desc
       limit 1
    ),
    'learningReceiptCount', (
      select count(*)::int from learning_progress.item_completion_receipts
       where workspace_id = requested_workspace_id
         and student_id = requested_student_id
         and operation_id = requested_learning_operation_id
         and command_name = 'acknowledgeLearningItem'
         and recorded_at >= (select earliest from bounds)
    ),
    'learningEntityId', (
      select result->>'itemCompletionId'
        from learning_progress.item_completion_receipts
       where workspace_id = requested_workspace_id
         and student_id = requested_student_id
         and operation_id = requested_learning_operation_id
         and command_name = 'acknowledgeLearningItem'
         and recorded_at >= (select earliest from bounds)
    ),
    'learningOccurredAt', (
      select to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from audit.evidence
       where workspace_id = requested_workspace_id
         and operation_id = requested_learning_operation_id
         and event_type = 'item_completion.accepted'
         and occurred_at >= (select earliest from bounds)
       order by occurred_at desc
       limit 1
    ),
    'clinicalRevealAuditCount', (
      select count(*)::int from audit.evidence
       where workspace_id = requested_workspace_id
         and event_type = 'intake_record.revealed'
         and details->>'studentId' = requested_student_id::text
         and occurred_at >= (select earliest from bounds)
    ),
    'clinicalRevealOccurredAt', (
      select to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from audit.evidence
       where workspace_id = requested_workspace_id
         and event_type = 'intake_record.revealed'
         and details->>'studentId' = requested_student_id::text
         and occurred_at >= (select earliest from bounds)
       order by occurred_at desc
       limit 1
    ),
    'clinicalDenialAuditCount', (
      select count(*)::int from audit.evidence
       where workspace_id = requested_isolation_workspace_id
         and event_type = 'intake_record.reveal_denied'
         and details->>'studentId' = requested_student_id::text
         and occurred_at >= (select earliest from bounds)
    ),
    'clinicalDenialOccurredAt', (
      select to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from audit.evidence
       where workspace_id = requested_isolation_workspace_id
         and event_type = 'intake_record.reveal_denied'
         and details->>'studentId' = requested_student_id::text
         and occurred_at >= (select earliest from bounds)
       order by occurred_at desc
       limit 1
    ),
    'unattributedDenialCount', (
      select count(*)::int from audit.security_events
       where event_type = 'intake_record.reveal_denied'
         and details->>'studentId' = requested_student_id::text
         and occurred_at >= (select earliest from bounds)
    ),
    'unattributedDenialOccurredAt', (
      select to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        from audit.security_events
       where event_type = 'intake_record.reveal_denied'
         and details->>'studentId' = requested_student_id::text
         and occurred_at >= (select earliest from bounds)
       order by occurred_at desc
       limit 1
    )
  );
$$;

revoke all on table infrastructure.invitation_delivery_attestations from public;
revoke all on function infrastructure.record_invitation_delivery_attestation(uuid, text, text, timestamptz) from public;
revoke all on function infrastructure.golden_journey_operator_evidence(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz) from public;
