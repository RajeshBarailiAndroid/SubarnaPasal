-- Verify SubarnaPasal tables (run in Supabase SQL Editor)
-- You should see 4+ rows. "Success. No rows returned" means tables are MISSING.

select
  t.table_name,
  (xpath('/row/cnt/text()', xml_count))[1]::text::int as row_count
from information_schema.tables t
left join lateral (
  select query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '') as xml_count
) x on true
where t.table_schema = 'public'
  and t.table_name in ('settings', 'items', 'transactions', 'orders', 'customers', 'expenses', 'users')
order by t.table_name;
