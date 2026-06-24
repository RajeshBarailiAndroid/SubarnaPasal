const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_ANON_KEY;

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

let client = null;

function getSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!client) {
    const options = {
      auth: { persistSession: false, autoRefreshToken: false }
    };

    // New sb_secret_ keys are not JWTs; apikey header auth only.
    if (isOpaqueSecretKey(key)) {
      options.global = {
        headers: { apikey: key, Authorization: 'sb-secret' },
        fetch: (input, init = {}) => {
          const headers = new Headers(init.headers || {});
          headers.set('apikey', key);
          headers.delete('Authorization');
          return fetch(input, { ...init, headers });
        }
      };
    }

    client = createClient(url, key, options);
  }
  return client;
}

module.exports = { getSupabase, isSupabaseEnabled };
