-- The Brain on Supabase: tables, access and Row Level Security.
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run.
-- Safe to run again: it only creates what is missing and resets the access rules.
--
-- Every row carries user_id (filled in automatically from whoever is signed in).
-- RLS lets a signed-in user see and change only their own rows. Signed-out
-- visitors (the "anon" role) get no access at all.

create schema if not exists brain;

create table if not exists brain.plan (
  row_id     bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,
  date       date,
  end_date   date,
  time       text,
  title      text,
  category   text,
  type       text,
  done       boolean not null default false,
  countdown  boolean not null default false,
  notes      text,
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists brain.routine (
  row_id     bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  day        text,
  category   text,
  time       text,
  title      text not null,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists brain.log (
  row_id      bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  date        date not null,
  steps       numeric,
  km          numeric,
  active_mins numeric,
  pages       numeric,
  max_c       numeric,
  min_c       numeric,
  mood        text,
  note        text,
  updated_at  timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists brain.goals (
  row_id      bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  year        numeric not null,
  month       numeric,
  steps       numeric,
  km          numeric,
  active_mins numeric,
  pages       numeric,
  updated_at  timestamptz not null default now(),
  unique (user_id, year, month)
);

create table if not exists brain.people (
  row_id         bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  id             text not null,
  name           text,
  birthday       date,
  last_seen      date,
  to_see         boolean not null default false,
  see_every_days numeric,
  notes          text,
  groups         text,
  links          text,
  next_catchup   date,
  next_time      text,
  catchup_plan   text,
  plan_id        text,
  updated_at     timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists brain.lists (
  row_id     bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,
  list       text,
  item       text,
  status     text,
  added      date,
  notes      text,
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists brain.notes (
  row_id     bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,
  date       date,
  topic      text,
  note       text,
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists brain.links (
  row_id     bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  category   text,
  url        text,
  pin        boolean not null default false,
  sort_order numeric,
  notes      text,
  updated_at timestamptz not null default now()
);

create table if not exists brain.settings (
  row_id     bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  key        text not null,
  value      text,
  notes      text,
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

-- Keep updated_at current on every change.
create or replace function brain.touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['plan','routine','log','goals','people','lists','notes','links','settings'] loop
    execute format('alter table brain.%I enable row level security', t);
    execute format('create index if not exists %I on brain.%I (user_id)', t || '_user_idx', t);
    execute format('drop trigger if exists touch on brain.%I', t);
    execute format('create trigger touch before update on brain.%I for each row execute function brain.touch()', t);
    execute format('drop policy if exists "own rows" on brain.%I', t);
    execute format('create policy "own rows" on brain.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Access: signed-in users only (RLS above narrows that to their own rows).
revoke all on schema brain from anon, public;
revoke all on all tables in schema brain from anon, public;
grant usage on schema brain to authenticated;
grant select, insert, update, delete on all tables in schema brain to authenticated;
grant usage, select on all sequences in schema brain to authenticated;
revoke execute on function brain.touch() from public, anon, authenticated;

-- Tell the Data API to pick up the new tables.
notify pgrst, 'reload schema';
