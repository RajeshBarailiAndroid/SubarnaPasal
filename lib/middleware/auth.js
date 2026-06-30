const { LOCAL_DEV_USER_ID } = require('../store');
const { isSupabaseEnabled } = require('../supabase');
const { isAuthConfigured, getUserIdFromToken } = require('../auth');

const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/auth/config',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password'
]);

function isCronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${secret}`) return true;
  return String(req.headers['x-cron-secret'] || '') === secret;
}

function createAttachUser(cronPath) {
  return async function attachUser(req, res, next) {
    if (req.path === cronPath && isCronAuthorized(req)) {
      req.isCron = true;
      return next();
    }

    if (!req.path.startsWith('/api/') || PUBLIC_API_PATHS.has(req.path)) {
      return next();
    }

    if (isAuthConfigured()) {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const userId = await getUserIdFromToken(token);
      if (!userId) {
        return res.status(401).json({ error: 'Sign in required.' });
      }
      req.userId = userId;
      return next();
    }

    if (isSupabaseEnabled()) {
      return res.status(503).json({ error: 'Sign-in is not configured yet.' });
    }

    req.userId = LOCAL_DEV_USER_ID;
    return next();
  };
}

module.exports = { PUBLIC_API_PATHS, createAttachUser, isCronAuthorized };
