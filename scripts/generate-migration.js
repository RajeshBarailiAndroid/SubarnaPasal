#!/usr/bin/env node
/**
 * Print migration SQL with your auth user UUID filled in.
 * Usage: node scripts/generate-migration.js [USER_UUID]
 *        MIGRATE_USER_ID=... node scripts/generate-migration.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../lib/supabase');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listUsers() {
  const admin = getSupabase();
  if (!admin) return [];
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 50 });
  if (error) throw error;
  return data?.users || [];
}

async function main() {
  let userId = process.argv[2] || process.env.MIGRATE_USER_ID || '';

  if (!userId) {
    const users = await listUsers();
    if (!users.length) {
      console.error('No auth users found. Pass UUID: node scripts/generate-migration.js <uuid>');
      process.exit(1);
    }
    console.error('Available users (pick the one you log in with):\n');
    for (const user of users) {
      const meta = user.user_metadata || {};
      const username = meta.username || '';
      const name = meta.full_name || meta.name || '';
      console.error(`  ${user.id}  ${username || user.email}  ${name}`);
    }
    console.error('\nRe-run: npm run migrate:user-schema -- <uuid-above>');
    process.exit(1);
  }

  if (!UUID_RE.test(userId)) {
    console.error('Invalid UUID:', userId);
    process.exit(1);
  }

  const templatePath = path.join(__dirname, '..', 'supabase', 'per-user-data.sql');
  const sql = fs.readFileSync(templatePath, 'utf8').replaceAll('YOUR_USER_UUID', userId);

  const outPath = path.join(__dirname, '..', 'supabase', 'migration-ready.sql');
  fs.writeFileSync(outPath, sql);

  console.log(sql);
  console.error(`\n✓ Also saved to supabase/migration-ready.sql`);
  console.error('Paste into Supabase Dashboard → SQL → New query → Run');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
