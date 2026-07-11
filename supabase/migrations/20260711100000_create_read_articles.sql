create table if not exists public.trendlens_read_articles (
  article_id text primary key,
  read_at timestamptz not null default now()
);

create index if not exists trendlens_read_articles_read_at_idx
  on public.trendlens_read_articles (read_at desc);

alter table public.trendlens_read_articles enable row level security;

grant select, insert, update, delete on public.trendlens_read_articles to service_role;
