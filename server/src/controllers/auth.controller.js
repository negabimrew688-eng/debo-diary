import bcrypt from 'bcrypt';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { unauthorized, badRequest } from '../utils/AppError.js';
import { profileSchemas } from '../validation/schemas.js';
import { audit } from '../utils/audit.js';

const PROFILE_TABLE = { farmer: 'farmer_profiles', buyer: 'buyer_profiles', feed_supplier: 'supplier_profiles', transporter: 'transporter_profiles' };
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

async function loadUser(id, client = { query }) {
  const { rows } = await client.query(
    'SELECT id, email, full_name, phone, role, region, woreda, fayda_verified, is_active, avatar_url, notification_prefs, created_at FROM users WHERE id=$1', [id]);
  const user = rows[0];
  if (!user) return null;
  const table = PROFILE_TABLE[user.role];
  if (table) {
    const p = await client.query(`SELECT * FROM ${table} WHERE user_id=$1`, [id]);
    const { user_id, ...profile } = p.rows[0] || {};
    user.profile = profile;
  }
  return user;
}

function parseProfile(role, raw) {
  const schema = profileSchemas[role];
  if (!schema) return {};
  const r = schema.safeParse(raw ?? {});
  if (!r.success) throw badRequest('Invalid profile', r.error.issues.map((i) => ({ field: `profile.${i.path.join('.')}`, message: i.message })));
  return r.data;
}

async function upsertProfile(client, userId, role, data) {
  const table = PROFILE_TABLE[role];
  if (!table) return;
  const keys = Object.keys(data);
  if (!keys.length) {
    await client.query(`INSERT INTO ${table}(user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    return;
  }
  const cols = keys.map((k) => `"${k}"`).join(',');
  const vals = keys.map((_, i) => `$${i + 2}`).join(',');
  const sets = keys.map((k) => `"${k}"=EXCLUDED."${k}"`).join(',');
  await client.query(`INSERT INTO ${table}(user_id, ${cols}) VALUES ($1, ${vals}) ON CONFLICT (user_id) DO UPDATE SET ${sets}`, [userId, ...keys.map((k) => data[k])]);
  if (role === 'transporter' && data.available !== undefined) {
    await client.query(`UPDATE transporter_profiles SET availability_status = CASE WHEN $2 THEN 'available' ELSE 'offline' END WHERE user_id=$1`, [userId, data.available]);
  }
}

export const register = asyncHandler(async (req, res) => {
  const { email, password, full_name, phone, role, region, woreda, profile } = req.body;
  const profileData = parseProfile(role, profile);
  const hash = await bcrypt.hash(password, env.bcryptRounds);
  const user = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users(email, password_hash, full_name, phone, role, region, woreda) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [email, hash, full_name, phone ?? null, role, region ?? null, woreda ?? null]);
    await upsertProfile(client, rows[0].id, role, profileData);
    return loadUser(rows[0].id, client);
  });
  await audit(user.id, 'user.register', 'user', user.id, { role });
  res.status(201).json({ token: signToken(user), user });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query('SELECT id, password_hash, is_active FROM users WHERE email=$1', [email]);
  const row = rows[0];
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH); // constant-ish time whether or not the user exists
  if (!row || !ok) throw unauthorized('Incorrect email or password');
  if (!row.is_active) throw unauthorized('This account has been disabled');
  const user = await loadUser(row.id);
  await audit(user.id, 'user.login', 'user', user.id);
  res.json({ token: signToken(user), user });
});

export const me = asyncHandler(async (req, res) => res.json({ user: await loadUser(req.user.id) }));

export const updateMe = asyncHandler(async (req, res) => {
  const { full_name, phone, region, woreda, profile, avatar_url, notification_prefs } = req.body;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET full_name=COALESCE($2,full_name), phone=COALESCE($3,phone), region=COALESCE($4,region), woreda=COALESCE($5,woreda),
         avatar_url=COALESCE($6,avatar_url), notification_prefs=COALESCE($7::jsonb,notification_prefs) WHERE id=$1`,
      [req.user.id, full_name ?? null, phone ?? null, region ?? null, woreda ?? null, avatar_url ?? null, notification_prefs ? JSON.stringify(notification_prefs) : null]);
    if (profile) await upsertProfile(client, req.user.id, req.user.role, parseProfile(req.user.role, profile));
  });
  res.json({ user: await loadUser(req.user.id) });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(current_password, rows[0].password_hash))) throw unauthorized('Current password is incorrect');
  if (current_password === new_password) throw badRequest('Choose a new password different from the current one');
  await query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await bcrypt.hash(new_password, env.bcryptRounds)]);
  await audit(req.user.id, 'auth.change_password', 'user', req.user.id);
  res.json({ changed: true });
});
