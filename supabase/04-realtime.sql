-- Live sync: let The Brain hear about changes as they happen, so a save on one device
-- shows on the others without pressing Refresh.
-- Safe to run more than once. Row level security still applies: each signed-in user
-- only hears about their own rows.
do $$
declare t text;
begin
  foreach t in array array['plan','routine','log','goals','people','lists','notes','links','settings'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'brain' and tablename = t) then
      execute format('alter publication supabase_realtime add table brain.%I', t);
    end if;
  end loop;
end $$;

-- Check: should list the nine brain tables.
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'brain'
order by tablename;
