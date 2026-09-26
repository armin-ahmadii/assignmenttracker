-- Single-user sync without accounts.
--
-- Each device holds one secret sync key. Only its SHA-256 hash is stored.
-- The tables are closed to direct API access; the app calls the due_* functions
-- below, which check the key before reading or writing anything.

-- 1. No more per-account rows.
drop policy if exists "own courses" on public.courses;
drop policy if exists "own work items" on public.work_items;
drop policy if exists "own recurring rules" on public.recurring_rules;

alter table public.courses drop column user_id;
alter table public.work_items drop column user_id;
alter table public.recurring_rules drop column user_id;

-- Dropping user_id dropped the old (user_id, server_updated_at) indexes.
create index courses_pull on public.courses (server_updated_at);
create index work_items_pull on public.work_items (server_updated_at);
create index recurring_rules_pull on public.recurring_rules (server_updated_at);

-- RLS stays on with no policies, and the API roles lose table privileges:
-- nothing reaches these tables except through the functions below.
revoke all on public.courses, public.work_items, public.recurring_rules from anon, authenticated;

-- 2. Last write wins, as before (without the user_id bookkeeping).
create or replace function public.due_last_write_wins()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

-- 3. The key, stored as a hash in a schema the API doesn't expose.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.sync_keys (
  hash text primary key,
  created_at timestamptz not null default now()
);

create or replace function private.key_hash(key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(key, ''), 'UTF8')), 'hex');
$$;

create or replace function private.require_key(key text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from private.sync_keys where hash = private.key_hash(key)) then
    raise exception 'invalid sync key' using errcode = '28000';
  end if;
end;
$$;

-- 4. What the app calls.

-- The first device to turn on sync sets the key. Afterwards this always returns false.
create or replace function public.due_claim(key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(coalesce(key, '')) < 20 then
    raise exception 'sync key too short' using errcode = '22023';
  end if;
  lock table private.sync_keys in exclusive mode;
  if exists (select 1 from private.sync_keys) then
    return false;
  end if;
  insert into private.sync_keys (hash) values (private.key_hash(key));
  return true;
end;
$$;

create or replace function public.due_check(key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.sync_keys where hash = private.key_hash(key));
$$;

-- Upsert a batch of rows (snake_case JSON objects). Older edits are skipped by the trigger.
create or replace function public.due_push(key text, tbl text, rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cols text;
  updates text;
  affected integer;
begin
  perform private.require_key(key);
  if tbl not in ('courses', 'work_items', 'recurring_rules') then
    raise exception 'unknown table %', tbl using errcode = '22023';
  end if;

  select string_agg(format('%I', attname), ', ' order by attnum),
         string_agg(format('%I = excluded.%I', attname, attname), ', ' order by attnum) filter (where attname <> 'id')
    into cols, updates
    from pg_catalog.pg_attribute
   where attrelid = pg_catalog.to_regclass('public.' || tbl)
     and attnum > 0
     and not attisdropped
     and attname <> 'server_updated_at';

  execute format(
    'insert into public.%I (%s) select %s from pg_catalog.jsonb_populate_recordset(null::public.%I, $1) '
    'on conflict (id) do update set %s',
    tbl, cols, cols, tbl, updates
  ) using rows;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Rows changed after `since` (all rows when null), oldest change first.
create or replace function public.due_pull(key text, tbl text, since timestamptz default null, max_rows integer default 1000)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_key(key);
  if tbl not in ('courses', 'work_items', 'recurring_rules') then
    raise exception 'unknown table %', tbl using errcode = '22023';
  end if;

  execute format(
    'select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by t.server_updated_at), ''[]''::jsonb) '
    'from (select * from public.%I where $1 is null or server_updated_at > $1 order by server_updated_at limit $2) t',
    tbl
  ) into result using since, least(greatest(coalesce(max_rows, 1000), 1), 5000);
  return result;
end;
$$;

revoke all on function private.key_hash(text), private.require_key(text) from public, anon, authenticated;
revoke all on function
  public.due_claim(text),
  public.due_check(text),
  public.due_push(text, text, jsonb),
  public.due_pull(text, text, timestamptz, integer)
  from public;
grant execute on function
  public.due_claim(text),
  public.due_check(text),
  public.due_push(text, text, jsonb),
  public.due_pull(text, text, timestamptz, integer)
  to anon, authenticated;
