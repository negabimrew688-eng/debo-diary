import 'dotenv/config';

const isTest = process.env.NODE_ENV === 'test';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const jwtSecret = required('JWT_SECRET', isTest ? 'test-secret-not-for-production' : undefined);
if (process.env.NODE_ENV === 'production' && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isTest,
  port: Number(process.env.PORT || 4000),
  databaseUrl: required(
    'DATABASE_URL',
    isTest ? 'postgresql://debo:debo_dev_pw@127.0.0.1:5432/debo_dairy_test' : undefined
  ),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  telebirrMode: process.env.TELEBIRR_MODE || 'sandbox',
  telebirrAppId: process.env.TELEBIRR_APP_ID || '',
  telebirrAppKey: process.env.TELEBIRR_APP_KEY || '',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  bcryptRounds: isTest ? 4 : 12,
  // Managed PostgreSQL (Render, RDS, Cloud SQL...) usually requires TLS. Certificates are verified unless a CA is supplied.
  // Set true only when served over HTTPS (e.g. Render): makes browsers upgrade http sub-requests. Leave false for plain-http LAN or localhost use.
  forceHttps: process.env.FORCE_HTTPS === 'true',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  databaseSslCa: process.env.DATABASE_SSL_CA || '',
  // First administrator for a fresh deployment (only used when no admin exists yet).
  bootstrapAdmin: {
    email: (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
    name: process.env.BOOTSTRAP_ADMIN_NAME || 'Debo Admin',
  },
};

if (env.nodeEnv === 'production') {
  if (/dev-only|replace-with|change-me/i.test(jwtSecret)) throw new Error('JWT_SECRET still has an example value; set a real random secret');
  if (env.telebirrMode === 'live' && (!env.telebirrAppId || !env.telebirrAppKey)) {
    console.warn('TELEBIRR_MODE=live without TELEBIRR_APP_ID/KEY: payments will be refused (501).');
  }
}
