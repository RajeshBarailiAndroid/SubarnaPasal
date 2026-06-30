function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err.message || 'Internal server error.' });
    });
  };
}

module.exports = { asyncRoute };
