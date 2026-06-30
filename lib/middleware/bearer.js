const { getUserFromToken } = require('../auth');

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function requireBearerUser(req, res) {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sign in required.' });
    return null;
  }

  const user = await getUserFromToken(token);
  if (!user?.id) {
    res.status(401).json({ error: 'Sign in required.' });
    return null;
  }

  return user;
}

module.exports = { bearerToken, requireBearerUser };
