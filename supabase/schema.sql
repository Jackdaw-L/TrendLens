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
alter table public.trendlens_fetched_articles enable row level security;
