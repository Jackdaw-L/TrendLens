create table if not exists public.trendlens_sources (
  id text primary key,
  name text not null,
  url text not null,
  category text not null default 'analysis',
  language text default 'en',
  weight numeric default 1,
  enabled boolean not null default true,
  fetch_interval text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists trendlens_sources_url_idx
  on public.trendlens_sources (url);

create table if not exists public.trendlens_radar_runs (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1,
  mode text not null,
  generated_at timestamptz not null,
  status jsonb not null default '{}'::jsonb,
  topics jsonb not null default '[]'::jsonb,
  sources_snapshot jsonb not null default '[]'::jsonb,
  fetch_errors jsonb not null default '[]'::jsonb,
  rewrite_failures jsonb not null default '[]'::jsonb,
  article_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists trendlens_radar_runs_generated_at_idx
  on public.trendlens_radar_runs (generated_at desc);

create table if not exists public.trendlens_articles (
  run_id uuid not null references public.trendlens_radar_runs(id) on delete cascade,
  id text not null,
  topic_id text,
  source text,
  source_type text,
  published_at timestamptz,
  original_url text,
  category text,
  heat integer,
  reading_time integer,
  tags jsonb not null default '[]'::jsonb,
  title text not null,
  one_sentence text,
  why_recommended text,
  why_now text,
  pm_angle text,
  body_blocks jsonb not null default '[]'::jsonb,
  annotations jsonb not null default '[]'::jsonb,
  pm_takeaways jsonb not null default '[]'::jsonb,
  related_ids jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  hero_image jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, id)
);

create index if not exists trendlens_articles_id_idx
  on public.trendlens_articles (id);

create index if not exists trendlens_articles_published_at_idx
  on public.trendlens_articles (published_at desc);

create table if not exists public.trendlens_saved_articles (
  article_id text primary key,
  source_run_id uuid references public.trendlens_radar_runs(id) on delete set null,
  article_snapshot jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trendlens_saved_articles_saved_at_idx
  on public.trendlens_saved_articles (saved_at desc);

create index if not exists trendlens_saved_articles_source_run_id_idx
  on public.trendlens_saved_articles (source_run_id);

create table if not exists public.trendlens_read_articles (
  article_id text primary key,
  read_at timestamptz not null default now()
);

create index if not exists trendlens_read_articles_read_at_idx
  on public.trendlens_read_articles (read_at desc);

create table if not exists public.trendlens_profile (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null default now(),
  window_days integer not null default 14,
  profile_text text not null,
  selection_guidance text,
  stats jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb
);

create index if not exists trendlens_profile_generated_at_idx
  on public.trendlens_profile (generated_at desc);

create table if not exists public.trendlens_source_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null check (type in ('add', 'remove')),
  source_id text not null,
  name text not null,
  url text,
  category text,
  language text,
  weight numeric,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  resolved_at timestamptz
);

create index if not exists trendlens_source_proposals_status_idx
  on public.trendlens_source_proposals (status, created_at desc);

create table if not exists public.trendlens_source_tombstones (
  id text primary key,
  deleted_at timestamptz not null default now()
);

create table if not exists public.trendlens_fetched_articles (
  run_id uuid not null references public.trendlens_radar_runs(id) on delete cascade,
  id text not null,
  source_id text,
  source_name text,
  title text not null,
  url text,
  published_at timestamptz,
  parse_status text,
  image_count integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (run_id, id)
);

alter table public.trendlens_sources enable row level security;
alter table public.trendlens_radar_runs enable row level security;
alter table public.trendlens_articles enable row level security;
alter table public.trendlens_saved_articles enable row level security;
alter table public.trendlens_fetched_articles enable row level security;
alter table public.trendlens_read_articles enable row level security;
alter table public.trendlens_profile enable row level security;
alter table public.trendlens_source_proposals enable row level security;
alter table public.trendlens_source_tombstones enable row level security;

grant select, insert, update, delete on public.trendlens_saved_articles to service_role;
grant select, insert, update, delete on public.trendlens_read_articles to service_role;
grant select, insert, update, delete on public.trendlens_profile to service_role;
grant select, insert, update, delete on public.trendlens_source_proposals to service_role;
grant select, insert, update, delete on public.trendlens_source_tombstones to service_role;

-- Task RPCs and private Cron dispatch functions are defined in migrations/.
create table if not exists public.trendlens_job_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('daily', 'weekly')),
  scheduled_date date not null,
  is_scheduled boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  owner text,
  dispatch_count integer not null default 0,
  rewrite_failures jsonb not null default '[]'::jsonb,
  request_id bigint,
  last_dispatched_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create unique index if not exists trendlens_job_runs_daily_key on public.trendlens_job_runs (kind, scheduled_date) where is_scheduled;
create index if not exists trendlens_job_runs_created_idx on public.trendlens_job_runs (created_at desc);

create table if not exists public.trendlens_job_alerts (
  kind text not null check (kind in ('daily', 'weekly')),
  scheduled_date date not null,
  message text not null,
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (kind, scheduled_date)
);

create table if not exists public.trendlens_llm_usage (
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
create index if not exists trendlens_llm_usage_started_idx on public.trendlens_llm_usage (started_at desc);
create index if not exists trendlens_llm_usage_job_idx on public.trendlens_llm_usage (job_id);

alter table public.trendlens_job_runs enable row level security;
alter table public.trendlens_job_alerts enable row level security;
alter table public.trendlens_llm_usage enable row level security;
revoke all on public.trendlens_job_runs, public.trendlens_job_alerts, public.trendlens_llm_usage from anon, authenticated;
grant select, insert, update, delete on public.trendlens_job_runs, public.trendlens_job_alerts, public.trendlens_llm_usage to service_role;
