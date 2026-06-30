const buckets = new Map();

function clientKey(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter({ windowMs = 60_000, max = 10, name = 'default' } = {}) {
  return (req, res, next) => {
    const key = `${name}:${clientKey(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
