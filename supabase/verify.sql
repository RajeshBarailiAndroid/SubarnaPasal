-- Verify SubarnaPasal schema (run in Supabase SQL Editor)
-- Each row should list a table. "user_id_ok = no" means run supabase/per-user-data.sql

select
  t.table_name,
  case
    when c.column_name is not null then 'yes'
    else 'no'
  end as user_id_ok
from (
  values
    ('settings'),
    ('items'),
    ('transactions'),
    ('orders'),
    ('customers'),
    ('expenses'),
    ('users')
) as expected(table_name)
left join information_schema.tables t
  on t.table_schema = 'public' and t.table_name = expected.table_name
left join information_schema.columns c
  on c.table_schema = 'public'
  and c.table_name = expected.table_name
  and c.column_name = 'user_id'
order by expected.table_name;
