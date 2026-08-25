-- Unattributed clinical reveal attempts cannot invent a Staff Identity or
-- School Workspace. This append-only security-event table records only the
-- outcome and an optional Student correlation id, never credentials, session
-- handles, or raw request content.

create table audit.security_events (
  sequence bigint generated always as identity primary key,
  audit_id uuid not null unique,
  operation_id uuid not null,
  event_type text not null check (event_type = 'intake_record.reveal_denied'),
  occurred_at timestamptz not null,
  details jsonb not null,
  record_owner text not null check (record_owner = 'system'),
  record_classification text not null check (record_classification = 'security_event'),
  disposal_class text not null check (disposal_class = 'unattributed_security_event')
);

alter table audit.security_events enable row level security;
alter table audit.security_events force row level security;

create policy security_events_insert on audit.security_events
  for insert with check (true);

create trigger security_events_are_append_only
before update or delete on audit.security_events
for each row execute function audit.reject_evidence_mutation();

create function audit.record_unattributed_reveal_attempt(
  p_audit_id uuid,
  p_operation_id uuid,
  p_occurred_at timestamptz,
  p_outcome text,
  p_details jsonb
) returns void
language plpgsql
security definer
set search_path = audit, pg_temp
as $$
begin
  if p_outcome not in ('denied_unauthenticated', 'denied_session_unknown') then
    raise exception 'unsupported unattributed reveal outcome';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'unattributed reveal details must be an object';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_details) as key
     where key not in ('outcome', 'studentId')
  ) then
    raise exception 'unattributed reveal details contain unsupported fields';
  end if;
  if p_details->>'outcome' is distinct from p_outcome then
    raise exception 'unattributed reveal outcome mismatch';
  end if;
  if p_details ? 'studentId'
     and coalesce(p_details->>'studentId', '')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    raise exception 'unattributed reveal studentId is not a uuid';
  end if;

  insert into audit.security_events (
    audit_id, operation_id, event_type, occurred_at, details,
    record_owner, record_classification, disposal_class
  ) values (
    p_audit_id, p_operation_id, 'intake_record.reveal_denied', p_occurred_at,
    p_details, 'system', 'security_event', 'unattributed_security_event'
  );
end;
$$;

revoke all on function audit.record_unattributed_reveal_attempt(
  uuid, uuid, timestamptz, text, jsonb
) from public;
