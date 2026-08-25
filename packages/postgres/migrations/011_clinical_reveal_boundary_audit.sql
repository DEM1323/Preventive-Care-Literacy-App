-- Expand unattributed clinical reveal outcomes so HTTP-boundary denials
-- (origin, CSRF, schema, oversized body) can be recorded with fixed reason
-- codes only. Details never include cookies, session handles, origins, or
-- request bodies. Flooding this table is an operational DoS concern, not a
-- content-disclosure path.

create or replace function audit.record_unattributed_reveal_attempt(
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
  if p_outcome not in (
    'denied_unauthenticated',
    'denied_session_unknown',
    'denied_origin',
    'denied_csrf',
    'denied_invalid_request',
    'denied_body_too_large'
  ) then
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
  if p_outcome in (
    'denied_origin',
    'denied_csrf',
    'denied_invalid_request',
    'denied_body_too_large'
  ) and p_details ? 'studentId' then
    raise exception 'boundary reveal denials must not include studentId';
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
