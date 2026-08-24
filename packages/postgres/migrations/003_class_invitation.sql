create table identity_access.classes (
  class_id uuid primary key,
  workspace_id uuid not null references identity_access.school_workspaces(workspace_id),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'school_administrative'),
  disposal_class text not null check (disposal_class = 'class'),
  unique (class_id, workspace_id)
);

create table identity_access.invitations (
  invitation_id uuid primary key,
  workspace_id uuid not null,
  class_id uuid not null,
  purpose text not null check (purpose = 'join_class'),
  recipient_digest text not null,
  current_generation integer not null check (current_generation > 0),
  status text not null check (status in ('pending_delivery', 'delivered', 'delivery_failed', 'expired', 'completed')),
  created_at timestamptz not null,
  record_owner text not null check (record_owner = 'school'),
  record_classification text not null check (record_classification = 'school_administrative'),
  disposal_class text not null check (disposal_class = 'invitation'),
  foreign key (class_id, workspace_id) references identity_access.classes(class_id, workspace_id)
);

create table identity_access.invitation_challenges (
  invitation_id uuid not null,
  generation integer not null,
  purpose text not null check (purpose = 'join_class'),
  code_digest text not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  primary key (invitation_id, generation),
  foreign key (invitation_id) references identity_access.invitations(invitation_id)
);

create table identity_access.invitation_deliveries (
  invitation_id uuid not null,
  generation integer not null,
  key_id text not null,
  ciphertext text not null,
  status text not null check (status in ('pending', 'sending', 'delivered', 'suppressed')),
  provider_idempotency_key text not null unique,
  provider_message_id text,
  delivered_at timestamptz,
  primary key (invitation_id, generation),
  foreign key (invitation_id, generation)
    references identity_access.invitation_challenges(invitation_id, generation)
);

alter table identity_access.classes enable row level security;
alter table identity_access.invitations enable row level security;
alter table identity_access.invitation_challenges enable row level security;
alter table identity_access.invitation_deliveries enable row level security;
alter table identity_access.classes force row level security;
alter table identity_access.invitations force row level security;
alter table identity_access.invitation_challenges force row level security;
alter table identity_access.invitation_deliveries force row level security;

create policy classes_administration_scope on identity_access.classes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative'))
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative'));
create policy invitations_administration_scope on identity_access.invitations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative'))
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and identity_access.current_staff_has_permission('administrative'));
create policy invitation_challenges_administration_scope on identity_access.invitation_challenges
  using (exists (select 1 from identity_access.invitations invitation
    where invitation.invitation_id = invitation_challenges.invitation_id))
  with check (exists (select 1 from identity_access.invitations invitation
    where invitation.invitation_id = invitation_challenges.invitation_id));
create policy invitation_deliveries_administration_scope on identity_access.invitation_deliveries
  using (exists (select 1 from identity_access.invitations invitation
    where invitation.invitation_id = invitation_deliveries.invitation_id))
  with check (exists (select 1 from identity_access.invitations invitation
    where invitation.invitation_id = invitation_deliveries.invitation_id));

create function infrastructure.pending_invitation_outbox()
returns table (outbox_id uuid)
language sql security definer set search_path = '' as $$
  select outbox.outbox_id
    from infrastructure.outbox outbox
   where outbox.topic = 'invitation.delivery_requested' and outbox.status = 'pending'
   order by outbox.sequence limit 20
$$;

create function infrastructure.claim_invitation_delivery(
  requested_outbox_id uuid, requested_at timestamptz
) returns table (
  outcome text, invitation_id uuid, generation integer, purpose text,
  key_id text, ciphertext text, provider_idempotency_key text
) language plpgsql security definer set search_path = '' as $$
declare
  requested_invitation_id uuid;
  requested_generation integer;
  invitation_row identity_access.invitations%rowtype;
  challenge_row identity_access.invitation_challenges%rowtype;
  delivery_row identity_access.invitation_deliveries%rowtype;
begin
  select (payload->>'invitationId')::uuid, (payload->>'generation')::integer
    into requested_invitation_id, requested_generation
    from infrastructure.outbox
   where outbox_id = requested_outbox_id
     and topic = 'invitation.delivery_requested';
  if requested_invitation_id is null then
    return query select 'suppressed'::text, null::uuid, null::integer,
      null::text, null::text, null::text, null::text;
    return;
  end if;
  select * into invitation_row from identity_access.invitations
   where identity_access.invitations.invitation_id = requested_invitation_id for update;
  select * into challenge_row from identity_access.invitation_challenges
   where identity_access.invitation_challenges.invitation_id = requested_invitation_id
      and identity_access.invitation_challenges.generation = requested_generation;
  select * into delivery_row from identity_access.invitation_deliveries
   where identity_access.invitation_deliveries.invitation_id = requested_invitation_id
      and identity_access.invitation_deliveries.generation = requested_generation
   for update;
  if requested_generation <> invitation_row.current_generation
     or invitation_row.status not in ('pending_delivery', 'delivered')
     or challenge_row.completed_at is not null
     or challenge_row.expires_at <= requested_at
     or delivery_row.status in ('delivered', 'suppressed') then
    update identity_access.invitation_deliveries delivery set status = 'suppressed'
     where delivery.invitation_id = requested_invitation_id
       and delivery.generation = requested_generation
       and delivery.status <> 'delivered';
    if requested_generation = invitation_row.current_generation
       and challenge_row.expires_at <= requested_at then
      update identity_access.invitations invitation set status = 'expired'
       where invitation.invitation_id = requested_invitation_id;
    end if;
    update infrastructure.outbox outbox set status = 'completed'
     where outbox.outbox_id = requested_outbox_id;
    return query select 'suppressed'::text, null::uuid, null::integer,
      null::text, null::text, null::text, null::text;
    return;
  end if;
  update identity_access.invitation_deliveries delivery set status = 'sending'
   where delivery.invitation_id = requested_invitation_id
      and delivery.generation = requested_generation;
  return query select 'deliver'::text, requested_invitation_id,
    requested_generation, invitation_row.purpose,
    delivery_row.key_id, delivery_row.ciphertext,
    delivery_row.provider_idempotency_key;
end
$$;

create function infrastructure.complete_invitation_delivery(
  requested_outbox_id uuid, requested_invitation_id uuid, requested_generation integer,
  requested_provider_message_id text, requested_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from infrastructure.outbox outbox
     where outbox.outbox_id = requested_outbox_id
       and outbox.topic = 'invitation.delivery_requested'
       and (outbox.payload->>'invitationId')::uuid = requested_invitation_id
       and (outbox.payload->>'generation')::integer = requested_generation
  ) then
    return;
  end if;
  update identity_access.invitation_deliveries
     set status = 'delivered', provider_message_id = requested_provider_message_id,
         delivered_at = requested_at
   where invitation_id = requested_invitation_id and generation = requested_generation
     and status in ('pending', 'sending');
  if found then
    update identity_access.invitations set status = 'delivered'
     where invitation_id = requested_invitation_id
       and current_generation = requested_generation
       and status = 'pending_delivery';
    update infrastructure.outbox set status = 'completed'
      where outbox_id = requested_outbox_id;
  end if;
end
$$;

create function infrastructure.suppress_invitation_delivery(
  requested_outbox_id uuid, requested_invitation_id uuid, requested_generation integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from infrastructure.outbox outbox
     where outbox.outbox_id = requested_outbox_id
       and outbox.topic = 'invitation.delivery_requested'
       and (outbox.payload->>'invitationId')::uuid = requested_invitation_id
       and (outbox.payload->>'generation')::integer = requested_generation
  ) then
    return;
  end if;
  update identity_access.invitation_deliveries set status = 'suppressed'
   where invitation_id = requested_invitation_id and generation = requested_generation
     and status <> 'delivered';
  update identity_access.invitations set status = 'delivery_failed'
   where invitation_id = requested_invitation_id
     and current_generation = requested_generation
     and status = 'pending_delivery';
  update infrastructure.outbox set status = 'failed'
   where outbox_id = requested_outbox_id;
end
$$;

revoke all on function infrastructure.pending_invitation_outbox() from public;
revoke all on function infrastructure.claim_invitation_delivery(uuid, timestamptz) from public;
revoke all on function infrastructure.complete_invitation_delivery(uuid, uuid, integer, text, timestamptz) from public;
revoke all on function infrastructure.suppress_invitation_delivery(uuid, uuid, integer) from public;
