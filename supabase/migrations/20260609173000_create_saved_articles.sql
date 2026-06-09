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

alter table public.trendlens_saved_articles enable row level security;

grant select, insert, update, delete on public.trendlens_saved_articles to service_role;
