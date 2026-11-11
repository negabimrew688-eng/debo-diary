import pg from 'pg';
import { env } from './env.js';

// Return NUMERIC columns as JS numbers (all money and litre values are well within double precision).
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: env.databaseSsl ? { rejectUnauthorized: true, ...(env.databaseSslCa ? { ca: env.databaseSslCa } : {}) } : undefined,
});
pool.on('error', (err) => console.error('Unexpected PostgreSQL pool error:', err.message));

export const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction; commits on success, rolls back on any throw. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
