import { query, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound, badRequest, conflict } from '../utils/AppError.js';
import { getSettings } from '../services/settings.service.js';
import { assess } from '../services/milkQuality.service.js';
import { recommendFeed } from '../services/feedAdvisor.service.js';
import { recomputeReputation } from '../services/reputation.service.js';
import { audit } from '../utils/audit.js';

const TEST_FRESH_HOURS = 12;

// ---- Cows
export const listCows = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM cows WHERE farmer_id=$1 ORDER BY tag', [req.user.id]);
  res.json({ cows: rows });
});
export const createCow = asyncHandler(async (req, res) => {
  const c = req.body;
  const { rows } = await query(
    `INSERT INTO cows(farmer_id, tag, breed, age_months, lactating, daily_yield_litres) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.id, c.tag, c.breed ?? null, c.age_months ?? null, c.lactating ?? true, c.daily_yield_litres ?? 0]);
  res.status(201).json({ cow: rows[0] });
});
export const updateCow = asyncHandler(async (req, res) => {
  const c = req.body;
  const { rows } = await query(
    `UPDATE cows SET tag=COALESCE($3,tag), breed=COALESCE($4,breed), age_months=COALESCE($5,age_months),
       lactating=COALESCE($6,lactating), daily_yield_litres=COALESCE($7,daily_yield_litres)
     WHERE id=$1 AND farmer_id=$2 RETURNING *`,
    [req.params.id, req.user.id, c.tag ?? null, c.breed ?? null, c.age_months ?? null, c.lactating ?? null, c.daily_yield_litres ?? null]);
  if (!rows[0]) throw notFound('Cow not found');
  res.json({ cow: rows[0] });
});
export const deleteCow = asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM cows WHERE id=$1 AND farmer_id=$2', [req.params.id, req.user.id]);
  if (!rowCount) throw notFound('Cow not found');
  res.status(204).end();
});

// ---- Batches
const BATCH_SELECT = `
  SELECT b.*, t.id AS test_id, t.estimated_water_percent, t.estimate_low, t.estimate_high, t.confidence, t.fat_percent,
         t.snf_estimated, t.method, t.flags, t.created_at AS tested_at
    FROM milk_batches b
    LEFT JOIN LATERAL (SELECT * FROM milk_tests WHERE batch_id=b.id AND test_type='producer' ORDER BY created_at DESC LIMIT 1) t ON TRUE`;

export const createBatch = asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `INSERT INTO milk_batches(farmer_id, volume_litres, remaining_litres, produced_at, collection_location, latitude, longitude)
     VALUES ($1,$2,$2,$3,$4,$5,$6) RETURNING *`,
    [req.user.id, b.volume_litres, b.produced_at, b.collection_location, b.latitude ?? null, b.longitude ?? null]);
  await audit(req.user.id, 'batch.create', 'milk_batch', rows[0].id);
  res.status(201).json({ batch: rows[0] });
});

export const listMyBatches = asyncHandler(async (req, res) => {
  const { rows } = await query(`${BATCH_SELECT} WHERE b.farmer_id=$1 ORDER BY b.created_at DESC LIMIT 200`, [req.user.id]);
  res.json({ batches: rows });
});

export const getMyBatch = asyncHandler(async (req, res) => {
  const { rows } = await query(`${BATCH_SELECT} WHERE b.id=$1 AND b.farmer_id=$2`, [req.params.id, req.user.id]);
  if (!rows[0]) throw notFound('Batch not found');
  const tests = await query(`SELECT * FROM milk_tests WHERE batch_id=$1 ORDER BY created_at DESC`, [req.params.id]);
  res.json({ batch: rows[0], tests: tests.rows });
});

export const testBatch = asyncHandler(async (req, res) => {
  const t = req.body;
  const settings = await getSettings();
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM milk_batches WHERE id=$1 AND farmer_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
    const batch = rows[0];
    if (!batch) throw notFound('Batch not found');
    if (!['draft', 'tested', 'rejected'].includes(batch.status)) throw conflict('This batch is already listed or closed; withdraw it before re-testing');
    const a = assess({ lactometer: t.lactometer_reading, temperature: t.temperature_c, fat: t.fat_percent, conductivity: t.conductivity_ms, imageBrightness: t.image_brightness }, settings);
    const ins = await client.query(
      `INSERT INTO milk_tests(batch_id, tested_by, test_type, lactometer_reading, temperature_c, fat_percent, conductivity_ms, image_brightness, image_url,
         corrected_reading, estimated_water_percent, estimate_low, estimate_high, snf_estimated, confidence, method, flags, grade, recommended_price, notes)
       VALUES ($1,$2,'producer',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [batch.id, req.user.id, t.lactometer_reading, t.temperature_c, t.fat_percent ?? null, t.conductivity_ms ?? null, t.image_brightness ?? null, t.image_url ?? null,
       a.corrected_reading, a.estimated_water_percent, a.estimate_low, a.estimate_high, a.snf_estimated, a.confidence, a.method, JSON.stringify(a.flags), a.grade, a.recommended_price, t.notes ?? null]);
    const status = a.grade === 'FAIL' ? 'rejected' : 'tested';
    const upd = await client.query(
      `UPDATE milk_batches SET grade=$2, recommended_price=$3, asking_price=NULL, status=$4 WHERE id=$1 RETURNING *`,
      [batch.id, a.grade, a.recommended_price, status]);
    await recomputeReputation(client, req.user.id);
    return { batch: upd.rows[0], test: ins.rows[0] };
  });
  await audit(req.user.id, 'batch.test', 'milk_batch', req.params.id, { grade: result.test.grade });
  res.status(201).json({
    ...result,
    message: result.test.grade === 'FAIL'
      ? 'Estimated water content is too high to sell. Check containers and re-test.'
      : `Graded ${result.test.grade}. Recommended price ${result.test.recommended_price} ETB per litre.`,
    disclaimer: 'Screening estimate from field readings, not a laboratory result.',
  });
});

export const listBatch = asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM milk_batches WHERE id=$1 AND farmer_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
    const b = rows[0];
    if (!b) throw notFound('Batch not found');
    if (b.status !== 'tested' || !['A', 'B'].includes(b.grade)) throw badRequest('Only tested batches graded A or B can be listed');
    const test = await client.query(`SELECT created_at FROM milk_tests WHERE batch_id=$1 AND test_type='producer' ORDER BY created_at DESC LIMIT 1`, [b.id]);
    if (Date.now() - new Date(test.rows[0].created_at).getTime() > TEST_FRESH_HOURS * 3600e3) {
      throw badRequest(`Test is older than ${TEST_FRESH_HOURS} hours. Re-test the milk before listing.`);
    }
    const ask = req.body.asking_price ?? b.recommended_price;
    if (ask > b.recommended_price * 1.15) throw badRequest(`Asking price cannot exceed 115% of the recommended price (${b.recommended_price} ETB/L)`);
    await client.query(`UPDATE milk_batches SET status='listed', asking_price=$2 WHERE id=$1`, [b.id, ask]);
  });
  const { rows } = await query(`${BATCH_SELECT} WHERE b.id=$1`, [req.params.id]);
  res.json({ batch: rows[0] });
});

export const withdrawBatch = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE milk_batches SET status='withdrawn' WHERE id=$1 AND farmer_id=$2 AND status IN ('draft','tested','listed','rejected') RETURNING *`,
    [req.params.id, req.user.id]);
  if (!rows[0]) throw notFound('Batch not found or cannot be withdrawn');
  res.json({ batch: rows[0] });
});

// ---- Insights
export const feedRecommendations = asyncHandler(async (req, res) => res.json(await recommendFeed(req.user.id)));

export const dashboard = asyncHandler(async (req, res) => {
  const id = req.user.id;
  const [totals, grades, revenue, series, rep, orders] = await Promise.all([
    query(`SELECT count(*)::int AS batches, COALESCE(sum(volume_litres),0) AS litres,
                  count(*) FILTER (WHERE status='listed')::int AS listed FROM milk_batches WHERE farmer_id=$1`, [id]),
    query(`SELECT grade, count(*)::int AS count FROM milk_batches WHERE farmer_id=$1 AND grade IS NOT NULL GROUP BY grade`, [id]),
    query(`SELECT COALESCE(sum(total_amount) FILTER (WHERE status='completed'),0) AS earned,
                  COALESCE(sum(total_amount) FILTER (WHERE status IN ('paid','in_transit','delivered','disputed')),0) AS in_escrow
             FROM orders WHERE farmer_id=$1`, [id]),
    query(`SELECT to_char(d::date,'MM-DD') AS day, COALESCE(sum(o.volume_litres),0) AS litres
             FROM generate_series(current_date - interval '13 days', current_date, '1 day') d
             LEFT JOIN orders o ON o.farmer_id=$1 AND o.created_at::date = d::date AND o.status NOT IN ('cancelled')
            GROUP BY d ORDER BY d`, [id]),
    query('SELECT reputation_score FROM farmer_profiles WHERE user_id=$1', [id]),
    query(`SELECT count(*)::int AS open FROM orders WHERE farmer_id=$1 AND status IN ('pending_payment','paid','in_transit','delivered','disputed')`, [id]),
  ]);
  res.json({
    totals: totals.rows[0], grades: grades.rows, money: revenue.rows[0], sales_last_14_days: series.rows,
    reputation_score: rep.rows[0]?.reputation_score ?? 50, open_orders: orders.rows[0].open,
  });
});
