create table infrastructure.acceptance_campaign_receipts (
  operation_id uuid primary key,
  command_name text not null,
  request_fingerprint text not null,
  result jsonb not null,
  recorded_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'operation_receipt')
);

alter table infrastructure.acceptance_campaign_receipts enable row level security;
alter table infrastructure.acceptance_campaign_receipts force row level security;

create table infrastructure.acceptance_campaigns (
  campaign_id uuid primary key,
  artifact_digest text not null,
  environment_host text not null,
  school_configuration_release_id uuid not null,
  synthetic_identity_set_id uuid not null,
  snapshot jsonb not null,
  active boolean not null default true,
  actor_id text not null,
  recorded_at timestamptz not null,
  updated_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'acceptance_campaign')
);

alter table infrastructure.acceptance_campaigns enable row level security;
alter table infrastructure.acceptance_campaigns force row level security;

create table infrastructure.acceptance_campaign_events (
  sequence bigint generated always as identity primary key,
  event_id uuid not null unique,
  campaign_id uuid not null references infrastructure.acceptance_campaigns(campaign_id),
  event_kind text not null,
  actor_id text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'acceptance_campaign_event')
);

alter table infrastructure.acceptance_campaign_events enable row level security;
alter table infrastructure.acceptance_campaign_events force row level security;

create function infrastructure.reject_acceptance_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'acceptance campaign events are append-only';
end;
$$;

create trigger acceptance_campaign_events_are_append_only
before update or delete on infrastructure.acceptance_campaign_events
for each row execute function infrastructure.reject_acceptance_event_mutation();

create function infrastructure.claim_acceptance_receipt(
  requested_operation_id uuid,
  requested_command text,
  requested_fingerprint text,
  requested_result jsonb,
  requested_at timestamptz
) returns jsonb
language plpgsql
as $$
declare
  existing infrastructure.acceptance_campaign_receipts%rowtype;
begin
  select * into existing
    from infrastructure.acceptance_campaign_receipts
   where operation_id = requested_operation_id;
  if found then
    if existing.command_name is distinct from requested_command
       or existing.request_fingerprint is distinct from requested_fingerprint then
      return jsonb_build_object('outcome', 'operation_reused');
    end if;
    return jsonb_build_object('outcome', 'replayed', 'result', existing.result);
  end if;
  insert into infrastructure.acceptance_campaign_receipts (
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

create function infrastructure.read_acceptance_campaign()
returns jsonb
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select campaign.snapshot
    from infrastructure.acceptance_campaigns campaign
   where campaign.active
   order by campaign.updated_at desc, campaign.campaign_id desc
   limit 1
$$;

revoke all on function infrastructure.read_acceptance_campaign() from public;

create function infrastructure.write_acceptance_campaign(
  requested_operation_id uuid,
  requested_command text,
  requested_fingerprint text,
  requested_actor_id text,
  requested_snapshot jsonb,
  requested_replace boolean,
  requested_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  requested_campaign_id uuid;
  claimed jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('acceptance-campaign', 0));
  claimed := infrastructure.claim_acceptance_receipt(
    requested_operation_id,
    requested_command,
    requested_fingerprint,
    requested_snapshot,
    requested_at
  );
  if claimed->>'outcome' <> 'applied' then
    return claimed;
  end if;
  requested_campaign_id := (requested_snapshot->>'campaignId')::uuid;
  if requested_replace then
    update infrastructure.acceptance_campaigns
       set active = false,
           updated_at = requested_at
     where active
       and acceptance_campaigns.campaign_id is distinct from requested_campaign_id;
  end if;
  insert into infrastructure.acceptance_campaigns (
    campaign_id, artifact_digest, environment_host,
    school_configuration_release_id, synthetic_identity_set_id, snapshot,
    active, actor_id, recorded_at, updated_at,
    record_owner, record_classification, disposal_class
  ) values (
    requested_campaign_id,
    requested_snapshot->'pin'->>'artifactDigest',
    requested_snapshot->'pin'->>'environmentHost',
    (requested_snapshot->'pin'->>'schoolConfigurationReleaseId')::uuid,
    (requested_snapshot->'pin'->>'syntheticIdentitySetId')::uuid,
    requested_snapshot,
    true,
    requested_actor_id,
    requested_at,
    requested_at,
    'school', 'operational_evidence', 'acceptance_campaign'
  )
  on conflict (campaign_id) do update
     set snapshot = excluded.snapshot,
         artifact_digest = excluded.artifact_digest,
         environment_host = excluded.environment_host,
         school_configuration_release_id = excluded.school_configuration_release_id,
         synthetic_identity_set_id = excluded.synthetic_identity_set_id,
         active = true,
         updated_at = excluded.updated_at;
  insert into infrastructure.acceptance_campaign_events (
    event_id, campaign_id, event_kind, actor_id, details, occurred_at,
    record_owner, record_classification, disposal_class
  ) values (
    gen_random_uuid(), requested_campaign_id, requested_command, requested_actor_id,
    jsonb_build_object(
      'campaignId', requested_campaign_id,
      'artifactDigest', requested_snapshot->'pin'->>'artifactDigest'
    ),
    requested_at, 'school', 'operational_evidence', 'acceptance_campaign_event'
  );
  return claimed;
end;
$$;

revoke all on function infrastructure.write_acceptance_campaign(
  uuid, text, text, text, jsonb, boolean, timestamptz
) from public;
