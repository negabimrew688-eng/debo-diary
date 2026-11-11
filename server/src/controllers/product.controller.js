import { query } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound, conflict, badRequest } from '../utils/AppError.js';
import { audit } from '../utils/audit.js';

const SELECT = `
  SELECT p.*, c.name AS category_name, u.full_name AS seller_name, u.phone AS seller_phone, u.region AS seller_region, u.fayda_verified AS seller_verified,
         (SELECT round(avg(r.product_rating)::numeric,1) FROM buyer_reviews r WHERE r.seller_id=p.seller_id) AS seller_rating,
         (SELECT count(*)::int FROM buyer_reviews r WHERE r.seller_id=p.seller_id) AS seller_reviews
    FROM dairy_products p LEFT JOIN product_categories c ON c.id=p.category_id JOIN users u ON u.id=p.seller_id`;

export const categories = asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT id, name FROM product_categories WHERE active ORDER BY name');
  res.json({ categories: rows });
});

/** Browse: only available products from active sellers. */
export const browse = asyncHandler(async (req, res) => {
  const q = req.query;
  const where = [`p.status='available'`, 'u.is_active'];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (q.search) add(`(p.name ILIKE '%'||?||'%' OR p.description ILIKE '%'||?||'%' OR c.name ILIKE '%'||?||'%')`, q.search);
  if (q.category_id) add('p.category_id=?', q.category_id);
  if (q.region) add(`(u.region ILIKE '%'||?||'%' OR p.location_text ILIKE '%'||?||'%')`, q.region);
  if (q.min_price !== undefined) add('p.price>=?', q.min_price);
  if (q.max_price !== undefined) add('p.price<=?', q.max_price);
  if (q.in_stock === 'true') where.push('p.stock>0');
  if (q.seller_id) add('p.seller_id=?', q.seller_id);
  const order = { price_asc: 'p.price ASC', price_desc: 'p.price DESC', newest: 'p.created_at DESC' }[q.sort];
  const { rows } = await query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 100`, params);
  res.json({ products: rows.map(({ seller_phone, ...r }) => r) });
});

export const detail = asyncHandler(async (req, res) => {
  const { rows } = await query(`${SELECT} WHERE p.id=$1 AND (p.status='available' OR p.seller_id=$2 OR $3)`, [req.params.id, req.user.id, req.user.role === 'admin']);
  if (!rows[0]) throw notFound('Product not found');
  const reviews = await query(
    `SELECT r.product_rating, r.delivery_rating, r.review, r.created_at, u.full_name AS buyer_name FROM buyer_reviews r JOIN users u ON u.id=r.buyer_id
      WHERE r.seller_id=$1 ORDER BY r.created_at DESC LIMIT 10`, [rows[0].seller_id]);
  res.json({ product: rows[0], reviews: reviews.rows });
});

/** Price comparison for products that match a search term or category. */
export const compare = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `${SELECT} WHERE p.status='available' AND u.is_active AND p.stock>0
       AND ($1::text IS NULL OR p.name ILIKE '%'||$1||'%' OR c.name ILIKE '%'||$1||'%') AND ($2::uuid IS NULL OR p.category_id=$2)
     ORDER BY p.price ASC LIMIT 50`, [req.query.search ?? null, req.query.category_id ?? null]);
  const prices = rows.map((r) => Number(r.price));
  res.json({
    offers: rows.map(({ seller_phone, ...r }) => r),
    summary: prices.length ? { min: Math.min(...prices), max: Math.max(...prices), average: Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100, count: prices.length } : null,
  });
});

// ---- Seller (farmer) side ----
export const mine = asyncHandler(async (req, res) => {
  const { rows } = await query(`${SELECT} WHERE p.seller_id=$1 ORDER BY p.created_at DESC`, [req.user.id]);
  res.json({ products: rows });
});

async function assertCategory(id) {
  if (!id) return;
  const c = await query('SELECT 1 FROM product_categories WHERE id=$1 AND active', [id]);
  if (!c.rowCount) throw badRequest('Unknown product category');
}

export const create = asyncHandler(async (req, res) => {
  const b = req.body;
  await assertCategory(b.category_id);
  const { rows } = await query(
    `INSERT INTO dairy_products(seller_id, category_id, name, description, unit, price, stock, location_text, image_url, quality_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [req.user.id, b.category_id ?? null, b.name, b.description ?? null, b.unit, b.price, b.stock, b.location_text ?? null, b.image_url ?? null, b.quality_note ?? null]);
  await audit(req.user.id, 'product.create', 'product', rows[0].id);
  res.status(201).json({ product: (await query(`${SELECT} WHERE p.id=$1`, [rows[0].id])).rows[0] });
});

export const update = asyncHandler(async (req, res) => {
  const b = req.body;
  await assertCategory(b.category_id);
  const keys = ['category_id', 'name', 'description', 'unit', 'price', 'stock', 'location_text', 'image_url', 'quality_note', 'status'].filter((k) => b[k] !== undefined);
  if (!keys.length) throw badRequest('Nothing to update');
  const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(', ');
  const { rows } = await query(`UPDATE dairy_products SET ${sets}, updated_at=now() WHERE id=$1 AND seller_id=$2 RETURNING id`, [req.params.id, req.user.id, ...keys.map((k) => b[k])]);
  if (!rows[0]) throw notFound('Product not found');
  res.json({ product: (await query(`${SELECT} WHERE p.id=$1`, [req.params.id])).rows[0] });
});

export const remove = asyncHandler(async (req, res) => {
  const used = await query('SELECT 1 FROM product_order_items WHERE product_id=$1 LIMIT 1', [req.params.id]);
  if (used.rowCount) {
    const r = await query(`UPDATE dairy_products SET status='hidden', updated_at=now() WHERE id=$1 AND seller_id=$2 RETURNING id`, [req.params.id, req.user.id]);
    if (!r.rowCount) throw notFound('Product not found');
    return res.json({ hidden: true, message: 'This product has orders, so it was hidden instead of deleted.' });
  }
  const r = await query('DELETE FROM dairy_products WHERE id=$1 AND seller_id=$2', [req.params.id, req.user.id]);
  if (!r.rowCount) throw notFound('Product not found');
  res.json({ deleted: true });
});
