-- Shared gold rate data (common for all users / logins)
-- Run in Supabase SQL Editor after schema.sql

create table if not exists shared_gold_rates (
  id text primary key default 'global',
  ticks jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);

insert into shared_gold_rates (id, ticks, history)
values ('global', '[]'::jsonb, '[]'::jsonb)
on conflict (id) do nothing;
