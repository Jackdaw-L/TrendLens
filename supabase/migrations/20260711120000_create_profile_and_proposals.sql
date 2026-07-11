-- 兴趣画像：每周任务生成一行，日推选文读取最新一行
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

-- 信源提案：每周任务写入（新增建议 / 失效删除建议），设置页确认后执行
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

-- 信源删除墓碑：阻止 sources.yaml 的增量 seed 复活已删除的信源
create table if not exists public.trendlens_source_tombstones (
  id text primary key,
  deleted_at timestamptz not null default now()
);

alter table public.trendlens_profile enable row level security;
alter table public.trendlens_source_proposals enable row level security;
alter table public.trendlens_source_tombstones enable row level security;

grant select, insert, update, delete on public.trendlens_profile to service_role;
grant select, insert, update, delete on public.trendlens_source_proposals to service_role;
grant select, insert, update, delete on public.trendlens_source_tombstones to service_role;
