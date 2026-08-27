alter table identity_access.students
  add column language_choice text not null default 'en-US';

alter table identity_access.students
  add constraint students_language_choice_check
  check (language_choice in ('en-US', 'es-US', 'pt-BR', 'fr-CA', 'ht-HT'));

create table identity_access.sign_in_challenges (
  sign_in_challenge_id uuid primary key,
  workspace_id uuid not null,
  student_id uuid not null,
  recipient_digest text not null,
  purpose text not null check (purpose = 'sign_in'),
  current_generation integer not null,
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'student_sign_in_challenge'),
  foreign key (student_id, workspace_id)
    references identity_access.students(student_id, workspace_id),
  unique (workspace_id, recipient_digest, purpose)
);

create table identity_access.sign_in_challenge_codes (
  sign_in_challenge_id uuid not null references identity_access.sign_in_challenges(sign_in_challenge_id),
  generation integer not null,
  purpose text not null check (purpose = 'sign_in'),
  code_digest text not null,
  lookup_digest text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  failed_attempts integer not null default 0
    check (failed_attempts between 0 and 5),
  primary key (sign_in_challenge_id, generation)
);

create table identity_access.sign_in_deliveries (
  sign_in_challenge_id uuid not null,
  generation integer not null,
  key_id text not null,
  ciphertext text not null,
  status text not null check (status in ('pending', 'sending', 'delivered', 'suppressed')),
  provider_idempotency_key text not null unique,
  provider_message_id text,
  delivered_at timestamptz,
  primary key (sign_in_challenge_id, generation),
  foreign key (sign_in_challenge_id, generation)
    references identity_access.sign_in_challenge_codes(sign_in_challenge_id, generation)
);

create table identity_access.sign_in_send_attempts (
  send_attempt_id uuid primary key,
  recipient_digest text not null,
  attempted_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'operational_evidence'),
  disposal_class text not null check (disposal_class = 'student_sign_in_send_attempt')
);

create index sign_in_send_attempts_recipient_idx
  on identity_access.sign_in_send_attempts(recipient_digest, attempted_at desc);

create index sign_in_challenge_codes_lookup_digest_idx
  on identity_access.sign_in_challenge_codes(lookup_digest)
  where lookup_digest is not null;

alter table identity_access.sign_in_challenges enable row level security;
alter table identity_access.sign_in_challenge_codes enable row level security;
alter table identity_access.sign_in_deliveries enable row level security;
alter table identity_access.sign_in_send_attempts enable row level security;
alter table identity_access.sign_in_challenges force row level security;
alter table identity_access.sign_in_challenge_codes force row level security;
alter table identity_access.sign_in_deliveries force row level security;
alter table identity_access.sign_in_send_attempts force row level security;

create policy sign_in_challenges_recipient_scope on identity_access.sign_in_challenges
  using (
    recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), '')
    or student_id = nullif(current_setting('app.student_id', true), '')::uuid
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), '')
  );

create policy sign_in_challenge_codes_scope on identity_access.sign_in_challenge_codes
  using (
    exists (
      select 1 from identity_access.sign_in_challenges challenge
       where challenge.sign_in_challenge_id = sign_in_challenge_codes.sign_in_challenge_id
         and (
           challenge.recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), '')
           or challenge.student_id = nullif(current_setting('app.student_id', true), '')::uuid
         )
    )
  )
  with check (
    exists (
      select 1 from identity_access.sign_in_challenges challenge
       where challenge.sign_in_challenge_id = sign_in_challenge_codes.sign_in_challenge_id
         and challenge.recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), '')
    )
  );

create policy sign_in_deliveries_scope on identity_access.sign_in_deliveries
  using (
    exists (
      select 1 from identity_access.sign_in_challenges challenge
       where challenge.sign_in_challenge_id = sign_in_deliveries.sign_in_challenge_id
         and (
           challenge.recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), '')
           or challenge.student_id = nullif(current_setting('app.student_id', true), '')::uuid
         )
    )
  )
  with check (
    exists (
      select 1 from identity_access.sign_in_challenges challenge
       where challenge.sign_in_challenge_id = sign_in_deliveries.sign_in_challenge_id
         and challenge.recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), '')
    )
  );

create policy sign_in_send_attempts_scope on identity_access.sign_in_send_attempts
  using (recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), ''))
  with check (recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), ''));

drop policy if exists verified_email_addresses_scope on identity_access.verified_email_addresses;
create policy verified_email_addresses_scope on identity_access.verified_email_addresses
  using (
    student_id = nullif(current_setting('app.student_id', true), '')::uuid
    or recipient_digest = nullif(current_setting('app.invitation_recipient_digest', true), '')
    or recipient_digest = nullif(current_setting('app.sign_in_recipient_digest', true), '')
  )
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create function infrastructure.pending_sign_in_outbox()
returns table (outbox_id uuid)
language sql security definer set search_path = '' as $$
  select outbox.outbox_id
    from infrastructure.outbox outbox
   where outbox.topic = 'sign_in.delivery_requested' and outbox.status = 'pending'
   order by outbox.sequence limit 20
$$;

create function infrastructure.claim_sign_in_delivery(
  requested_outbox_id uuid, requested_at timestamptz
) returns table (
  outcome text, challenge_id uuid, generation integer, purpose text,
  key_id text, ciphertext text, provider_idempotency_key text
) language plpgsql security definer set search_path = '' as $$
declare
  requested_challenge_id uuid;
  requested_generation integer;
  challenge_row identity_access.sign_in_challenges%rowtype;
  code_row identity_access.sign_in_challenge_codes%rowtype;
  delivery_row identity_access.sign_in_deliveries%rowtype;
begin
  select (payload->>'challengeId')::uuid, (payload->>'generation')::integer
    into requested_challenge_id, requested_generation
    from infrastructure.outbox
   where outbox_id = requested_outbox_id
     and topic = 'sign_in.delivery_requested';
  if requested_challenge_id is null then
    return query select 'suppressed'::text, null::uuid, null::integer,
      null::text, null::text, null::text, null::text;
    return;
  end if;
  select * into challenge_row from identity_access.sign_in_challenges
   where identity_access.sign_in_challenges.sign_in_challenge_id = requested_challenge_id
   for update;
  select * into code_row from identity_access.sign_in_challenge_codes
   where identity_access.sign_in_challenge_codes.sign_in_challenge_id = requested_challenge_id
     and identity_access.sign_in_challenge_codes.generation = requested_generation;
  select * into delivery_row from identity_access.sign_in_deliveries
   where identity_access.sign_in_deliveries.sign_in_challenge_id = requested_challenge_id
     and identity_access.sign_in_deliveries.generation = requested_generation
   for update;
  if requested_generation <> challenge_row.current_generation
     or code_row.completed_at is not null
     or code_row.expires_at <= requested_at
     or delivery_row.status in ('delivered', 'suppressed') then
    update identity_access.sign_in_deliveries delivery set status = 'suppressed'
     where delivery.sign_in_challenge_id = requested_challenge_id
       and delivery.generation = requested_generation
       and delivery.status <> 'delivered';
    update infrastructure.outbox outbox set status = 'completed'
     where outbox.outbox_id = requested_outbox_id;
    return query select 'suppressed'::text, null::uuid, null::integer,
      null::text, null::text, null::text, null::text;
    return;
  end if;
  update identity_access.sign_in_deliveries delivery set status = 'sending'
   where delivery.sign_in_challenge_id = requested_challenge_id
     and delivery.generation = requested_generation;
  return query select 'deliver'::text, requested_challenge_id,
    requested_generation, challenge_row.purpose,
    delivery_row.key_id, delivery_row.ciphertext,
    delivery_row.provider_idempotency_key;
end
$$;

create function infrastructure.complete_sign_in_delivery(
  requested_outbox_id uuid, requested_challenge_id uuid, requested_generation integer,
  requested_provider_message_id text, requested_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from infrastructure.outbox outbox
     where outbox.outbox_id = requested_outbox_id
       and outbox.topic = 'sign_in.delivery_requested'
       and (outbox.payload->>'challengeId')::uuid = requested_challenge_id
       and (outbox.payload->>'generation')::integer = requested_generation
  ) then
    return;
  end if;
  update identity_access.sign_in_deliveries
     set status = 'delivered', provider_message_id = requested_provider_message_id,
         delivered_at = requested_at
   where sign_in_challenge_id = requested_challenge_id and generation = requested_generation
     and status in ('pending', 'sending');
  if found then
    update infrastructure.outbox set status = 'completed'
      where outbox_id = requested_outbox_id;
  end if;
end
$$;

create function infrastructure.suppress_sign_in_delivery(
  requested_outbox_id uuid, requested_challenge_id uuid, requested_generation integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from infrastructure.outbox outbox
     where outbox.outbox_id = requested_outbox_id
       and outbox.topic = 'sign_in.delivery_requested'
       and (outbox.payload->>'challengeId')::uuid = requested_challenge_id
       and (outbox.payload->>'generation')::integer = requested_generation
  ) then
    return;
  end if;
  update identity_access.sign_in_deliveries set status = 'suppressed'
   where sign_in_challenge_id = requested_challenge_id and generation = requested_generation
     and status <> 'delivered';
  update infrastructure.outbox set status = 'failed'
   where outbox_id = requested_outbox_id;
end
$$;

revoke all on function infrastructure.pending_sign_in_outbox() from public;
revoke all on function infrastructure.claim_sign_in_delivery(uuid, timestamptz) from public;
revoke all on function infrastructure.complete_sign_in_delivery(uuid, uuid, integer, text, timestamptz) from public;
revoke all on function infrastructure.suppress_sign_in_delivery(uuid, uuid, integer) from public;
