create extension if not exists pgmq cascade;
create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1 from pgmq.list_queues() where queue_name = 'provider-smoke'
  ) then
    perform pgmq.create('provider-smoke');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pgmq.list_queues() where queue_name = 'invitation-delivery'
  ) then
    perform pgmq.create('invitation-delivery');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'provider-smoke'
  ) then
    perform cron.schedule('provider-smoke', '* * * * *', 'select 1');
  end if;
end
$$;

insert into storage.buckets (id, name, public)
values ('private-records', 'private-records', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('school-configuration-releases', 'school-configuration-releases', false)
on conflict (id) do update set public = false;

create or replace function infrastructure.provider_cron_healthy(expected_name text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from cron.job job
    join cron.job_run_details run on run.jobid = job.jobid
    where job.jobname = expected_name
      and job.active
      and run.status = 'succeeded'
      and run.end_time > now() - interval '10 minutes'
  )
$$;

create or replace function infrastructure.provider_queue_healthy(expected_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent_id bigint;
  received_id bigint;
  removed boolean;
begin
  if expected_name <> 'provider-smoke' then
    return false;
  end if;
  perform pgmq.purge_queue('provider-smoke');
  select pgmq.send('provider-smoke', '{"kind":"provider_smoke"}'::jsonb)
    into sent_id;
  select msg_id from pgmq.read('provider-smoke', 30, 1)
    into received_id;
  select pgmq.delete('provider-smoke', sent_id)
    into removed;
  return sent_id = received_id and removed;
end
$$;

revoke all on function infrastructure.provider_cron_healthy(text) from public;
revoke all on function infrastructure.provider_queue_healthy(text) from public;
grant execute on function infrastructure.provider_cron_healthy(text) to __RUNTIME_ROLE__;
grant execute on function infrastructure.provider_queue_healthy(text) to __RUNTIME_ROLE__;

create or replace function infrastructure.enqueue_invitation_delivery(requested_outbox_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update infrastructure.outbox set status = 'enqueued'
   where outbox_id = requested_outbox_id
     and topic = 'invitation.delivery_requested' and status = 'pending';
  if found then
    perform pgmq.send('invitation-delivery', jsonb_build_object('outboxId', requested_outbox_id));
  end if;
end
$$;

create or replace function infrastructure.read_invitation_delivery()
returns table (message_id bigint, outbox_id uuid, attempt integer)
language sql security definer set search_path = '' as $$
  select message.msg_id, (message.message->>'outboxId')::uuid, message.read_ct
    from pgmq.read('invitation-delivery', 60, 1) message
$$;

create or replace function infrastructure.complete_invitation_delivery_message(requested_message_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.delete('invitation-delivery', requested_message_id);
end
$$;

create or replace function infrastructure.retry_invitation_delivery_message(
  requested_message_id bigint, requested_delay_seconds integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.set_vt('invitation-delivery', requested_message_id, requested_delay_seconds);
end
$$;

revoke all on function infrastructure.enqueue_invitation_delivery(uuid) from public;
revoke all on function infrastructure.read_invitation_delivery() from public;
revoke all on function infrastructure.complete_invitation_delivery_message(bigint) from public;
revoke all on function infrastructure.retry_invitation_delivery_message(bigint, integer) from public;
grant usage on schema infrastructure to __WORKER_ROLE__;
grant execute on function infrastructure.pending_invitation_outbox() to __WORKER_ROLE__;
grant execute on function infrastructure.claim_invitation_delivery(uuid, timestamptz) to __WORKER_ROLE__;
grant execute on function infrastructure.complete_invitation_delivery(uuid, uuid, integer, text, timestamptz) to __WORKER_ROLE__;
grant execute on function infrastructure.suppress_invitation_delivery(uuid, uuid, integer) to __WORKER_ROLE__;
grant execute on function infrastructure.enqueue_invitation_delivery(uuid) to __WORKER_ROLE__;
grant execute on function infrastructure.read_invitation_delivery() to __WORKER_ROLE__;
grant execute on function infrastructure.complete_invitation_delivery_message(bigint) to __WORKER_ROLE__;
grant execute on function infrastructure.retry_invitation_delivery_message(bigint, integer) to __WORKER_ROLE__;
grant execute on function infrastructure.record_worker_artifact_heartbeat(text, text, uuid, timestamptz) to __WORKER_ROLE__;
grant execute on function infrastructure.record_invitation_delivery_attestation(uuid, text, text, timestamptz) to __WORKER_ROLE__;

do $$
begin
  if not exists (
    select 1 from pgmq.list_queues() where queue_name = 'sign-in-delivery'
  ) then
    perform pgmq.create('sign-in-delivery');
  end if;
end
$$;

create or replace function infrastructure.enqueue_sign_in_delivery(requested_outbox_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update infrastructure.outbox set status = 'enqueued'
   where outbox_id = requested_outbox_id
     and topic = 'sign_in.delivery_requested' and status = 'pending';
  if found then
    perform pgmq.send('sign-in-delivery', jsonb_build_object('outboxId', requested_outbox_id));
  end if;
end
$$;

create or replace function infrastructure.read_sign_in_delivery()
returns table (message_id bigint, outbox_id uuid, attempt integer)
language sql security definer set search_path = '' as $$
  select message.msg_id, (message.message->>'outboxId')::uuid, message.read_ct
    from pgmq.read('sign-in-delivery', 60, 1) message
$$;

create or replace function infrastructure.complete_sign_in_delivery_message(requested_message_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.delete('sign-in-delivery', requested_message_id);
end
$$;

create or replace function infrastructure.retry_sign_in_delivery_message(
  requested_message_id bigint, requested_delay_seconds integer
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.set_vt('sign-in-delivery', requested_message_id, requested_delay_seconds);
end
$$;

revoke all on function infrastructure.enqueue_sign_in_delivery(uuid) from public;
revoke all on function infrastructure.read_sign_in_delivery() from public;
revoke all on function infrastructure.complete_sign_in_delivery_message(bigint) from public;
revoke all on function infrastructure.retry_sign_in_delivery_message(bigint, integer) from public;
grant execute on function infrastructure.pending_sign_in_outbox() to __WORKER_ROLE__;
grant execute on function infrastructure.claim_sign_in_delivery(uuid, timestamptz) to __WORKER_ROLE__;
grant execute on function infrastructure.complete_sign_in_delivery(uuid, uuid, integer, text, timestamptz) to __WORKER_ROLE__;
grant execute on function infrastructure.suppress_sign_in_delivery(uuid, uuid, integer) to __WORKER_ROLE__;
grant execute on function infrastructure.enqueue_sign_in_delivery(uuid) to __WORKER_ROLE__;
grant execute on function infrastructure.read_sign_in_delivery() to __WORKER_ROLE__;
grant execute on function infrastructure.complete_sign_in_delivery_message(bigint) to __WORKER_ROLE__;
grant execute on function infrastructure.retry_sign_in_delivery_message(bigint, integer) to __WORKER_ROLE__;

revoke all on function infrastructure.pending_record_production_outbox() from public;
revoke all on function infrastructure.claim_record_production_delivery(uuid, timestamptz) from public;
revoke all on function infrastructure.complete_record_production_delivery(uuid, uuid, text, timestamptz) from public;
revoke all on function infrastructure.suppress_record_production_delivery(uuid, uuid) from public;
revoke all on function infrastructure.expire_record_productions(timestamptz) from public;
grant execute on function infrastructure.pending_record_production_outbox() to __WORKER_ROLE__;
grant execute on function infrastructure.claim_record_production_delivery(uuid, timestamptz) to __WORKER_ROLE__;
grant execute on function infrastructure.complete_record_production_delivery(uuid, uuid, text, timestamptz) to __WORKER_ROLE__;
grant execute on function infrastructure.suppress_record_production_delivery(uuid, uuid) to __WORKER_ROLE__;
grant execute on function infrastructure.expire_record_productions(timestamptz) to __WORKER_ROLE__;
grant execute on function infrastructure.activity_is_stopped() to __WORKER_ROLE__;
