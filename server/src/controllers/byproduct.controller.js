import { query } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound } from '../utils/AppError.js';

export const browse = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT l.*, u.full_name AS farmer_name, u.phone AS farmer_phone, u.region FROM byproduct_listings l JOIN users u ON u.id=l.farmer_id
      WHERE l.status='available' ORDER BY l.created_at DESC LIMIT 100`);
  res.json({ listings: rows });
});
export const mine = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM byproduct_listings WHERE farmer_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ listings: rows });
});
export const create = asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO byproduct_listings(farmer_id, kind, description, quantity_kg, price_per_kg) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, b.kind, b.description ?? null, b.quantity_kg, b.price_per_kg]);
  res.status(201).json({ listing: rows[0] });
});
export const setStatus = asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE byproduct_listings SET status=$3 WHERE id=$1 AND farmer_id=$2 RETURNING *', [req.params.id, req.user.id, req.body.status]);
  if (!rows[0]) throw notFound('Listing not found');
  res.json({ listing: rows[0] });
});
