-- Add address column to customers (run if table already exists without address)
alter table customers add column if not exists address text default '';
