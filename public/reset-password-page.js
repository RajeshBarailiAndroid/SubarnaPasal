async function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const password = String(form.elements.password?.value || '');
  const confirm = String(form.elements.confirm?.value || '');

  const passwordError = validateNewPassword(password, confirm);
  if (passwordError) {
    showAuthError('reset-password', passwordError);
    return;
  }

  showAuthError('reset-password', '');

  await withAuthSubmit(form, async () => {
    const token = typeof getAuthAccessToken === 'function' ? await getAuthAccessToken() : null;
    if (!token) {
      showAuthError('reset-password', t('authResetLinkInvalid'));
      return;
    }

    const res = await fetch('/api/auth/config');
    const cfg = await res.json();
    if (!cfg.enabled || !cfg.url || !cfg.anonKey) {
      showAuthError('reset-password', t('authNotConfigured'));
      return;
    }

    const client = supabase.createClient(cfg.url, cfg.anonKey);
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;

    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    authToast(t('authResetPasswordSuccess'));
    window.location.replace('/login.html');
  });
}

async function initResetPasswordPage() {
  if (typeof isResetPasswordPage !== 'function' || !isResetPasswordPage()) return;

  initAuthPageLanguage('authResetPasswordTitle');
  document.getElementById('reset-password-form')?.addEventListener('submit', handleResetPasswordSubmit);

  if (typeof waitForAuthReady === 'function') {
    await waitForAuthReady();
  }

  const hasRecoveryHash = window.location.hash.includes('access_token');
  const token = typeof getAuthAccessToken === 'function' ? await getAuthAccessToken() : null;
  if (!token && !hasRecoveryHash) {
    showAuthError('reset-password', t('authResetLinkInvalid'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initResetPasswordPage();
});
