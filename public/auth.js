let authClient = null;
let authEnabled = false;
let signedInUser = null;
let accountDisplayName = '';

const AUTH_EMAIL_DOMAIN = 'subarnapasal.app';
const LOGIN_PATH = '/login.html';
const APP_PATH = '/';
const ADMIN_EMAIL = 'rajeshsurunga@gmail.com';

function getUserContactEmail(user) {
  if (!user) return '';
  const meta = user.user_metadata || {};
  return String(meta.contact_email || user.email || '').trim().toLowerCase();
}

function isAdminSession(session) {
  if (!session?.user) return false;
  return getUserContactEmail(session.user) === ADMIN_EMAIL.toLowerCase();
}

function isAdminUser() {
  return isAdminSession({ user: signedInUser });
}

function isLoginPage() {
  return /\/login\.html$/i.test(window.location.pathname);
}

function isResetPasswordPage() {
  return /\/reset-password\.html$/i.test(window.location.pathname);
}

function isForgotPasswordPage() {
  return /\/forgot-password\.html$/i.test(window.location.pathname);
}

function isAppPage() {
  return !isLoginPage() && !isResetPasswordPage() && !isForgotPasswordPage();
}

function redirectToLogin(query = '') {
  const target = `${LOGIN_PATH}${query}`;
  if (`${window.location.pathname}${window.location.search}` !== target) {
    window.location.replace(target);
  }
}

function redirectToApp() {
  if (window.location.pathname !== '/' && !/\/index\.html$/i.test(window.location.pathname)) {
    window.location.replace(APP_PATH);
  }
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function usernameToEmail(username) {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

function isValidUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

function isValidPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isValidPassword(password) {
  return String(password || '').length >= 6;
}

function showAuthError(formId, message) {
  const el = document.getElementById(`${formId}-error`);
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = '';
    el.hidden = true;
  }
}

function clearAuthErrors() {
  showAuthError('login', '');
  showAuthError('signup', '');
  showAuthError('forgot', '');
  showAuthError('reset-password', '');
}

function shouldForceLogin() {
  return authEnabled && !signedInUser;
}

function displayNameFromSession(session) {
  return accountDisplayName || String(session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || '').trim();
}

function renderAccountDisplay(session) {
  const settingsUser = document.getElementById('settings-account-user');
  if (!settingsUser) return;
  const displayName = displayNameFromSession(session);
  settingsUser.textContent = displayName ? `${t('accountSignedInAs')} ${displayName}` : '';
  settingsUser.hidden = !displayName;
}

async function refreshAccountProfile() {
  const token = await getAuthAccessToken();
  if (!token) {
    accountDisplayName = '';
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    accountDisplayName = String(data.displayName || '').trim();
    if (signedInUser) renderAccountDisplay({ user: signedInUser });
  } catch (_) {
    // Keep session metadata fallback.
  }
}

async function applyAuthSession(session) {
  if (!authClient || !session) return;
  const { error } = await authClient.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  });
  if (error) throw error;
  updateAuthUI(session);
}

let authStateSubscription = null;
let authReadyResolve;
let authInitializing = true;
const authReady = new Promise((resolve) => {
  authReadyResolve = resolve;
});

const AUTH_BOOTSTRAP_EVENTS = new Set(['INITIAL_SESSION', 'TOKEN_REFRESHED']);

function handleAuthStateChange(event, session) {
  signedInUser = session?.user || null;
  updateAuthUI(session);

  if (AUTH_BOOTSTRAP_EVENTS.has(event) || authInitializing) return;

  if (event === 'SIGNED_IN') {
    refreshAccountProfile();
    if (isLoginPage() || isForgotPasswordPage()) {
      redirectToApp();
      return;
    }
    if (typeof toast === 'function') toast(t('loginSuccess'));
    if (typeof refreshAll === 'function') {
      refreshAll().catch((err) => {
        if (typeof toast === 'function') toast(err.message);
      });
    }
  }
}

function revealAppShell() {
  document.body.classList.remove('auth-pending');
  document.body.classList.add('auth-ready');
  const loader = document.getElementById('app-loading');
  if (loader) loader.setAttribute('aria-busy', 'false');
}

function hideAppShellForRedirect() {
  document.body.classList.remove('auth-ready');
  document.body.classList.add('auth-pending');
}

let appShellFailsafeTimer = null;

function scheduleAppShellFailsafe(ms = 10000) {
  if (appShellFailsafeTimer) return;
  appShellFailsafeTimer = window.setTimeout(() => {
    if (document.body.classList.contains('auth-pending')) revealAppShell();
  }, ms);
}

function clearAppShellFailsafe() {
  if (!appShellFailsafeTimer) return;
  window.clearTimeout(appShellFailsafeTimer);
  appShellFailsafeTimer = null;
}

function bindAuthClient(client) {
  authStateSubscription?.unsubscribe?.();
  authClient = client;
  authStateSubscription = authClient.auth.onAuthStateChange(handleAuthStateChange);
}

async function initAuth() {
  if (isAppPage()) scheduleAppShellFailsafe();
  try {
    const res = await fetch('/api/auth/config');
    const cfg = await res.json();
    authEnabled = Boolean(cfg.enabled && cfg.url && cfg.anonKey);
    if (!authEnabled) {
      if (isAppPage()) {
        document.body.classList.add('auth-signed-in');
        document.body.classList.remove('auth-signed-out');
        revealAppShell();
      }
      return;
    }

    bindAuthClient(supabase.createClient(cfg.url, cfg.anonKey));

    const hasAuthCallback =
      window.location.hash.includes('access_token') || window.location.search.includes('code=');

    if (isResetPasswordPage() && hasAuthCallback) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          subscription?.unsubscribe?.();
          resolve();
        };
        const { data: { subscription } } = authClient.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY' || session?.access_token) {
            signedInUser = session?.user || null;
            finish();
          }
        });
        setTimeout(async () => {
          const { data: { session } } = await authClient.auth.getSession();
          signedInUser = session?.user || signedInUser;
          finish();
        }, 250);
      });
    }

    const { data: { session } } = await authClient.auth.getSession();
    signedInUser = session?.user || signedInUser;

    if (hasAuthCallback && (!isResetPasswordPage() || signedInUser)) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    if (session?.user) {
      if (isLoginPage() || isForgotPasswordPage()) {
        redirectToApp();
        return;
      }
      if (isResetPasswordPage()) {
        return;
      }
      updateAuthUI(session);
      await refreshAccountProfile();
      return;
    }

    if (isAppPage()) {
      hideAppShellForRedirect();
      redirectToLogin();
      return;
    }

    if (isLoginPage() || isResetPasswordPage() || isForgotPasswordPage()) {
      updateAuthUI(null);
    }
  } catch (err) {
    console.warn('Auth init failed:', err);
    if (isAppPage() && authEnabled) {
      hideAppShellForRedirect();
      redirectToLogin();
    }
  } finally {
    authInitializing = false;
    if (!isAppPage()) revealAppShell();
    clearAppShellFailsafe();
    authReadyResolve?.();
  }
}

async function getAuthAccessToken() {
  if (!authClient) return null;
  const { data: { session } } = await authClient.auth.getSession();
  return session?.access_token || null;
}

window.getAuthAccessToken = getAuthAccessToken;
window.waitForAuthReady = () => authReady;
window.isAuthRequired = () => authEnabled;
window.isSignedInSync = () => !authEnabled || Boolean(signedInUser);
window.isLoginPage = isLoginPage;
window.isResetPasswordPage = isResetPasswordPage;
window.isForgotPasswordPage = isForgotPasswordPage;
window.redirectToLogin = redirectToLogin;
window.redirectToApp = redirectToApp;
window.clearAuthErrors = clearAuthErrors;
window.isAdminUser = isAdminUser;
window.authToast = authToast;
window.showAuthError = showAuthError;
window.revealAppShell = revealAppShell;

function updateAuthUI(session) {
  if (!isAppPage()) return;

  signedInUser = session?.user || null;
  const settingsLogoutBtn = document.getElementById('settings-logout-btn');
  const usersNavBtn = document.querySelector('.nav-btn[data-view="users"]');

  if (session?.user) {
    renderAccountDisplay(session);
    if (settingsLogoutBtn) settingsLogoutBtn.hidden = false;
  } else if (settingsLogoutBtn) {
    settingsLogoutBtn.hidden = true;
    accountDisplayName = '';
  }

  if (usersNavBtn) usersNavBtn.hidden = !isAdminSession(session);

  const canEdit = Boolean(session?.user) || !authEnabled;
  document.body.classList.toggle('auth-signed-in', canEdit);
  document.body.classList.toggle('auth-signed-out', authEnabled && !session?.user);
}

function authToast(msg) {
  if (typeof toast === 'function') {
    toast(msg);
    return;
  }
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(authToast._t);
  authToast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function goToLoginPage() {
  redirectToLogin();
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  if (!authClient) return;

  const username = normalizeUsername(document.getElementById('login-username')?.value);
  const password = document.getElementById('login-password')?.value || '';

  if (!isValidUsername(username)) {
    showAuthError('login', t('authInvalidUsername'));
    return;
  }
  if (!isValidPassword(password)) {
    showAuthError('login', t('authInvalidPassword'));
    return;
  }

  showAuthError('login', '');
  const submitBtn = e.target.querySelector('.auth-submit');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const payload = await res.json().catch(() => ({}));

    if (submitBtn) submitBtn.disabled = false;

    if (!res.ok) {
      showAuthError('login', payload.error || t('authLoginFailed'));
      return;
    }

    if (payload.session) {
      await applyAuthSession(payload.session);
      await refreshAccountProfile();
      redirectToApp();
    }
  } catch (err) {
    if (submitBtn) submitBtn.disabled = false;
    showAuthError('login', err.message || t('authLoginFailed'));
  }
}

async function handleSignupSubmit(e) {
  e.preventDefault();
  if (!authClient) return;

  const username = normalizeUsername(document.getElementById('signup-username')?.value);
  const fullName = document.getElementById('signup-full-name')?.value?.trim() || '';
  const email = document.getElementById('signup-email')?.value?.trim() || '';
  const phone = document.getElementById('signup-phone')?.value?.trim() || '';
  const password = document.getElementById('signup-password')?.value || '';
  const confirm = document.getElementById('signup-password-confirm')?.value || '';

  if (!isValidUsername(username)) {
    showAuthError('signup', t('authInvalidUsername'));
    return;
  }
  if (!fullName) {
    showAuthError('signup', t('authFullNameRequired'));
    return;
  }
  if (!email && !phone) {
    showAuthError('signup', t('authContactRequired'));
    return;
  }
  if (email && !isValidEmail(email)) {
    showAuthError('signup', t('authInvalidEmail'));
    return;
  }
  if (phone && !isValidPhone(phone)) {
    showAuthError('signup', t('authInvalidPhone'));
    return;
  }
  if (!isValidPassword(password)) {
    showAuthError('signup', t('authInvalidPassword'));
    return;
  }
  if (password !== confirm) {
    showAuthError('signup', t('authPasswordMismatch'));
    return;
  }

  showAuthError('signup', '');
  const submitBtn = e.target.querySelector('.auth-submit');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, full_name: fullName, email, phone, password })
    });
    const payload = await res.json().catch(() => ({}));

    if (submitBtn) submitBtn.disabled = false;

    if (!res.ok) {
      showAuthError('signup', payload.error || t('authUsernameTaken'));
      return;
    }

    if (payload.session) {
      await applyAuthSession(payload.session);
      redirectToApp();
      return;
    }

    redirectToLogin();
  } catch (err) {
    if (submitBtn) submitBtn.disabled = false;
    showAuthError('signup', err.message || t('authUsernameTaken'));
  }
}

async function clearAuthStorage() {
  if (!authClient) return;
  const { storage, storageKey } = authClient.auth;
  if (!storage || !storageKey) return;
  await storage.removeItem(storageKey);
  await storage.removeItem(`${storageKey}-code-verifier`);
  await storage.removeItem(`${storageKey}-user`);
}

async function resetAuthClient() {
  const res = await fetch('/api/auth/config');
  const cfg = await res.json();
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) return;
  bindAuthClient(supabase.createClient(cfg.url, cfg.anonKey));
  await authClient.auth.getSession();
}

async function signOut(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  if (!authClient) return;

  await authClient.auth.signOut({ scope: 'local' }).catch(() => {});
  await clearAuthStorage();

  let { data: { session } } = await authClient.auth.getSession();
  if (session) {
    await resetAuthClient();
    ({ data: { session } } = await authClient.auth.getSession());
  }

  signedInUser = null;
  if (authEnabled) {
    redirectToLogin();
    return;
  }
  window.location.reload();
}

function bindAuthEvents() {
  document.getElementById('login-form')?.addEventListener('submit', handleLoginSubmit);
  document.getElementById('signup-form')?.addEventListener('submit', handleSignupSubmit);
  document.getElementById('settings-logout-btn')?.addEventListener('click', (e) => signOut(e));

  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin || e.data?.type !== 'supabase-auth') return;
    authClient?.auth.getSession().then(({ data: { session } }) => {
      if (session) redirectToApp();
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindAuthEvents();
  initAuth();
});
