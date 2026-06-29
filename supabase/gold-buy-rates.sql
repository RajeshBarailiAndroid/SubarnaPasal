-- Add gold buy (purchase) rate columns to settings.
-- Run in Supabase SQL Editor if your project was created before this migration.

alter table settings
  add column if not exists gold_buy_rate_per_tola numeric default 0,
  add column if not exists gold_buy_rate_per_gram numeric default 0;
