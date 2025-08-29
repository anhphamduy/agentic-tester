create table if not exists public.test_suites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  status text not null default 'draft' check (status in ('draft','active','completed')),
  project_id text not null default 'global',
  folder_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Updated at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_test_suites_updated_at on public.test_suites;
create trigger set_test_suites_updated_at
before update on public.test_suites
for each row execute function public.set_updated_at();

-- Add JSONB state column to store runtime data (e.g., agent_state)
alter table if exists public.test_suites
  add column if not exists state jsonb not null default '{}'::jsonb;

-- Requirements table: stores AI-extracted requirement JSON
create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid references public.test_suites(id) on delete set null,
  req_code text not null,                           -- e.g. "REQ-1"
  source_doc text not null default '',              -- e.g. "spec.txt"
  content jsonb not null,                           -- AI-generated requirement object
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (suite_id, req_code)
);

-- Optional: GIN index for jsonb queries
create index if not exists idx_requirements_content_gin
  on public.requirements using gin (content);

-- Updated at trigger
drop trigger if exists set_requirements_updated_at on public.requirements;
create trigger set_requirements_updated_at
before update on public.requirements
for each row execute function public.set_updated_at();


-- Test cases table: stores AI-generated test cases JSON per requirement
create table if not exists public.test_cases (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  content jsonb not null,                           -- AI-generated test cases object
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_id)
);

-- Optional: indexes
create index if not exists idx_test_cases_requirement_id
  on public.test_cases (requirement_id);

create index if not exists idx_test_cases_content_gin
  on public.test_cases using gin (content);

-- Updated at trigger
drop trigger if exists set_test_cases_updated_at on public.test_cases;
create trigger set_test_cases_updated_at
before update on public.test_cases
for each row execute function public.set_updated_at();

alter table if exists public.test_cases
  add column if not exists suite_id uuid;

-- 2) Backfill suite_id from the linked requirement row
update public.test_cases tc
set suite_id = r.suite_id
from public.requirements r
where tc.requirement_id = r.id
  and (tc.suite_id is null or tc.suite_id <> r.suite_id);

create table if not exists public.team_events (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_team_events_suite_id on public.team_events (suite_id);
create index if not exists idx_team_events_payload_gin on public.team_events using gin (payload);

alter table if exists public.team_events
  add column if not exists message_id uuid;

update public.team_events
set message_id = gen_random_uuid()
where message_id is null;

alter table if exists public.team_events
  alter column message_id set not null;

