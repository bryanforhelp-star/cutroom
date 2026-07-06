-- cutroom schema · run once in Supabase SQL editor
-- single-user app: RLS = "any authenticated user can do anything"

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  orientation text not null default '9:16',
  -- created -> uploading -> transcribing -> ready -> error
  status text not null default 'created',
  source_asset_id uuid,
  error text,
  created_at timestamptz not null default now()
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,                    -- 'source' | 'broll' | 'audio'
  storage_path text not null,
  duration numeric,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table transcripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  words jsonb not null,                  -- [{word, start, end}] seconds, source time
  created_at timestamptz not null default now()
);

create table edit_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version int not null,
  edl jsonb not null,
  created_at timestamptz not null default now()
);

create table render_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  edit_list_id uuid not null references edit_lists(id) on delete cascade,
  -- queued -> processing -> done | error
  status text not null default 'queued',
  output_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role text not null,                    -- 'user' | 'assistant'
  content text not null,
  created_at timestamptz not null default now()
);

-- indexes for the worker's poll queries
create index idx_render_jobs_status on render_jobs(status);
create index idx_projects_status on projects(status);

-- RLS: lock everything to authenticated users (you). service_role bypasses.
alter table projects enable row level security;
alter table assets enable row level security;
alter table transcripts enable row level security;
alter table edit_lists enable row level security;
alter table render_jobs enable row level security;
alter table ai_messages enable row level security;

create policy "auth all" on projects   for all to authenticated using (true) with check (true);
create policy "auth all" on assets     for all to authenticated using (true) with check (true);
create policy "auth all" on transcripts for all to authenticated using (true) with check (true);
create policy "auth all" on edit_lists for all to authenticated using (true) with check (true);
create policy "auth all" on render_jobs for all to authenticated using (true) with check (true);
create policy "auth all" on ai_messages for all to authenticated using (true) with check (true);

-- storage: create a PRIVATE bucket named `media` in the dashboard, then:
create policy "auth read media"   on storage.objects for select to authenticated using (bucket_id = 'media');
create policy "auth write media"  on storage.objects for insert to authenticated with check (bucket_id = 'media');
create policy "auth update media" on storage.objects for update to authenticated using (bucket_id = 'media');

-- bump the bucket file size limit (default 50MB is too small for source video):
-- dashboard → storage → media → edit bucket → file size limit → 2GB (or project setting on paid tier)
