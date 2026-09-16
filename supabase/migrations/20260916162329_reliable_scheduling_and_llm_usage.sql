create extension if not exists pg_cron;
create extension if not exists pg_net;
create schema if not exists trendlens_internal;
revoke all on schema trendlens_internal from public, anon, authenticated;

create table public.trendlens_job_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('daily', 'weekly')),
  scheduled_date date not null,
  is_scheduled boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  owner text,
  dispatch_count integer not null default 0,
  request_id bigint,
  last_dispatched_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create unique index trendlens_job_runs_daily_key on public.trendlens_job_runs (kind, scheduled_date) where is_scheduled;
create index trendlens_job_runs_created_idx on public.trendlens_job_runs (created_at desc);

create table public.trendlens_job_alerts (
  kind text not null check (kind in ('daily', 'weekly')),
  scheduled_date date not null,
  message text not null,
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (kind, scheduled_date)
);

create table public.trendlens_llm_usage (
  id uuid primary key,
  job_id uuid references public.trendlens_job_runs(id) on delete set null,
  github_run_id text,
  stage text not null check (stage in ('select', 'rewrite', 'review', 'profile')),
  model text not null,
  article_id text,
  attempt integer not null default 1,
  api_attempt integer not null default 1,
  started_at timestamptz not null,
  finished_at timestamptz,
  latency_ms bigint,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  http_status integer,
  provider_request_id text,
  usage_known boolean not null default false,
  prompt_tokens bigint,
  completion_tokens bigint,
  cache_hit_tokens bigint,
  cache_miss_tokens bigint,
  pricing_period text not null check (pricing_period in ('peak', 'off_peak')),
  rate_version text,
  estimated_cost_cny numeric(18, 8),
  error text
);
create index trendlens_llm_usage_started_idx on public.trendlens_llm_usage (started_at desc);
create index trendlens_llm_usage_job_idx on public.trendlens_llm_usage (job_id);

alter table public.trendlens_job_runs enable row level security;
alter table public.trendlens_job_alerts enable row level security;
alter table public.trendlens_llm_usage enable row level security;
revoke all on public.trendlens_job_runs, public.trendlens_job_alerts, public.trendlens_llm_usage from anon, authenticated;
grant select, insert, update, delete on public.trendlens_job_runs, public.trendlens_job_alerts, public.trendlens_llm_usage to service_role;

create or replace function public.trendlens_claim_job(p_kind text, p_job_id uuid, p_owner text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  job public.trendlens_job_runs;
  today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if p_kind not in ('daily', 'weekly') or coalesce(length(p_owner), 0) not between 1 and 200 then
    raise exception 'Invalid job arguments';
  end if;
  if p_job_id is null then
    insert into public.trendlens_job_runs (kind, scheduled_date) values (p_kind, today) returning * into job;
  else
    select * into job from public.trendlens_job_runs where id = p_job_id and kind = p_kind for update;
    if not found then raise exception 'Scheduled job does not exist'; end if;
    if job.scheduled_date <> today then
      return jsonb_build_object('acquired', false, 'reason', 'Expired scheduled job');
    end if;
  end if;
  if job.status <> 'queued' then
    return jsonb_build_object('acquired', false, 'reason', 'Job already claimed or completed');
  end if;
  -- Manual updates also satisfy today's scheduled daily publication.
  if job.is_scheduled and p_kind = 'daily' and exists (
    select 1 from public.trendlens_radar_runs where mode = 'deepseek' and article_count > 0
      and generated_at >= today::timestamp at time zone 'Asia/Shanghai'
  ) then
    update public.trendlens_job_runs set status = 'succeeded', finished_at = now() where id = job.id;
    update public.trendlens_job_alerts set resolved_at = now() where kind = p_kind and resolved_at is null;
    return jsonb_build_object('acquired', false, 'reason', 'Today already published');
  end if;
  update public.trendlens_job_runs set status = 'running', owner = p_owner, started_at = now(), finished_at = null, error = null
    where id = job.id;
  return jsonb_build_object('acquired', true, 'id', job.id, 'is_scheduled', job.is_scheduled);
end;
$$;
revoke all on function public.trendlens_claim_job(text, uuid, text) from public, anon, authenticated;
grant execute on function public.trendlens_claim_job(text, uuid, text) to service_role;

create or replace function public.trendlens_finish_job(p_job_id uuid, p_owner text, p_succeeded boolean, p_error text)
returns void language plpgsql security invoker set search_path = '' as $$
declare job public.trendlens_job_runs;
begin
  update public.trendlens_job_runs set status = case when p_succeeded then 'succeeded' else 'failed' end,
    finished_at = now(), error = left(p_error, 1000)
    where id = p_job_id and owner = p_owner and status = 'running' returning * into job;
  if not found then raise exception 'Job is not owned by this runner'; end if;
  if p_succeeded then
    update public.trendlens_job_alerts set resolved_at = now()
      where kind = job.kind and scheduled_date <= job.scheduled_date and resolved_at is null;
  else
    insert into public.trendlens_job_alerts (kind, scheduled_date, message)
      values (job.kind, job.scheduled_date, case when job.kind = 'daily' then '推荐更新失败，上一期文章仍可阅读。' else '兴趣画像更新失败，继续使用上一版画像。' end)
      on conflict (kind, scheduled_date) do update set message = excluded.message, updated_at = now(), resolved_at = null;
  end if;
end;
$$;
revoke all on function public.trendlens_finish_job(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.trendlens_finish_job(uuid, text, boolean, text) to service_role;

-- Only the postgres-owned Cron jobs can dispatch; no public RPC exposes the Vault token.
create or replace function trendlens_internal.dispatch_job(p_kind text, p_check boolean default false, p_retry boolean default true)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  local_now timestamp := now() at time zone 'Asia/Shanghai';
  today date := local_now::date;
  job public.trendlens_job_runs;
  token text;
  workflow text;
  request bigint;
  response_status integer;
begin
  if p_kind not in ('daily', 'weekly') then raise exception 'Invalid job kind'; end if;
  perform pg_advisory_xact_lock(hashtext('trendlens-scheduler-' || p_kind));
  if (p_kind = 'daily' and exists (
    select 1 from public.trendlens_radar_runs where mode = 'deepseek' and article_count > 0
      and generated_at >= today::timestamp at time zone 'Asia/Shanghai'
  )) or (p_kind = 'weekly' and exists (
    select 1 from public.trendlens_profile where generated_at >= today::timestamp at time zone 'Asia/Shanghai'
  )) then
    update public.trendlens_job_alerts set resolved_at = now() where kind = p_kind and resolved_at is null;
    return 'already completed';
  end if;
  insert into public.trendlens_job_runs (kind, scheduled_date, is_scheduled)
    values (p_kind, today, true) on conflict (kind, scheduled_date) where is_scheduled do nothing;
  select * into job from public.trendlens_job_runs
    where kind = p_kind and scheduled_date = today and is_scheduled for update;
  if job.status = 'succeeded' then return 'already completed'; end if;
  if p_check then
    insert into public.trendlens_job_alerts (kind, scheduled_date, message)
      values (p_kind, today, case when p_kind = 'daily' then '今日推荐尚未更新，正在检查或补跑；上一期文章仍可阅读。' else '本周画像尚未更新，正在检查或补跑。' end)
      on conflict (kind, scheduled_date) do update set message = excluded.message, updated_at = now(), resolved_at = null;
  end if;
  if job.status = 'running' and job.started_at > now() - interval '65 minutes' then return 'still running'; end if;
  if job.status = 'running' then
    update public.trendlens_job_runs set status = 'failed', error = 'Runner timed out', finished_at = now() where id = job.id;
  end if;
  if job.request_id is not null then
    select status_code into response_status from net._http_response where id = job.request_id;
    if response_status is not null and response_status <> 204 then
      update public.trendlens_job_runs set error = 'GitHub dispatch HTTP ' || response_status where id = job.id;
    end if;
  end if;
  if not p_retry or job.dispatch_count >= 3 then return 'check only or retry limit reached'; end if;
  if job.status = 'queued' and job.last_dispatched_at > now() - interval '20 minutes' then return 'already queued'; end if;
  if extract(isodow from local_now) < 6 and
    ((local_now::time >= time '09:00' and local_now::time < time '12:00') or
     (local_now::time >= time '14:00' and local_now::time < time '18:00')) then return 'deferred until off-peak'; end if;
  select decrypted_secret into token from vault.decrypted_secrets where name = 'trendlens_github_actions_token';
  if token is null then
    insert into public.trendlens_job_alerts (kind, scheduled_date, message)
      values (p_kind, today, '自动更新凭据未配置，暂时无法启动更新。')
      on conflict (kind, scheduled_date) do update set message = excluded.message, updated_at = now(), resolved_at = null;
    return 'missing credential';
  end if;
  workflow := case when p_kind = 'daily' then 'daily-pipeline.yml' else 'weekly-profile.yml' end;
  select net.http_post(
    url := 'https://api.github.com/repos/Jackdaw-L/TrendLens/actions/workflows/' || workflow || '/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || token, 'Accept', 'application/vnd.github+json',
      'Content-Type', 'application/json', 'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'TrendLens-Scheduler'),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('job_id', job.id::text, 'reason', 'supabase-schedule')),
    timeout_milliseconds := 15000
  ) into request;
  update public.trendlens_job_runs set status = 'queued', owner = null, request_id = request,
    dispatch_count = dispatch_count + 1, last_dispatched_at = now(), finished_at = null where id = job.id;
  return 'dispatched';
end;
$$;
revoke all on function trendlens_internal.dispatch_job(text, boolean, boolean) from public, anon, authenticated, service_role;
