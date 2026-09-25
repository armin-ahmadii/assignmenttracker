-- Due: schema for courses, work items and recurring rules.
--
-- Every row belongs to one user and is only visible to that user (row-level security).
-- The app is local-first: ids are generated on the device, deletes are soft
-- (deleted_at) so they reach other devices, and conflicts resolve by the
-- client's updated_at (last write wins). server_updated_at is the pull cursor.

create table public.courses (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null,
  term text not null,
  active boolean not null default true,
  site text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.work_items (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  course_id text not null,
  type text not null default 'Assignment'
    check (type in ('Assignment', 'Lab', 'Quiz', 'Exam', 'Project', 'Reading')),
  due timestamptz not null,
  due_tz text not null,
  status text not null default 'Not started'
    check (status in ('Not started', 'In progress', 'Submitted')),
  do_date date,
  weight numeric check (weight between 0 and 100),
  effort text check (effort in ('S', 'M', 'L')),
  link text,
  grade numeric check (grade between 0 and 100),
  notes text not null default '',
  checklist jsonb not null default '[]',
  parent_id text,
  submitted_at timestamptz,
  requirements text not null default '',
  when_where text not null default '',
  links jsonb not null default '[]',
  rule_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.recurring_rules (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id text not null,
  type text not null default 'Lab',
  name_pattern text not null,
  weekday smallint not null check (weekday between 0 and 6),
  due_time text not null default '23:59',
  start_date date not null,
  end_date date,
  tz text not null,
  next_n integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

-- Pull queries: "everything of mine changed since X".
create index courses_pull on public.courses (user_id, server_updated_at);
create index work_items_pull on public.work_items (user_id, server_updated_at);
create index recurring_rules_pull on public.recurring_rules (user_id, server_updated_at);

-- Last write wins: an upsert carrying an older updated_at than the stored row is skipped.
create or replace function public.due_last_write_wins()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.user_id := coalesce(old.user_id, new.user_id);
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger courses_lww before insert or update on public.courses
  for each row execute function public.due_last_write_wins();
create trigger work_items_lww before insert or update on public.work_items
  for each row execute function public.due_last_write_wins();
create trigger recurring_rules_lww before insert or update on public.recurring_rules
  for each row execute function public.due_last_write_wins();

-- Row-level security: a user sees and changes only their own rows.
alter table public.courses enable row level security;
alter table public.work_items enable row level security;
alter table public.recurring_rules enable row level security;

create policy "own courses" on public.courses
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own work items" on public.work_items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own recurring rules" on public.recurring_rules
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
