import { query } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound } from '../utils/AppError.js';

const LISTING_SELECT = `
  SELECT b.id, b.volume_litres, b.remaining_litres, b.produced_at, b.collection_location, b.latitude, b.longitude,
         b.grade, b.asking_price, b.recommended_price, b.created_at,
         u.id AS farmer_id, u.full_name AS farmer_name, u.region, u.woreda, u.fayda_verified,
         fp.farm_name, fp.reputation_score,
         t.estimated_water_percent, t.estimate_low, t.estimate_high, t.confidence, t.fat_percent, t.snf_estimated,
         t.conductivity_ms, t.method, t.flags, t.created_at AS tested_at, t.image_url,
         (SELECT count(*)::int FROM orders o WHERE o.farmer_id=u.id AND o.status='completed') AS completed_sales
    FROM milk_batches b
    JOIN users u ON u.id = b.farmer_id
    JOIN farmer_profiles fp ON fp.user_id = u.id
    JOIN LATERAL (SELECT * FROM milk_tests WHERE batch_id=b.id AND test_type='producer' ORDER BY created_at DESC LIMIT 1) t ON TRUE`;

const REPORT_NOTE = 'Composition values are producer-reported field readings and a screening estimate, not laboratory-certified results.';
const SORTS = {
  newest: 'b.created_at DESC', price_asc: 'b.asking_price ASC', price_desc: 'b.asking_price DESC',
  reputation: 'fp.reputation_score DESC, b.created_at DESC', quality: `b.grade ASC, t.estimated_water_percent ASC`,
};

export const browse = asyncHandler(async (req, res) => {
  const { location, min_volume, max_price, grade, sort, limit } = req.query;
  const where = [`b.status='listed'`, 'b.remaining_litres > 0'];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (location) add('(b.collection_location ILIKE ? OR u.region ILIKE ? OR u.woreda ILIKE ?)', `%${location}%`);
  if (min_volume) add('b.remaining_litres >= ?', min_volume);
  if (max_price) add('b.asking_price <= ?', max_price);
  if (grade) add('b.grade = ?', grade);
  params.push(limit);
  const { rows } = await query(`${LISTING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${SORTS[sort]} LIMIT $${params.length}`, params);
  res.json({ batches: rows, note: REPORT_NOTE });
});

export const detail = asyncHandler(async (req, res) => {
  const { rows } = await query(`${LISTING_SELECT} WHERE b.id=$1 AND b.status IN ('listed','sold_out')`, [req.params.id]);
  if (!rows[0]) throw notFound('Milk batch not found');
  res.json({ batch: rows[0], note: REPORT_NOTE });
});

export const compare = asyncHandler(async (req, res) => {
  const { rows } = await query(`${LISTING_SELECT} WHERE b.id = ANY($1::uuid[]) AND b.status='listed'`, [req.query.ids]);
  const cheapest = rows.reduce((m, r) => (m === null || r.asking_price < m ? r.asking_price : m), null);
  res.json({
    batches: rows.map((r) => ({ ...r, cheapest: r.asking_price === cheapest })),
    note: REPORT_NOTE,
  });
});
