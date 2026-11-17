-- The Brain: workouts (exercise library, routines, sessions and sets).
-- Run once in Supabase: SQL Editor > New query > paste all of this > Run.
-- Safe to run again: it only creates what is missing and resets the access rules.
-- Same rules as 01-schema.sql: every row has user_id (filled in from whoever is
-- signed in), Row Level Security shows each signed-in user only their own rows,
-- and signed-out visitors get nothing. The app fills in the starting exercise
-- library and routines itself the first time Workouts opens.
-- These tables live in Supabase only; they are not copied to the Google Sheet.

create table if not exists brain.exercises (
  row_id     bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,
  name       text not null,
  area       text,                            -- Upper, Core, Legs, Cardio
  muscle     text,                            -- Chest, Back, Shoulders, Biceps, Triceps, Core, Legs, Cardio
  equipment  text,                            -- Dumbbell, Kettlebell, Ball, Bodyweight, Machine (comma separated)
  measure    text not null default 'reps',    -- reps, time, cardio
  each_side  boolean not null default false,  -- one arm or one side at a time
  weighted   boolean not null default true,
  secs       numeric,                         -- default time for a timed exercise (plank 60)
  active     boolean not null default true,   -- false = paused (e.g. lunges while the foot heals)
  note       text,
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

-- Added 17 Nov 2026 (for anyone who ran the first version of this file).
alter table brain.exercises add column if not exists equipment text;

create table if not exists brain.workout_routines (
  row_id      bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  id          text not null,
  name        text not null,                  -- Morning, Afternoon
  ladder      text,                           -- reps per round, e.g. 10,8,6
  items       text,                           -- exercise ids in order, comma separated
  rep_secs    numeric,                        -- calculator: seconds per rep
  change_secs numeric,                        -- calculator: change-over between exercises
  rest_secs   numeric,                        -- calculator: rest between rounds
  note        text,
  updated_at  timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists brain.workout_sessions (
  row_id      bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  id          text not null,
  date        date not null,
  routine_id  text,
  ladder      text,
  started_at  timestamptz,
  finished_at timestamptz,
  place       text,
  feel        text,
  note        text,
  updated_at  timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists brain.workout_sets (
  row_id      bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  id          text not null,
  session_id  text not null,
  exercise_id text not null,
  round       numeric,
  reps        numeric,
  kg          numeric,
  secs        numeric,
  mins        numeric,
  km          numeric,
  steps       numeric,
  done_at     timestamptz,
  updated_at  timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists workout_sets_session_idx on brain.workout_sets (user_id, session_id);
create index if not exists workout_sets_exercise_idx on brain.workout_sets (user_id, exercise_id);

do $$
declare t text;
begin
  foreach t in array array['exercises','workout_routines','workout_sessions','workout_sets'] loop
    execute format('alter table brain.%I enable row level security', t);
    execute format('create index if not exists %I on brain.%I (user_id)', t || '_user_idx', t);
    execute format('drop trigger if exists touch on brain.%I', t);
    execute format('create trigger touch before update on brain.%I for each row execute function brain.touch()', t);
    execute format('drop policy if exists "own rows" on brain.%I', t);
    execute format('create policy "own rows" on brain.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    -- live sync between devices
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'brain' and tablename = t) then
      execute format('alter publication supabase_realtime add table brain.%I', t);
    end if;
  end loop;
end $$;

-- Access: signed-in users only (RLS above narrows that to their own rows).
revoke all on all tables in schema brain from anon, public;
grant select, insert, update, delete on all tables in schema brain to authenticated;
grant usage, select on all sequences in schema brain to authenticated;

-- Tell the Data API to pick up the new tables.
notify pgrst, 'reload schema';

-- Check: should list the four new tables, each with RLS on.
select c.relname as table_name, c.relrowsecurity as rls_on
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'brain' and c.relname in ('exercises','workout_routines','workout_sessions','workout_sets')
order by 1;
