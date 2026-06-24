-- SubarnaPasal database schema (per-user data)
-- Run ONCE in Supabase SQL Editor (Dashboard → SQL → New query)
--
-- IMPORTANT (production / Vercel):
-- 1. Vercel → Settings → Environment Variables → copy SUPABASE_URL
-- 2. Open that exact Supabase project in the dashboard
-- 3. Paste this entire file and click Run
-- 4. Run supabase/verify.sql to confirm tables exist
--
-- If you already ran an older schema, run supabase/per-user-data.sql instead.
--
-- Safe to re-run: all statements use IF NOT EXISTS.

create table if not exists settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  shop_name text not null default 'SubarnaPasal',
  shop_address text default '',
  shop_phone text default '',
  price_mode text default 'manual',
  gold_rate_per_tola numeric default 0,
  gold_rate_per_gram numeric default 0,
  silver_rate_per_tola numeric default 0,
  silver_rate_per_gram numeric default 0,
  currency text default 'USD',
  locations jsonb default '[]'::jsonb,
  rate_history jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists items (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text not null,
  name text not null,
  category text default 'other',
  karat numeric default 22,
  weight_grams numeric default 0,
  making_charge numeric default 0,
  purchase_cost numeric default 0,
  quantity integer default 0,
  status text default 'in_stock',
  location text default '',
  hallmark boolean default true,
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

create table if not exists transactions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  item_id text,
  item_name text,
  quantity integer default 0,
  amount numeric,
  note text default '',
  created_at timestamptz default now(),
  primary key (user_id, id)
);

create table if not exists orders (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  order_number text not null,
  customer_name text not null,
  customer_phone text default '',
  status text default 'pending',
  lines jsonb default '[]'::jsonb,
  total_amount numeric default 0,
  note text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, id)
);

create unique index if not exists idx_items_user_sku on items(user_id, sku);
create index if not exists idx_items_user on items(user_id);
create index if not exists idx_items_status on items(status);
create index if not exists idx_transactions_user on transactions(user_id);
create index if not exists idx_transactions_created_at on transactions(created_at desc);
create index if not exists idx_orders_user on orders(user_id);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_created_at on orders(created_at desc);

create table if not exists customers (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text default '',
  email text default '',
  created_at timestamptz default now(),
  primary key (user_id, id)
);

create table if not exists expenses (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  amount numeric not null default 0,
  category text default 'other',
  date date default current_date,
  created_at timestamptz default now(),
  primary key (user_id, id)
);

create table if not exists users (
  id text primary key,
  name text not null,
  role text default 'staff',
  email text default '',
  created_at timestamptz default now()
);
