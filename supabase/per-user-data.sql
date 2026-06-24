-- Migration: add user_id for per-user data
-- Run in Supabase SQL Editor when you see: column "user_id" does not exist
--
-- 1. Change owner_id below ONLY if you log in with a different account
--    (Supabase → Authentication → Users → copy UUID)
-- 2. Paste this entire file and click Run
--
-- Safe to re-run section 1 (uses IF NOT EXISTS).

-- ── 1. Add user_id columns ──────────────────────────────────────────────────

alter table if exists settings add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists items add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists transactions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists orders add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists customers add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table if exists expenses add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- ── 2. Backfill existing rows ───────────────────────────────────────────────
-- rajeshbaraili / rajeshsurunga@gmail.com — change if you use another login

do $migration$
declare
  owner_id uuid := '6742f2b6-9a63-45c2-baf9-d588a9c04cff';
begin
  update settings set user_id = owner_id where user_id is null;
  update items set user_id = owner_id where user_id is null;
  update transactions set user_id = owner_id where user_id is null;
  update orders set user_id = owner_id where user_id is null;
  update customers set user_id = owner_id where user_id is null;
  update expenses set user_id = owner_id where user_id is null;
end
$migration$;

-- ── 3. Fix primary keys and indexes ─────────────────────────────────────────

alter table if exists settings drop constraint if exists settings_pkey;
alter table if exists settings drop column if exists id;
alter table if exists settings alter column user_id set not null;
alter table if exists settings drop constraint if exists settings_user_id_pkey;
alter table if exists settings add primary key (user_id);

alter table if exists items drop constraint if exists items_pkey;
alter table if exists items drop constraint if exists items_sku_key;
alter table if exists items alter column user_id set not null;
alter table if exists items add primary key (user_id, id);
create unique index if not exists idx_items_user_sku on items(user_id, sku);
create index if not exists idx_items_user on items(user_id);

alter table if exists transactions drop constraint if exists transactions_pkey;
alter table if exists transactions alter column user_id set not null;
alter table if exists transactions add primary key (user_id, id);
create index if not exists idx_transactions_user on transactions(user_id);

alter table if exists orders drop constraint if exists orders_pkey;
alter table if exists orders alter column user_id set not null;
alter table if exists orders add primary key (user_id, id);
create index if not exists idx_orders_user on orders(user_id);

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
