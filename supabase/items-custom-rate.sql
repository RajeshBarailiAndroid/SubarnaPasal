-- Manual rate per tola for "Other" metal items (run in Supabase SQL editor)
alter table if exists items
  add column if not exists custom_rate_per_tola numeric default 0;
