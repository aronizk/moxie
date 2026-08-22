const { ZodError } = require('zod');

function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.errors });
  }
  if (err.code === '23505') { // Postgres unique_violation
    return res.status(409).json({ error: 'A record with that value already exists' });
  }
  if (err.code === '23503') { // foreign_key_violation
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.publicMessage || 'Internal server error' });
}

module.exports = { notFound, errorHandler };
