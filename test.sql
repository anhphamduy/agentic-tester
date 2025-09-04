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

-- 1) Add version column with default 1
ALTER TABLE public.test_cases
ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- 2) Backfill existing rows to 1 explicitly (optional but makes value concrete)
UPDATE public.test_cases
SET version = 1
WHERE version IS NULL;

-- 3) Optional: add an index to quickly fetch the latest version per requirement
CREATE INDEX IF NOT EXISTS idx_test_cases_requirement_version
  ON public.test_cases (requirement_id, version DESC);

-- 4) Optional: enforce uniqueness per (requirement_id, version)
-- Comment out if you plan to allow overwrites at same version.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_test_cases_requirement_version'
  ) THEN
    ALTER TABLE public.test_cases
    ADD CONSTRAINT uq_test_cases_requirement_version
    UNIQUE (requirement_id, version);
  END IF;
END$$;

-- 5) Optional: trigger to auto-increment version per requirement on insert
-- If you prefer client-side control, skip this section.
CREATE OR REPLACE FUNCTION public.test_cases_set_next_version()
RETURNS trigger AS $$
DECLARE
  max_ver integer;
BEGIN
  IF NEW.version IS NULL THEN
    SELECT COALESCE(MAX(version), 0) INTO max_ver
    FROM public.test_cases
    WHERE requirement_id = NEW.requirement_id;

    NEW.version := max_ver + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_test_cases_set_next_version ON public.test_cases;
CREATE TRIGGER trg_test_cases_set_next_version
BEFORE INSERT ON public.test_cases
FOR EACH ROW
EXECUTE FUNCTION public.test_cases_set_next_version();

ALTER TABLE test_cases
DROP CONSTRAINT test_cases_requirement_id_key;

-- 001_create_test_designs_and_viewpoints.sql

-- Create enum for testing_type if useful across artifacts
do $$
begin
  if not exists (select 1 from pg_type where typname = 'testing_type_enum') then
    create type testing_type_enum as enum ('integration', 'unit', 'system');
  end if;
end$$;

-- test_designs table: stores one JSON document per generated design
create table if not exists public.test_designs (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid references public.test_suites(id) on delete cascade,
  testing_type testing_type_enum not null default 'integration',
  content jsonb not null, -- strict JSON from LLM: { sitemap_mermaid, flows[], ... }
  created_at timestamptz not null default now()
);
create index if not exists idx_test_designs_suite_id on public.test_designs(suite_id);
create index if not exists idx_test_designs_testing_type on public.test_designs(testing_type);

-- viewpoints table: one row per viewpoint item linked to requirement and test_design
create table if not exists public.viewpoints (
  id uuid primary key default gen_random_uuid(),
  suite_id uuid references public.test_suites(id) on delete cascade,
  test_design_id uuid references public.test_designs(id) on delete set null,
  requirement_id uuid references public.requirements(id) on delete set null,
  name text not null,
  rationale text,
  status text, -- 'Requirement' | 'Suggested' or org-specific status
  content jsonb, -- full raw item as produced by LLM for future-proofing
  created_at timestamptz not null default now()
);
create index if not exists idx_viewpoints_suite_id on public.viewpoints(suite_id);
create index if not exists idx_viewpoints_test_design_id on public.viewpoints(test_design_id);
create index if not exists idx_viewpoints_requirement_id on public.viewpoints(requirement_id);

-- Optional view to quickly get viewpoints with requirement code and suite
create or replace view public.viewpoints_with_req as
select
  v.id as viewpoint_id,
  v.name,
  v.status,
  v.rationale,
  v.suite_id,
  v.test_design_id,
  v.requirement_id,
  r.req_code,
  v.content,
  v.created_at
from public.viewpoints v
left join public.requirements r on r.id = v.requirement_id;

-- Optional RLS: enable if you already use RLS on your schema
-- alter table public.test_designs enable row level security;
-- alter table public.viewpoints enable row level security;
-- Then add suitable policies consistent with existing ones (omitted here).

-- 002_drop_status_from_test_designs_and_viewpoints.sql

-- If you previously added a status column to viewpoints, drop it
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'viewpoints' and column_name = 'status'
  ) then
    alter table public.viewpoints drop column status cascade;
  end if;
end$$;

-- No separate status column in test_designs; flows were inside JSON.
-- Optional: clean any embedded \"status\" keys from existing JSON content for consistency.

-- Remove status inside viewpoints.content JSON, if present
update public.viewpoints
set content = content - 'status'
where content ? 'status';

-- Remove status within test_designs.content.flows[*] JSON objects
-- This updates each flow object to strip the 'status' key.
with updated as (
  select
    id,
    jsonb_set(
      content,
      '{flows}',
      coalesce(
        (
          select jsonb_agg(
            case when jsonb_typeof(f) = 'object' then f - 'status' else f end
          )
          from jsonb_array_elements(content->'flows') as f
        ),
        '[]'::jsonb
      )
    ) as new_content
  from public.test_designs
  where content ? 'flows'
)
update public.test_designs td
set content = u.new_content
from updated u
where td.id = u.id;

-- Optional indexes (no-op if they already exist)
create index if not exists idx_viewpoints_requirement_id on public.viewpoints(requirement_id);
create index if not exists idx_viewpoints_test_design_id on public.viewpoints(test_design_id);
create index if not exists idx_test_designs_suite_id on public.test_designs(suite_id);