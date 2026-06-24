-- Per-user data isolation migration
-- Run in Supabase SQL Editor after schema.sql (safe to re-run with IF NOT EXISTS / IF EXISTS)

-- Settings: one row per auth user
alter table if exists settings add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists settings drop constraint if exists settings_pkey;
alter table if exists settings drop column if exists id;

create unique index if not exists idx_settings_user on settings(user_id);

-- Shop data tables
alter table if exists items add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists transactions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists orders add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists customers add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists expenses add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table if exists items drop constraint if exists items_sku_key;
create unique index if not exists idx_items_user_sku on items(user_id, sku);

create index if not exists idx_items_user on items(user_id);
create index if not exists idx_transactions_user on transactions(user_id);
create index if not exists idx_orders_user on orders(user_id);

-- Attach existing shared data to your account (replace with your auth user id)
-- update settings set user_id = 'YOUR-USER-UUID' where user_id is null;
-- update items set user_id = 'YOUR-USER-UUID' where user_id is null;
-- update transactions set user_id = 'YOUR-USER-UUID' where user_id is null;
-- update orders set user_id = 'YOUR-USER-UUID' where user_id is null;

-- Optional: after backfilling user_id on every row, enforce per-user primary keys:
-- alter table items alter column user_id set not null;
-- alter table items add primary key (user_id, id);
-- alter table transactions alter column user_id set not null;
-- alter table transactions add primary key (user_id, id);
-- alter table orders alter column user_id set not null;
-- alter table orders add primary key (user_id, id);
-- alter table settings add primary key (user_id);
