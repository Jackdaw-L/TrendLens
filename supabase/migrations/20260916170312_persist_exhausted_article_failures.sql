alter table public.trendlens_job_runs
  add column if not exists rewrite_failures jsonb not null default '[]'::jsonb;
