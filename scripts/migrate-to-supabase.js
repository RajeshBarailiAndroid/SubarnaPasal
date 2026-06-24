#!/usr/bin/env node
/**
 * One-time migration: data/store.json → Supabase for a specific user
 * Usage: MIGRATE_USER_ID=<auth-user-uuid> node scripts/migrate-to-supabase.js
 */
require('dotenv').config();
const {
  readJsonStore,
  writeSupabaseStore,
  isSupabaseEnabled,
  LOCAL_DEV_USER_ID
} = require('../lib/store');
const { getSupabase } = require('../lib/supabase');

async function main() {
  if (!isSupabaseEnabled()) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
    process.exit(1);
  }

  const userId = process.env.MIGRATE_USER_ID;
  if (!userId) {
    console.error('Set MIGRATE_USER_ID to your Supabase auth user UUID.');
    console.error('Find it in Dashboard → Authentication → Users.');
    process.exit(1);
  }

  const store = readJsonStore(LOCAL_DEV_USER_ID);
  const supabase = getSupabase();

  console.log('Checking Supabase tables...');
  const { error: settingsCheck } = await supabase.from('settings').select('user_id').limit(1);
  if (settingsCheck) {
    console.error('Supabase tables missing or outdated. Run supabase/per-user-data.sql in the SQL Editor first.');
    console.error(settingsCheck.message);
    process.exit(1);
  }

  console.log(`Migrating data to user ${userId}...`);
  console.log(`  ${store.items.length} items, ${store.transactions.length} transactions, ${store.orders.length} orders`);
  await writeSupabaseStore(store, userId);

  const { count: itemCount } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('user_id', userId);
  const { count: txCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('user_id', userId);
  const { count: orderCount } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('user_id', userId);

  console.log('Migration complete.');
  console.log(`  Settings: ${store.settings.shopName}`);
  console.log(`  Items: ${itemCount}`);
  console.log(`  Transactions: ${txCount}`);
  console.log(`  Orders: ${orderCount}`);
  console.log('\nRestart the server and sign in as that user to see the data.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
