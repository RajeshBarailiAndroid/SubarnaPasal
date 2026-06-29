const { createClient } = require('@supabase/supabase-js');
const { readEnv } = require('./env');
const { isValidPhone } = require('./phone');

const AUTH_EMAIL_DOMAIN = 'subarnapasal.app';

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function usernameToEmail(username) {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

function isSyntheticAuthEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${AUTH_EMAIL_DOMAIN}`);
}

function isValidUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isValidPassword(password) {
  return String(password || '').length >= 6;
}

function getAnonKey() {
  return (
    readEnv('SUPABASE_ANON_KEY') ||
    readEnv('SUPABASE_PUBLISHABLE_KEY') ||
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  );
}

function getAuthUrl() {
  return readEnv('SUPABASE_URL');
}

function isUserJwtAuthorization(value) {
  return /^Bearer\s+eyJ/i.test(String(value || '').trim());
}

function createOpaqueKeyFetch(key) {
  return (input, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('apikey', key);
    if (!isUserJwtAuthorization(headers.get('Authorization'))) {
      headers.delete('Authorization');
    }
    return fetch(input, { ...init, headers });
  };
}

function createAnonClientOptions(anonKey) {
  const options = {
    auth: { persistSession: false, autoRefreshToken: false }
  };

  if (anonKey.startsWith('sb_publishable_')) {
    options.global = {
      headers: { apikey: anonKey },
      fetch: createOpaqueKeyFetch(anonKey)
    };
  }

  return options;
}

function isAuthConfigured() {
  const url = getAuthUrl();
  const anonKey = getAnonKey();
  const placeholders = ['YOUR_PROJECT_REF', 'your-anon-key', 'your-service-role-key'];
  return Boolean(
    url &&
    anonKey &&
    url.includes('supabase.co') &&
    !placeholders.some((p) => url.includes(p) || anonKey.includes(p))
  );
}

function getAnonAuthClient() {
  const url = getAuthUrl();
  const anonKey = getAnonKey();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, createAnonClientOptions(anonKey));
}

async function findUserByUsername(adminClient, username) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;

  let page = 1;
  const perPage = 200;

  while (page <= 10) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users || [];
    const match = users.find((user) => {
      const metaUsername = normalizeUsername(user.user_metadata?.username);
      return metaUsername === normalized || user.email === usernameToEmail(normalized);
    });
    if (match) return match;
    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

async function resolveAuthEmail(adminClient, username) {
  const normalized = normalizeUsername(username);
  const canonical = usernameToEmail(normalized);
  const existing = await findUserByUsername(adminClient, normalized);
  return existing?.email || canonical;
}

async function getUserIdFromToken(token) {
  if (!token) return null;

  const authUrl = getAuthUrl();
  const anonKey = getAnonKey();
  if (!authUrl || !anonKey) return null;

  try {
    const res = await fetch(`${authUrl.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id || null;
  } catch (_) {
    return null;
  }
}

function formatNameFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  if (!local) return '';
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\d+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function displayNameFromUser(user) {
  const meta = user?.user_metadata || {};
  return String(meta.full_name || meta.name || '').trim();
}

async function lookupDisplayNameFromDb(adminClient, user) {
  const stored = displayNameFromUser(user);
  if (stored) return stored;

  const meta = user?.user_metadata || {};
  const emails = [
    String(meta.contact_email || '').trim().toLowerCase(),
    isSyntheticAuthEmail(user?.email) ? '' : String(user?.email || '').trim().toLowerCase()
  ].filter(Boolean);

  for (const email of [...new Set(emails)]) {
    const { data, error } = await adminClient
      .from('users')
      .select('name')
      .ilike('email', email)
      .maybeSingle();
    if (!error && data?.name) {
      return String(data.name).trim();
    }
  }

  const contactEmail = String(meta.contact_email || '').trim();
  if (contactEmail) return formatNameFromEmail(contactEmail);
  if (!isSyntheticAuthEmail(user?.email)) return formatNameFromEmail(user.email);

  return '';
}

module.exports = {
  AUTH_EMAIL_DOMAIN,
  normalizeUsername,
  usernameToEmail,
  isSyntheticAuthEmail,
  formatNameFromEmail,
  displayNameFromUser,
  lookupDisplayNameFromDb,
  isValidUsername,
  isValidPhone,
  isValidEmail,
  isValidPassword,
  isAuthConfigured,
  getAnonAuthClient,
  findUserByUsername,
  resolveAuthEmail,
  getUserIdFromToken
};
