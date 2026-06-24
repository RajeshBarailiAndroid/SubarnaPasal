const { createClient } = require('@supabase/supabase-js');
const { readEnv } = require('./env');

const url = readEnv('SUPABASE_URL');
const key =
  readEnv('SUPABASE_SERVICE_ROLE_KEY') ||
  readEnv('SUPABASE_SECRET_KEY') ||
  readEnv('SUPABASE_ANON_KEY');

const PLACEHOLDER_PATTERNS = ['YOUR_PROJECT_REF', 'your-service-role-key', 'your-anon-key'];

function isOpaqueSecretKey(value) {
  return value.startsWith('sb_secret_');
}

function hasValidCredentials() {
  if (!url || !key) return false;
  if (key.startsWith('sb_publishable_')) return false;
  return !PLACEHOLDER_PATTERNS.some((p) => url.includes(p) || key.includes(p));
}

function isSupabaseEnabled() {
  return hasValidCredentials();
}

function supabaseConfigStatus() {
  const hasUrl = Boolean(url && url.includes('supabase.co'));
  const hasKey = Boolean(key);
  const valid = hasValidCredentials();
  let reason = null;
  if (!hasUrl) reason = 'SUPABASE_URL is missing or invalid';
  else if (!hasKey) reason = 'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) is missing';
  else if (key.startsWith('sb_publishable_')) reason = 'Use the secret/service key on the server, not the publishable key';
  else if (!valid) reason = 'Supabase env vars still contain placeholder values';
  return { hasUrl, hasKey, valid, reason };
}

function createServiceClientOptions() {
  const options = {
    auth: { persistSession: false, autoRefreshToken: false }
  };

  // sb_secret_ keys are not JWTs — apikey header only (no Authorization).
  if (isOpaqueSecretKey(key)) {
    options.global = {
      headers: { apikey: key },
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers || {});
        headers.set('apikey', key);
        const auth = headers.get('Authorization') || '';
        if (!/^Bearer\s+eyJ/i.test(auth)) {
          headers.delete('Authorization');
        }
        return fetch(input, { ...init, headers });
      }
    };
  }

  return options;
}

let client = null;

function getSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!client) {
    client = createClient(url, key, createServiceClientOptions());
  }
  return client;
}

async function checkSupabaseConnection() {
  const status = supabaseConfigStatus();
  if (!status.valid) {
    return { ok: false, ...status, error: status.reason };
  }

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('settings').select('user_id', { head: true, count: 'exact' });
    if (error) {
      return { ok: false, ...status, error: error.message };
    }
    return { ok: true, ...status, error: null };
  } catch (err) {
    return { ok: false, ...status, error: err.message || 'Connection failed' };
  }
}

module.exports = {
  getSupabase,
  isSupabaseEnabled,
  supabaseConfigStatus,
  checkSupabaseConnection,
  createServiceClientOptions
};
