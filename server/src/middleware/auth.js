import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { unauthorized, forbidden } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const { rows } = await query(
    'SELECT id, email, full_name, role, is_active, phone, region, woreda, fayda_verified FROM users WHERE id=$1',
    [payload.sub]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw unauthorized('Account not found or disabled');
  req.user = user;
  next();
});

export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
