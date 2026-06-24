#!/usr/bin/env node
/**
 * Apply supabase/per-user-data.sql using a direct Postgres connection.
 *
 * Add to .env (from Supabase Dashboard → Settings → Database → Connection string → URI):
 *   SUPABASE_DB_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
 *
 * Usage: npm run apply:migration
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { checkSupabaseConnection } = require('../lib/supabase');

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Missing SUPABASE_DB_URL in .env');
    console.error('');
    console.error('Get it from: Supabase Dashboard → Settings → Database → Connection string → URI');
    console.error('Then add to .env:');
    console.error('  SUPABASE_DB_URL=postgresql://postgres.[ref]:[PASSWORD]@...');
    console.error('');
    console.error('Or paste supabase/per-user-data.sql into Supabase → SQL → Run');
    process.exit(1);
  }

  let pg;
  try {
    pg = require('pg');
  } catch (_) {
    console.error('Install pg first: npm install pg');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, '..', 'supabase', 'per-user-data.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Applying migration from supabase/per-user-data.sql...\n');

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  try {
    await client.query(sql);
    console.log('✅ Migration applied successfully\n');
  } finally {
    await client.end();
  }

  const health = await checkSupabaseConnection();
  if (health.ok) {
    console.log('✅ Database check passed');
    for (const table of Object.values(health.tables || {})) {
      console.log(`   ${table.table}: ${table.count ?? 0} rows`);
    }
  } else {
    console.log('⚠ Migration ran but check still reports:', health.error);
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message || err);
  process.exit(1);
});
