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
    select 1 from cron.job where jobname = 'provider-smoke'
  ) then
    perform cron.schedule('provider-smoke', '* * * * *', 'select 1');
  end if;
end
$$;

insert into storage.buckets (id, name, public)
values ('private-records', 'private-records', false)
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
