-- Migration: add user_id for per-user data
-- Run in Supabase SQL Editor when you see: column "user_id" does not exist
--
-- BEFORE RUNNING:
-- 1. Supabase Dashboard → Authentication → Users → copy your user UUID
-- 2. Replace YOUR_USER_UUID below (all 4 places in section 2)
-- 3. Run section 1, then section 2, then section 3
--
-- Safe to re-run section 1 (uses IF NOT EXISTS).

-- ── 1. Add user_id columns ──────────────────────────────────────────────────

alter table if exists settings add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists items add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists transactions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists orders add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists customers add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists expenses add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- ── 2. Backfill existing rows (replace YOUR_USER_UUID) ───────────────────────

update settings set user_id = 'YOUR_USER_UUID'::uuid where user_id is null;
update items set user_id = 'YOUR_USER_UUID'::uuid where user_id is null;
update transactions set user_id = 'YOUR_USER_UUID'::uuid where user_id is null;
update orders set user_id = 'YOUR_USER_UUID'::uuid where user_id is null;
update customers set user_id = 'YOUR_USER_UUID'::uuid where user_id is null;
update expenses set user_id = 'YOUR_USER_UUID'::uuid where user_id is null;

-- ── 3. Fix primary keys and indexes ─────────────────────────────────────────

-- settings: drop old id column if present, use user_id as PK
alter table if exists settings drop constraint if exists settings_pkey;
alter table if exists settings drop column if exists id;
alter table if exists settings alter column user_id set not null;
alter table if exists settings drop constraint if exists settings_user_id_pkey;
alter table if exists settings add primary key (user_id);

-- items
alter table if exists items drop constraint if exists items_pkey;
alter table if exists items drop constraint if exists items_sku_key;
alter table if exists items alter column user_id set not null;
alter table if exists items add primary key (user_id, id);
create unique index if not exists idx_items_user_sku on items(user_id, sku);
create index if not exists idx_items_user on items(user_id);

-- transactions
alter table if exists transactions drop constraint if exists transactions_pkey;
alter table if exists transactions alter column user_id set not null;
alter table if exists transactions add primary key (user_id, id);
create index if not exists idx_transactions_user on transactions(user_id);

-- orders
alter table if exists orders drop constraint if exists orders_pkey;
alter table if exists orders alter column user_id set not null;
alter table if exists orders add primary key (user_id, id);
create index if not exists idx_orders_user on orders(user_id);

-- customers / expenses (if tables exist)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'customers') then
    alter table customers drop constraint if exists customers_pkey;
    alter table customers alter column user_id set not null;
    alter table customers add primary key (user_id, id);
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'expenses') then
    alter table expenses drop constraint if exists expenses_pkey;
    alter table expenses alter column user_id set not null;
    alter table expenses add primary key (user_id, id);
  end if;
end $$;
