function readEnv(name) {
  const raw = process.env[name];
  if (raw == null || raw === '') return '';
  return String(raw).trim().replace(/^["']|["']$/g, '');
}

module.exports = { readEnv };
