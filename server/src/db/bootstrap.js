import bcrypt from 'bcrypt';
import { query } from '../config/db.js';
import { env } from '../config/env.js';

/** Creates the first administrator from BOOTSTRAP_ADMIN_* when the database has none. Idempotent and never overwrites. */
export async function bootstrapAdmin() {
  const { email, password, name } = env.bootstrapAdmin;
  if (!email || !password) return { created: false, reason: 'not configured' };
  const existing = await query(`SELECT 1 FROM users WHERE role='admin' LIMIT 1`);
  if (existing.rowCount) return { created: false, reason: 'an admin already exists' };
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters with a letter and a digit');
  }
  await query(`INSERT INTO users(email, password_hash, full_name, role) VALUES ($1,$2,$3,'admin')`, [email, await bcrypt.hash(password, env.bcryptRounds), name]);
  return { created: true, email };
}
