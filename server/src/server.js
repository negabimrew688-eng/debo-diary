import { env } from './config/env.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pool } from './config/db.js';
import { bootstrapAdmin } from './db/bootstrap.js';

await migrate({ quiet: true });
const boot = await bootstrapAdmin();
if (boot.created) console.log(`Created first administrator ${boot.email}. Log in and change the password.`);
const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`Debo Dairy API on http://localhost:${env.port}  (docs: /api/docs, telebirr: ${env.telebirrMode})`);
});
const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
