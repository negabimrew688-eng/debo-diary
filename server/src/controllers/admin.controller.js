import { query, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound, badRequest, conflict } from '../utils/AppError.js';
import { getSettings, setSetting, DEFAULT_SETTINGS } from '../services/settings.service.js';
import { fitCalibration, diagnoseCalibration, assess } from '../services/milkQuality.service.js';
import { audit } from '../utils/audit.js';
import { createDelivery, ACTIVE_DELIVERY } from '../services/delivery.service.js';
import { notify } from '../services/notify.service.js';

const round2 = (n) => Math.round(n * 100) / 100;

export const stats = asyncHandler(async (_req, res) => {
  const [users, batches, grades, orders, money, disputes, daily, feed] = await Promise.all([
    query(`SELECT role, count(*)::int AS count FROM users WHERE is_active GROUP BY role ORDER BY role`),
    query(`SELECT count(*)::int AS total, COALESCE(sum(volume_litres),0) AS litres, count(*) FILTER (WHERE status='listed')::int AS listed FROM milk_batches`),
    query(`SELECT grade, count(*)::int AS count FROM milk_batches WHERE grade IS NOT NULL GROUP BY grade ORDER BY grade`),
    query(`SELECT status, count(*)::int AS count FROM orders GROUP BY status ORDER BY status`),
    query(`SELECT COALESCE(sum(total_amount) FILTER (WHERE status='completed'),0) AS gmv_completed,
                  COALESCE(sum(total_amount) FILTER (WHERE status IN ('paid','in_transit','delivered','disputed')),0) AS held_in_escrow,
                  COALESCE(sum(volume_litres) FILTER (WHERE status='completed'),0) AS litres_traded FROM orders`),
    query(`SELECT count(*) FILTER (WHERE status='open')::int AS open, count(*)::int AS total FROM disputes`),
    query(`SELECT to_char(d::date,'MM-DD') AS day, count(o.id)::int AS orders, COALESCE(sum(o.total_amount),0) AS amount
             FROM generate_series(current_date - interval '13 days', current_date, '1 day') d
             LEFT JOIN orders o ON o.created_at::date=d::date AND o.status<>'cancelled' GROUP BY d ORDER BY d`),
    query(`SELECT COALESCE(sum(total_amount) FILTER (WHERE status='delivered'),0) AS delivered_sales FROM feed_orders`),
  ]);
  const [mk] = await Promise.all([query(
    `SELECT (SELECT count(*)::int FROM dairy_products) AS products, (SELECT count(*)::int FROM dairy_products WHERE status='available') AS products_available,
            (SELECT count(*)::int FROM product_orders) AS product_orders, (SELECT count(*)::int FROM product_orders WHERE status='delivered') AS product_orders_delivered,
            (SELECT COALESCE(sum(total_amount),0) FROM product_orders WHERE payment_status='paid' AND status<>'cancelled') AS product_sales,
            (SELECT count(*)::int FROM deliveries WHERE status='delivered') AS completed_deliveries, (SELECT count(*)::int FROM deliveries WHERE status<>'rejected') AS total_deliveries,
            (SELECT count(*)::int FROM deliveries WHERE status = ANY($1)) AS active_deliveries,
            (SELECT round(avg(EXTRACT(EPOCH FROM (delivered_at - collected_at))/60))::int FROM deliveries WHERE status='delivered' AND collected_at IS NOT NULL) AS avg_delivery_minutes,
            (SELECT COALESCE(sum(amount),0) FROM delivery_earnings) AS delivery_fees, (SELECT COALESCE(sum(amount),0) FROM delivery_earnings WHERE payment_status='pending') AS pending_payouts,
            (SELECT count(*)::int FROM users WHERE role IN ('buyer','transporter','farmer') AND NOT fayda_verified AND is_active) AS unverified_users`, [ACTIVE_DELIVERY])]);
  const commission = (await getSettings()).platform_commission_percent ?? 0;
  const marketplace = { ...mk.rows[0], commission_percent: commission,
    estimated_platform_revenue: round2((Number(money.rows[0].gmv_completed) + Number(mk.rows[0].product_sales)) * commission / 100) };
  const total = orders.rows.reduce((s, r) => s + r.count, 0);
  const completed = orders.rows.find((r) => r.status === 'completed')?.count || 0;
  res.json({
    users: users.rows, batches: batches.rows[0], grades: grades.rows, orders: orders.rows, money: money.rows[0],
    disputes: disputes.rows[0], orders_last_14_days: daily.rows, feed: feed.rows[0],
    completion_rate: total ? Math.round((completed / total) * 100) : 0, marketplace,
  });
});

export const listUsers = asyncHandler(async (req, res) => {
  const { role, q } = req.query;
  const { rows } = await query(
    `SELECT id, email, full_name, phone, role, region, fayda_verified, is_active, created_at FROM users
      WHERE ($1::text IS NULL OR role=$1) AND ($2::text IS NULL OR full_name ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%')
      ORDER BY created_at DESC LIMIT 200`, [role ?? null, q ?? null]);
  res.json({ users: rows });
});

export const updateUser = asyncHandler(async (req, res) => {
  const { is_active, fayda_verified } = req.body;
  if (req.params.id === req.user.id && is_active === false) throw badRequest('You cannot disable your own account');
  const { rows } = await query(
    `UPDATE users SET is_active=COALESCE($2,is_active), fayda_verified=COALESCE($3,fayda_verified) WHERE id=$1
     RETURNING id, email, full_name, role, is_active, fayda_verified`, [req.params.id, is_active ?? null, fayda_verified ?? null]);
  if (!rows[0]) throw notFound('User not found');
  await audit(req.user.id, 'admin.user_update', 'user', req.params.id, req.body);
  res.json({ user: rows[0] });
});

export const allTests = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.created_at, t.test_type, t.grade, t.estimated_water_percent, t.confidence, t.method, t.flags, u.full_name AS tested_by_name, b.collection_location
       FROM milk_tests t JOIN users u ON u.id=t.tested_by LEFT JOIN milk_batches b ON b.id=t.batch_id ORDER BY t.created_at DESC LIMIT 200`);
  res.json({ tests: rows });
});

export const trends = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT to_char(date_trunc('week', created_at),'YYYY-MM-DD') AS week, count(*)::int AS tests,
            round(avg(estimated_water_percent)::numeric,1) AS avg_water,
            round(100.0*count(*) FILTER (WHERE grade='A')/count(*),0) AS pct_grade_a
       FROM milk_tests WHERE test_type='producer' AND created_at > now() - interval '12 weeks' GROUP BY 1 ORDER BY 1`);
  res.json({ weeks: rows });
});

export const auditLogs = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.full_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`);
  res.json({ logs: rows });
});

export const getSettingsHandler = asyncHandler(async (_req, res) => res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS }));

export const updateSettings = asyncHandler(async (req, res) => {
  const current = await getSettings();
  const next = { ...current, ...req.body };
  if (next.grade_a_max_water >= next.grade_b_max_water) throw badRequest('Grade A threshold must be below Grade B threshold');
  for (const [k, v] of Object.entries(req.body)) await setSetting(k, v);
  await audit(req.user.id, 'admin.settings_update', 'settings', null, req.body);
  res.json({ settings: await getSettings() });
});

// ---- Calibration: admin enters samples of milk mixed with KNOWN water amounts, the model refits.
export const listCalibration = asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM calibration_samples ORDER BY created_at DESC LIMIT 500');
  const settings = await getSettings();
  const diag = diagnoseCalibration(rows, settings);
  res.json({ samples: rows, fit: diag.fit, diagnostics: { calibrated: diag.calibrated, baseline: diag.baseline, warnings: diag.warnings, per_sample: diag.samples }, active: settings.calibration });
});

/** What-if tool: run readings through the current model and, for comparison, the generic baseline. */
export const previewModel = asyncHandler(async (req, res) => {
  const t = req.body;
  const settings = await getSettings();
  const input = { lactometer: t.lactometer_reading, temperature: t.temperature_c, fat: t.fat_percent, conductivity: t.conductivity_ms };
  res.json({
    current_model: assess(input, settings),
    generic_baseline: assess(input, { ...settings, calibration: null }),
    calibrated: !!settings.calibration,
  });
});

export const addCalibrationSample = asyncHandler(async (req, res) => {
  const s = await getSettings();
  const { lactometer_reading: L, temperature_c: T, known_water_percent: W } = req.body;
  const corrected = L + s.temp_coeff * (T - s.standard_temp_c);
  const { rows } = await query(
    `INSERT INTO calibration_samples(created_by, lactometer_reading, temperature_c, corrected_reading, known_water_percent) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, L, T, Math.round(corrected * 100) / 100, W]);
  res.status(201).json({ sample: rows[0] });
});

export const applyCalibration = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM calibration_samples');
  const fit = fitCalibration(rows);
  if (!fit.ok) throw conflict(fit.reason);
  await setSetting('calibration', { slope: fit.slope, intercept: fit.intercept, n: fit.n, rmse: fit.rmse, r2: fit.r2 });
  await audit(req.user.id, 'admin.calibration_apply', 'settings', null, fit);
  res.json({ applied: fit });
});

export const clearCalibration = asyncHandler(async (req, res) => {
  await withTransaction(async () => setSetting('calibration', null));
  await audit(req.user.id, 'admin.calibration_clear', 'settings', null);
  res.json({ cleared: true });
});

// ---------- Catalogue, deliveries, earnings, reviews, assistant usage ----------
export const listCategories = asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT c.*, (SELECT count(*)::int FROM dairy_products p WHERE p.category_id=c.id) AS products FROM product_categories c ORDER BY name');
  res.json({ categories: rows });
});
export const createCategory = asyncHandler(async (req, res) => {
  try {
    const { rows } = await query('INSERT INTO product_categories(name, active) VALUES ($1, COALESCE($2,TRUE)) RETURNING *', [req.body.name, req.body.active ?? null]);
    await audit(req.user.id, 'category.create', 'category', rows[0].id);
    res.status(201).json({ category: rows[0] });
  } catch (e) { if (e.code === '23505') throw conflict('A category with that name already exists'); throw e; }
});
export const updateCategory = asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE product_categories SET name=COALESCE($2,name), active=COALESCE($3,active) WHERE id=$1 RETURNING *', [req.params.id, req.body.name ?? null, req.body.active ?? null]);
  if (!rows[0]) throw notFound('Category not found');
  res.json({ category: rows[0] });
});

export const listProducts = asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT p.*, c.name AS category_name, u.full_name AS seller_name FROM dairy_products p LEFT JOIN product_categories c ON c.id=p.category_id JOIN users u ON u.id=p.seller_id ORDER BY p.created_at DESC LIMIT 300`);
  res.json({ products: rows });
});
export const setProductStatus = asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE dairy_products SET status=$2, updated_at=now() WHERE id=$1 RETURNING *', [req.params.id, req.body.status]);
  if (!rows[0]) throw notFound('Product not found');
  await audit(req.user.id, 'product.moderate', 'product', req.params.id, { status: req.body.status });
  res.json({ product: rows[0] });
});

export const listProductOrders = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT po.id, po.tracking_number, po.status, po.payment_status, po.total_amount, po.delivery_option, po.created_at, b.full_name AS buyer_name, s.full_name AS seller_name,
            (SELECT status FROM deliveries WHERE product_order_id=po.id AND status<>'rejected' LIMIT 1) AS delivery_status
       FROM product_orders po JOIN users b ON b.id=po.buyer_id JOIN users s ON s.id=po.seller_id ORDER BY po.created_at DESC LIMIT 300`);
  res.json({ orders: rows });
});

export const listDeliveries = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT d.id, d.status, d.created_at, d.delivery_fee, d.pickup_location, d.destination_address, u.full_name AS partner_name, u.phone AS partner_phone,
            CASE WHEN d.product_order_id IS NOT NULL THEN 'product' ELSE 'milk' END AS kind, d.order_id, d.product_order_id,
            COALESCE(po.tracking_number, upper(substr(replace(d.order_id::text,'-',''),1,10))) AS order_ref, d.delivered_at
       FROM deliveries d JOIN users u ON u.id=d.transporter_id LEFT JOIN product_orders po ON po.id=d.product_order_id
      WHERE ($1::text IS NULL OR d.status=$1) ORDER BY d.created_at DESC LIMIT 300`, [req.query.status ?? null]);
  const waiting = await query(
    `SELECT po.id, po.tracking_number AS order_ref, po.delivery_address AS destination, po.pickup_location, po.updated_at FROM product_orders po
      WHERE po.status='ready_for_pickup' AND po.delivery_option='delivery' AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.product_order_id=po.id AND d.status<>'rejected')
     UNION ALL
     SELECT o.id, upper(substr(replace(o.id::text,'-',''),1,10)), o.delivery_address, b.collection_location, o.updated_at FROM orders o JOIN milk_batches b ON b.id=o.batch_id
      WHERE o.status='paid' AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id=o.id AND d.status<>'rejected')
      ORDER BY 5 LIMIT 100`);
  res.json({ deliveries: rows, awaiting_assignment: waiting.rows });
});

/** Manual assignment by an administrator, subject to the same eligibility rules as automatic assignment. */
export const assignDelivery = asyncHandler(async (req, res) => {
  const { order_kind, order_id, transporter_id, instructions } = req.body;
  const d = await withTransaction(async (client) => {
    const t = await client.query(`SELECT 1 FROM transporter_profiles tp JOIN users u ON u.id=tp.user_id WHERE tp.user_id=$1 AND u.is_active AND tp.availability_status='available'`, [transporter_id]);
    if (!t.rowCount) throw badRequest('That delivery partner is not available');
    if (order_kind === 'product') {
      const po = (await client.query('SELECT * FROM product_orders WHERE id=$1 FOR UPDATE', [order_id])).rows[0];
      if (!po) throw notFound('Order not found');
      if (po.status !== 'ready_for_pickup' || po.delivery_option !== 'delivery') throw conflict('Only a delivery order that is ready for pickup can be assigned');
      if ((await client.query(`SELECT 1 FROM deliveries WHERE product_order_id=$1 AND status<>'rejected'`, [order_id])).rowCount) throw conflict('A delivery is already assigned');
      return createDelivery(client, { productOrderId: order_id, transporterId: transporter_id, instructions: instructions ?? null });
    }
    const o = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [order_id])).rows[0];
    if (!o) throw notFound('Order not found');
    if (o.status !== 'paid') throw conflict('Delivery can only be assigned to a paid order');
    if ((await client.query(`SELECT 1 FROM deliveries WHERE order_id=$1 AND status<>'rejected'`, [order_id])).rowCount) throw conflict('A delivery is already assigned');
    return createDelivery(client, { orderId: order_id, transporterId: transporter_id, instructions: instructions ?? null });
  });
  await audit(req.user.id, 'admin.assign_delivery', 'delivery', d.id, { order_kind, order_id, transporter_id });
  res.status(201).json({ delivery: d });
});

export const listEarnings = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT e.id, e.amount, e.currency, e.payment_status, e.created_at, e.paid_at, u.full_name AS partner_name, COALESCE(po.tracking_number, upper(substr(replace(d.order_id::text,'-',''),1,10))) AS order_ref
       FROM delivery_earnings e JOIN users u ON u.id=e.partner_id JOIN deliveries d ON d.id=e.delivery_id LEFT JOIN product_orders po ON po.id=d.product_order_id ORDER BY e.created_at DESC LIMIT 300`);
  res.json({ earnings: rows });
});
export const payEarning = asyncHandler(async (req, res) => {
  const { rows } = await query(`UPDATE delivery_earnings SET payment_status='paid', paid_at=now() WHERE id=$1 AND payment_status='pending' RETURNING *`, [req.params.id]);
  if (!rows[0]) throw conflict('Earning not found or already paid');
  await notify(null, rows[0].partner_id, 'earnings', 'Payout recorded', `ETB ${rows[0].amount} was marked as paid.`, '/delivery/earnings');
  await audit(req.user.id, 'admin.pay_earning', 'delivery_earning', req.params.id);
  res.json({ earning: rows[0] });
});

export const listReviews = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.product_rating, r.delivery_rating, r.review, r.created_at, b.full_name AS buyer_name, s.full_name AS seller_name,
            CASE WHEN r.product_order_id IS NOT NULL THEN 'product' ELSE 'milk' END AS kind,
            COALESCE(po.tracking_number, upper(substr(replace(r.order_id::text,'-',''),1,10))) AS order_ref
       FROM buyer_reviews r JOIN users b ON b.id=r.buyer_id JOIN users s ON s.id=r.seller_id LEFT JOIN product_orders po ON po.id=r.product_order_id
      WHERE ($1::int IS NULL OR r.product_rating <= $1 OR r.delivery_rating <= $1) ORDER BY r.created_at DESC LIMIT 200`, [req.query.max_rating ? Number(req.query.max_rating) : null]);
  res.json({ reviews: rows });
});

/** Usage statistics only. Conversation text is not stored, so there is nothing private to browse. */
export const aiUsage = asyncHandler(async (_req, res) => {
  const [total, byIntent, byRole, daily] = await Promise.all([
    query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE channel='voice')::int AS voice, count(DISTINCT user_id)::int AS users FROM ai_usage`),
    query(`SELECT intent, count(*)::int AS count FROM ai_usage GROUP BY intent ORDER BY count DESC LIMIT 12`),
    query(`SELECT role, count(*)::int AS count FROM ai_usage GROUP BY role ORDER BY count DESC`),
    query(`SELECT to_char(d::date,'MM-DD') AS day, count(a.id)::int AS count FROM generate_series(current_date - interval '13 days', current_date, '1 day') d LEFT JOIN ai_usage a ON a.created_at::date=d::date GROUP BY d ORDER BY d`),
  ]);
  res.json({ totals: total.rows[0], by_intent: byIntent.rows, by_role: byRole.rows, last_14_days: daily.rows, privacy: 'Message text is not stored. Administrators see counts only.' });
});
