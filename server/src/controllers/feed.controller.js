import { query, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound, conflict, forbidden } from '../utils/AppError.js';
import { round } from '../utils/num.js';
import { concentrateKgPerDay } from '../services/feedAdvisor.service.js';
import { audit } from '../utils/audit.js';

// ---- Supplier product management
export const myProducts = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM feed_products WHERE supplier_id=$1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ products: rows });
});
export const createProduct = asyncHandler(async (req, res) => {
  const p = req.body;
  const { rows } = await query(
    `INSERT INTO feed_products(supplier_id, name, description, category, price_per_kg, stock_kg, protein_percent, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.id, p.name, p.description ?? null, p.category ?? 'concentrate', p.price_per_kg, p.stock_kg, p.protein_percent ?? null, p.active ?? true]);
  res.status(201).json({ product: rows[0] });
});
export const updateProduct = asyncHandler(async (req, res) => {
  const p = req.body;
  const { rows } = await query(
    `UPDATE feed_products SET name=COALESCE($3,name), description=COALESCE($4,description), category=COALESCE($5,category),
       price_per_kg=COALESCE($6,price_per_kg), stock_kg=COALESCE($7,stock_kg), protein_percent=COALESCE($8,protein_percent), active=COALESCE($9,active)
     WHERE id=$1 AND supplier_id=$2 RETURNING *`,
    [req.params.id, req.user.id, p.name ?? null, p.description ?? null, p.category ?? null, p.price_per_kg ?? null, p.stock_kg ?? null, p.protein_percent ?? null, p.active ?? null]);
  if (!rows[0]) throw notFound('Product not found');
  res.json({ product: rows[0] });
});
export const deleteProduct = asyncHandler(async (req, res) => {
  const used = await query('SELECT 1 FROM feed_orders WHERE product_id=$1 LIMIT 1', [req.params.id]);
  if (used.rowCount) { // keep history: hide instead of delete
    const { rowCount } = await query('UPDATE feed_products SET active=FALSE WHERE id=$1 AND supplier_id=$2', [req.params.id, req.user.id]);
    if (!rowCount) throw notFound('Product not found');
    return res.json({ deactivated: true });
  }
  const { rowCount } = await query('DELETE FROM feed_products WHERE id=$1 AND supplier_id=$2', [req.params.id, req.user.id]);
  if (!rowCount) throw notFound('Product not found');
  res.status(204).end();
});

// ---- Farmer browsing and ordering
export const browseProducts = asyncHandler(async (req, res) => {
  const { q, category } = req.query;
  const params = [];
  const where = ['p.active', 'p.stock_kg > 0'];
  if (q) { params.push(`%${q}%`); where.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`); }
  if (category) { params.push(category); where.push(`p.category=$${params.length}`); }
  const { rows } = await query(
    `SELECT p.*, sp.business_name, u.region FROM feed_products p JOIN users u ON u.id=p.supplier_id
       LEFT JOIN supplier_profiles sp ON sp.user_id=p.supplier_id WHERE ${where.join(' AND ')} ORDER BY p.price_per_kg ASC LIMIT 100`, params);
  res.json({ products: rows });
});

export const createFeedOrder = asyncHandler(async (req, res) => {
  const { product_id, quantity_kg } = req.body;
  const order = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM feed_products WHERE id=$1 FOR UPDATE', [product_id]);
    const p = rows[0];
    if (!p || !p.active) throw notFound('Product not available');
    if (quantity_kg > p.stock_kg) throw conflict(`Only ${p.stock_kg} kg in stock`);
    await client.query('UPDATE feed_products SET stock_kg = stock_kg - $2 WHERE id=$1', [p.id, quantity_kg]);
    const ins = await client.query(
      `INSERT INTO feed_orders(product_id, supplier_id, farmer_id, quantity_kg, total_amount) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [p.id, p.supplier_id, req.user.id, quantity_kg, round(p.price_per_kg * quantity_kg, 2)]);
    return ins.rows[0];
  });
  await audit(req.user.id, 'feed_order.create', 'feed_order', order.id);
  res.status(201).json({ order });
});

export const listFeedOrders = asyncHandler(async (req, res) => {
  const col = req.user.role === 'farmer' ? 'fo.farmer_id' : 'fo.supplier_id';
  const { rows } = await query(
    `SELECT fo.*, p.name AS product_name, fu.full_name AS farmer_name, fu.phone AS farmer_phone, fu.region AS farmer_region, su.full_name AS supplier_name
       FROM feed_orders fo JOIN feed_products p ON p.id=fo.product_id JOIN users fu ON fu.id=fo.farmer_id JOIN users su ON su.id=fo.supplier_id
      WHERE ${col}=$1 ORDER BY fo.created_at DESC LIMIT 200`, [req.user.id]);
  res.json({ orders: rows });
});

const FEED_NEXT = { placed: ['accepted', 'cancelled'], accepted: ['delivered', 'cancelled'] };
export const updateFeedOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM feed_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    const o = rows[0];
    const isSupplier = req.user.role === 'feed_supplier' && o?.supplier_id === req.user.id;
    const isFarmer = req.user.role === 'farmer' && o?.farmer_id === req.user.id;
    if (!o || (!isSupplier && !isFarmer)) throw notFound('Order not found');
    if (isFarmer && !(status === 'cancelled' && o.status === 'placed')) throw forbidden('Farmers can only cancel orders that are not yet accepted');
    if (!(FEED_NEXT[o.status] || []).includes(status)) throw conflict(`Cannot move an order from ${o.status} to ${status}`);
    await client.query('UPDATE feed_orders SET status=$2, updated_at=now() WHERE id=$1', [o.id, status]);
    if (status === 'cancelled') await client.query('UPDATE feed_products SET stock_kg = stock_kg + $2 WHERE id=$1', [o.product_id, o.quantity_kg]);
  });
  const { rows } = await query('SELECT * FROM feed_orders WHERE id=$1', [req.params.id]);
  res.json({ order: rows[0] });
});

/** Supplier view of farmer demand: estimated concentrate need from registered cows, plus what farmers actually ordered. */
export const demand = asyncHandler(async (req, res) => {
  const cows = await query(
    `SELECT COALESCE(u.region,'Unspecified') AS region, c.lactating, c.daily_yield_litres, u.id AS farmer_id
       FROM cows c JOIN users u ON u.id=c.farmer_id WHERE u.is_active`);
  const byRegion = new Map();
  for (const c of cows.rows) {
    const r = byRegion.get(c.region) || { region: c.region, farmers: new Set(), cows: 0, weekly_concentrate_kg: 0 };
    r.farmers.add(c.farmer_id); r.cows += 1; r.weekly_concentrate_kg += concentrateKgPerDay(c) * 7;
    byRegion.set(c.region, r);
  }
  const estimated = [...byRegion.values()].map((r) => ({ region: r.region, farmers: r.farmers.size, cows: r.cows, weekly_concentrate_kg: round(r.weekly_concentrate_kg, 1) }))
    .sort((a, b) => b.weekly_concentrate_kg - a.weekly_concentrate_kg);
  const ordered = await query(
    `SELECT p.name, sum(fo.quantity_kg) AS kg, count(*)::int AS orders FROM feed_orders fo JOIN feed_products p ON p.id=fo.product_id
      WHERE fo.supplier_id=$1 AND fo.status<>'cancelled' GROUP BY p.name ORDER BY kg DESC LIMIT 10`, [req.user.id]);
  const sales = await query(
    `SELECT COALESCE(sum(total_amount) FILTER (WHERE status='delivered'),0) AS delivered_sales,
            COALESCE(sum(total_amount) FILTER (WHERE status IN ('placed','accepted')),0) AS pending_sales
       FROM feed_orders WHERE supplier_id=$1`, [req.user.id]);
  res.json({ estimated_demand_by_region: estimated, your_top_products: ordered.rows, sales: sales.rows[0] });
});
