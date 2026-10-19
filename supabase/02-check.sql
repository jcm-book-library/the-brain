-- Optional check after the copy. SQL Editor > New query > paste > Run.
-- Shows each table's row count and confirms RLS is on. Reads only.
select c.relname as "table",
       c.relrowsecurity as rls_on,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from brain.%I', c.relname), false, true, '')))[1]::text::int as rows
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'brain' and c.relkind = 'r'
order by 1;
