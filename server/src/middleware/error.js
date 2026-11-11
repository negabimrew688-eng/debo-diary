import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

export const notFoundHandler = (req, _res, next) => next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 5 MB)' });
  // PostgreSQL error classes
  if (err.code === '23505') return res.status(409).json({ error: 'A record with these details already exists' });
  if (err.code === '23503') return res.status(409).json({ error: 'Related record not found or still in use' });
  if (err.code === '23514' || err.code === '22P02' || err.code === '22003') {
    return res.status(400).json({ error: 'Invalid value supplied' });
  }
  if (!env.isTest) console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
