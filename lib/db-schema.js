const REQUIRED_TABLES = [
  'settings',
  'items',
  'transactions',
  'orders',
  'customers',
  'expenses',
  'users'
];

const CORE_TABLES = ['settings', 'items', 'transactions', 'orders'];

function supabaseErrorMessage(error) {
  if (!error) return '';
  return String(error.message || error.hint || error.code || '').trim();
}

function isMissingTableError(error) {
  const message = supabaseErrorMessage(error);
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    /does not exist/i.test(message) ||
    /could not find the table/i.test(message)
  );
}

function isMissingUserIdColumnError(error) {
  const message = supabaseErrorMessage(error);
  return error?.code === '42703' || /column\s+[\w.]+\.user_id\s+does not exist/i.test(message);
}

function missingUserIdMessage() {
  return 'Database schema is outdated (column user_id missing). Run supabase/per-user-data.sql in the Supabase SQL Editor and replace YOUR_USER_UUID with your auth user id.';
}

function missingTablesMessage(missingTables) {
  const list = missingTables.join(', ');
  return `Database tables missing (${list}). Run supabase/schema.sql in the Supabase SQL Editor for the project in Vercel SUPABASE_URL.`;
}

module.exports = {
  REQUIRED_TABLES,
  CORE_TABLES,
  supabaseErrorMessage,
  isMissingTableError,
  isMissingUserIdColumnError,
  missingUserIdMessage,
  missingTablesMessage
};
