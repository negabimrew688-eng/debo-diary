import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { router } from './routes/index.js';
import { ussd } from './controllers/ussd.controller.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { openapi } from './docs/openapi.js';
import { pool } from './config/db.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: { useDefaults: true, directives: { 'frame-src': ["'self'", 'https://www.openstreetmap.org'], 'upgrade-insecure-requests': env.forceHttps ? [] : null } },
    strictTransportSecurity: env.forceHttps,
  }));
  app.use(cors({ origin: env.corsOrigin, credentials: false }));
  if (!env.isTest) app.use(morgan('tiny'));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));

  app.get('/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', telebirr: env.telebirrMode }); }
    catch { res.status(503).json({ status: 'database_unreachable' }); }
  });

  app.use('/uploads', express.static(path.resolve(env.uploadDir), { maxAge: '7d', index: false, dotfiles: 'deny' }));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Debo Dairy API' }));

  if (!env.isTest) {
    app.use('/api/v1/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } }));
    app.use('/api/v1', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));
  }

  app.post('/api/v1/ussd', ussd);
  app.use('/api/v1', router);

  // Serve the built React app (single-server deployment). API and upload paths never fall through to it.
  const dist = path.resolve(process.env.CLIENT_DIST || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist'));
  if (!env.isTest && fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|uploads\/|health).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
