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
