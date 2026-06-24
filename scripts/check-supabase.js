#!/usr/bin/env node
require('dotenv').config();
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');

const PLACEHOLDER_PATTERNS = [
  'YOUR_PROJECT_REF',
  'your-service-role-key',
  'your-anon-key'
];

function envStatus() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!url || !key) {
    return { ok: false, reason: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env' };
  }

  const hasPlaceholder = PLACEHOLDER_PATTERNS.some((p) => url.includes(p) || key.includes(p));
  if (hasPlaceholder) {
    return { ok: false, reason: '.env still has placeholder values — paste real Supabase credentials' };
  }

  if (!url.includes('supabase.co')) {
    return { ok: false, reason: 'SUPABASE_URL does not look like a Supabase project URL' };
  }

  if (key.startsWith('sb_publishable_')) {
    return {
      ok: false,
      reason: 'Wrong key type: sb_publishable_ is for the browser. Use the service_role / secret key on the server.'
    };
  }

  return { ok: true, url: url.replace(/^(https:\/\/[^.]+).*/, '$1...') };
}

async function main() {
  console.log('SubarnaPasal — Supabase connection check\n');

  const env = envStatus();
  if (!env.ok) {
    console.log('❌ Config:', env.reason);
    console.log('\nGet keys from: Supabase Dashboard → Project Settings → API');
    process.exit(1);
  }

  console.log('✓ Config:', env.url);

  if (!isSupabaseEnabled()) {
    console.log('❌ Supabase client could not be created');
    process.exit(1);
  }

  const supabase = getSupabase();

  const tables = ['settings', 'items', 'transactions', 'orders'];
  for (const table of tables) {
    const { error, count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      const detail = error.message || error.hint || error.code || 'unknown error';
      console.log(`❌ Table "${table}": ${detail}`);
      if (error.message.includes('does not exist') || error.code === '42P01') {
        console.log('   → Run supabase/schema.sql in the SQL Editor first.');
      }
      process.exit(1);
    }
    console.log(`✓ Table "${table}": reachable (${count ?? 0} rows)`);
  }

  const { count: settingsCount, error: settingsError } = await supabase
    .from('settings')
    .select('*', { count: 'exact', head: true });

  if (settingsError) {
    console.log('❌ Settings read:', settingsError.message);
    process.exit(1);
  }

  console.log(`✓ Settings rows: ${settingsCount ?? 0}`);

  console.log('\n✅ Supabase connection OK');
}

main().catch((err) => {
  const msg = err.message || String(err);
  if (msg.includes('fetch failed') || err.cause?.code === 'ENOTFOUND') {
    console.log('❌ Connection failed: cannot reach Supabase URL');
    console.log('   → Check SUPABASE_URL in .env matches your project (Dashboard → Settings → API)');
    process.exit(1);
  }
  console.log('❌ Connection failed:', msg);
  process.exit(1);
});
