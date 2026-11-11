import { query } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getSettings } from '../services/settings.service.js';

/**
 * Debo Assistant: a rule-based assistant (keyword intents), NOT a language model.
 * Every answer is computed from the signed-in user's own records, scoped by user id in SQL, so it cannot reveal another
 * user's orders, another partner's location or private business data. Message text is never stored: only intent counts.
 */
const etb = (n) => `ETB ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const label = (s) => String(s).replaceAll('_', ' ');
const STOP = new Set(['show', 'me', 'find', 'any', 'available', 'the', 'a', 'an', 'is', 'are', 'there', 'do', 'you', 'have', 'i', 'want', 'to', 'buy', 'some', 'what', 'whats', 'price', 'of', 'for', 'how', 'much', 'does', 'cost', 'please', 'in', 'stock', 'can', 'get', 'with', 'my', 'market', 'current', 'today', 'and']);
const keywords = (t) => t.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const has = (t, ...ws) => ws.some((w) => t.includes(w));

const HELP = {
  buyer: 'I can answer: "What are my active orders?", "Where is my milk delivery?", "How much did I spend this month?", "Show me available butter", "When will my order arrive?", "What is the market price of milk?"',
  transporter: 'I can answer: "How many deliveries are assigned to me?", "Where is my next pickup location?", "How much have I earned this week?", "Which deliveries are pending?"',
  farmer: 'I can answer: "Which of my batches are listed?", "How much have I sold?", "What orders are waiting for me?", "What is the market price of milk?"',
  admin: 'I can give platform totals: "Platform summary", "How many open disputes?". I cannot read anyone\'s private assistant conversations (they are not stored).',
  feed_supplier: 'I can answer: "What is the market price of milk?" More supplier questions are not available yet.',
};

async function marketPrice(t) {
  const s = await getSettings();
  const kw = keywords(t).filter((w) => !['milk', 'price', 'prices'].includes(w));
  const milk = (await query(`SELECT count(*)::int AS n, round(min(COALESCE(asking_price, recommended_price))::numeric,2) AS lo, round(avg(COALESCE(asking_price, recommended_price))::numeric,2) AS avg, round(max(COALESCE(asking_price, recommended_price))::numeric,2) AS hi FROM milk_batches WHERE status='listed'`)).rows[0];
  let reply = `The platform reference price for Grade A raw milk is ${etb(s.base_price_per_litre)} per litre (an admin-set value).`;
  if (milk.n) reply += ` Currently listed batches ask ${etb(milk.lo)} to ${etb(milk.hi)} per litre (average ${etb(milk.avg)}, ${milk.n} listing${milk.n > 1 ? 's' : ''}).`;
  if (kw.length) {
    const p = (await query(`SELECT count(*)::int AS n, min(price) AS lo, max(price) AS hi, round(avg(price)::numeric,2) AS avg FROM dairy_products p LEFT JOIN product_categories c ON c.id=p.category_id WHERE p.status='available' AND p.stock>0 AND (p.name ILIKE '%'||$1||'%' OR c.name ILIKE '%'||$1||'%')`, [kw[0]])).rows[0];
    if (p.n) reply += ` For "${kw[0]}": ${p.n} offer${p.n > 1 ? 's' : ''} from ${etb(p.lo)} to ${etb(p.hi)} (average ${etb(p.avg)}).`;
    else reply += ` I found no listed products matching "${kw[0]}".`;
  }
  return { intent: 'market_price', reply, links: [{ label: 'Open marketplace', to: '/buyer/market' }] };
}

async function buyer(t, u) {
  if (has(t, 'market price', 'price of milk', 'how much is', 'how much does', 'prices')) return marketPrice(t);
  if (has(t, 'spend', 'spent', 'spending')) {
    const r = (await query(
      `SELECT COALESCE(sum(a),0) AS total, count(*)::int AS n FROM (
         SELECT total_amount AS a FROM product_orders WHERE buyer_id=$1 AND payment_status='paid' AND status<>'cancelled' AND created_at >= date_trunc('month', now())
         UNION ALL SELECT total_amount FROM orders WHERE buyer_id=$1 AND status IN ('paid','in_transit','delivered','completed','disputed') AND created_at >= date_trunc('month', now())) x`, [u.id])).rows[0];
    return { intent: 'spend_month', reply: r.n ? `This month you spent ${etb(r.total)} across ${r.n} paid order${r.n > 1 ? 's' : ''}.` : 'You have no paid orders this month yet.', links: [{ label: 'My orders', to: '/buyer/orders' }] };
  }
  if (has(t, 'when will', 'arrive', 'eta', 'how long')) {
    const d = (await query(
      `SELECT d.status, d.deadline, COALESCE(po.tracking_number, upper(substr(replace(d.order_id::text,'-',''),1,10))) AS ref FROM deliveries d LEFT JOIN product_orders po ON po.id=d.product_order_id LEFT JOIN orders o ON o.id=d.order_id
        WHERE COALESCE(po.buyer_id, o.buyer_id)=$1 AND d.status IN ('requested','accepted','heading_to_pickup','collected','in_transit') ORDER BY d.created_at DESC LIMIT 1`, [u.id])).rows[0];
    if (!d) return { intent: 'eta', reply: 'You have no delivery in progress right now.', links: [{ label: 'My orders', to: '/buyer/orders' }] };
    return { intent: 'eta', reply: d.deadline ? `Order ${d.ref} is ${label(d.status)}. Its delivery deadline is ${new Date(d.deadline).toLocaleString()}.` : `Order ${d.ref} is ${label(d.status)}. No delivery time estimate is available, so I will not guess one. Check the tracking page for status updates.`, links: [{ label: 'My orders', to: '/buyer/orders' }] };
  }
  if (has(t, 'where', 'track', 'delivery status', 'my delivery')) {
    const rows = (await query(
      `SELECT d.status, u.full_name AS partner, COALESCE(po.tracking_number, upper(substr(replace(d.order_id::text,'-',''),1,10))) AS ref,
              (SELECT max(recorded_at) FROM delivery_locations l WHERE l.delivery_id=d.id) AS last_update
         FROM deliveries d JOIN users u ON u.id=d.transporter_id LEFT JOIN product_orders po ON po.id=d.product_order_id LEFT JOIN orders o ON o.id=d.order_id
        WHERE COALESCE(po.buyer_id, o.buyer_id)=$1 AND d.status<>'rejected' ORDER BY d.created_at DESC LIMIT 3`, [u.id])).rows;
    if (!rows.length) return { intent: 'delivery_status', reply: 'None of your orders has a delivery partner yet.', links: [{ label: 'My orders', to: '/buyer/orders' }] };
    return { intent: 'delivery_status', reply: rows.map((r) => `Order ${r.ref}: ${label(r.status)} with ${r.partner}${r.last_update ? ` (last location update ${new Date(r.last_update).toLocaleString()})` : ' (no live location shared)'}.`).join(' '), links: [{ label: 'My orders', to: '/buyer/orders' }] };
  }
  if (has(t, 'active order', 'my order', 'current order', 'open order', 'orders')) {
    const rows = (await query(
      `SELECT * FROM (SELECT tracking_number AS ref, status, total_amount FROM product_orders WHERE buyer_id=$1 AND status NOT IN ('delivered','cancelled')
         UNION ALL SELECT upper(substr(replace(id::text,'-',''),1,10)), status, total_amount FROM orders WHERE buyer_id=$1 AND status IN ('pending_payment','paid','in_transit','delivered','disputed')) x LIMIT 8`, [u.id])).rows;
    return { intent: 'active_orders', reply: rows.length ? `You have ${rows.length} active order${rows.length > 1 ? 's' : ''}: ${rows.map((r) => `${r.ref} (${label(r.status)}, ${etb(r.total_amount)})`).join('; ')}.` : 'You have no active orders.', links: [{ label: 'My orders', to: '/buyer/orders' }] };
  }
  const kw = keywords(t);
  const asked = has(t, 'available', 'show', 'find', 'buy', 'have', 'stock', 'looking');
  if (kw.length && (asked || kw.length <= 2)) {
    const rows = (await query(
      `SELECT p.name, p.price, p.unit, p.stock, s.full_name AS seller FROM dairy_products p JOIN users s ON s.id=p.seller_id LEFT JOIN product_categories c ON c.id=p.category_id
        WHERE p.status='available' AND p.stock>0 AND s.is_active AND (p.name ILIKE '%'||$1||'%' OR c.name ILIKE '%'||$1||'%') ORDER BY p.price LIMIT 5`, [kw[0]])).rows;
    if (rows.length) return { intent: 'find_product', reply: `Available now: ${rows.map((r) => `${r.name} at ${etb(r.price)}/${r.unit} from ${r.seller} (${r.stock} in stock)`).join('; ')}.`, links: [{ label: 'Open marketplace', to: '/buyer/market' }] };
    if (asked && kw[0] !== 'milk') return { intent: 'find_product', reply: `I found no available products matching "${kw[0]}".`, links: [{ label: 'Open marketplace', to: '/buyer/market' }] };
  }
  if (has(t, 'milk')) return marketPrice(t);
  return null;
}

async function partner(t, u) {
  if (has(t, 'earn', 'income', 'paid')) {
    const r = (await query(`SELECT COALESCE(sum(amount) FILTER (WHERE created_at >= date_trunc('week', now())),0) AS week, COALESCE(sum(amount) FILTER (WHERE created_at >= date_trunc('day', now())),0) AS day,
                                   COALESCE(sum(amount) FILTER (WHERE payment_status='pending'),0) AS pending FROM delivery_earnings WHERE partner_id=$1`, [u.id])).rows[0];
    return { intent: 'earnings_week', reply: `This week you earned ${etb(r.week)} (today ${etb(r.day)}). ${etb(r.pending)} is still pending payout.`, links: [{ label: 'Earnings', to: '/delivery/earnings' }] };
  }
  if (has(t, 'next pickup', 'pickup location', 'where')) {
    const d = (await query(`SELECT pickup_location, destination_address, status FROM deliveries WHERE transporter_id=$1 AND status IN ('requested','accepted','heading_to_pickup') ORDER BY created_at LIMIT 1`, [u.id])).rows[0];
    return { intent: 'next_pickup', reply: d ? `Your next pickup is at ${d.pickup_location || 'the seller (location not recorded)'}, delivering to ${d.destination_address || 'the buyer'}. Status: ${label(d.status)}.` : 'You have no upcoming pickup.', links: [{ label: 'Assignments', to: '/delivery/assignments' }] };
  }
  if (has(t, 'pending')) {
    const rows = (await query(`SELECT COALESCE(po.tracking_number, upper(substr(replace(d.order_id::text,'-',''),1,10))) AS ref, d.status FROM deliveries d LEFT JOIN product_orders po ON po.id=d.product_order_id
                                WHERE d.transporter_id=$1 AND d.status IN ('requested','accepted','heading_to_pickup','collected','in_transit') ORDER BY d.created_at LIMIT 10`, [u.id])).rows;
    return { intent: 'pending_deliveries', reply: rows.length ? `You have ${rows.length} unfinished: ${rows.map((r) => `${r.ref} (${label(r.status)})`).join('; ')}.` : 'You have no pending deliveries.', links: [{ label: 'Assignments', to: '/delivery/assignments' }] };
  }
  if (has(t, 'how many', 'assigned', 'deliveries')) {
    const r = (await query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('requested','accepted','heading_to_pickup','collected','in_transit'))::int AS active, count(*) FILTER (WHERE status='delivered')::int AS done FROM deliveries WHERE transporter_id=$1 AND status<>'rejected'`, [u.id])).rows[0];
    return { intent: 'assigned_count', reply: `${r.total} deliveries assigned to you: ${r.active} active and ${r.done} completed.`, links: [{ label: 'Assignments', to: '/delivery/assignments' }] };
  }
  return null;
}

async function farmer(t, u) {
  if (has(t, 'market price', 'price of milk', 'price')) return marketPrice(t);
  if (has(t, 'sold', 'sales', 'earned', 'revenue')) {
    const r = (await query(`SELECT COALESCE(sum(total_amount) FILTER (WHERE status='completed'),0) AS milk, count(*) FILTER (WHERE status='completed')::int AS n FROM orders WHERE farmer_id=$1`, [u.id])).rows[0];
    const p = (await query(`SELECT COALESCE(sum(total_amount),0) AS s, count(*)::int AS n FROM product_orders WHERE seller_id=$1 AND status='delivered'`, [u.id])).rows[0];
    return { intent: 'sales', reply: `Completed milk sales: ${etb(r.milk)} (${r.n} orders). Delivered product orders: ${etb(p.s)} (${p.n}).`, links: [{ label: 'Dashboard', to: '/farmer' }] };
  }
  if (has(t, 'order', 'waiting')) {
    const r = (await query(`SELECT count(*) FILTER (WHERE status IN ('pending','confirmed','processing','ready_for_pickup'))::int AS open FROM product_orders WHERE seller_id=$1`, [u.id])).rows[0];
    return { intent: 'seller_orders', reply: `${r.open} product order${r.open === 1 ? '' : 's'} need your attention.`, links: [{ label: 'Product orders', to: '/farmer/product-orders' }] };
  }
  if (has(t, 'batch', 'listed', 'milk')) {
    const r = (await query(`SELECT count(*) FILTER (WHERE status='listed')::int AS listed, COALESCE(sum(remaining_litres) FILTER (WHERE status='listed'),0) AS litres FROM milk_batches WHERE farmer_id=$1`, [u.id])).rows[0];
    return { intent: 'my_batches', reply: `You have ${r.listed} listed batch${r.listed === 1 ? '' : 'es'} with ${r.litres} litres remaining.`, links: [{ label: 'Milk batches', to: '/farmer/batches' }] };
  }
  return null;
}

async function admin(t) {
  if (has(t, 'summary', 'platform', 'total', 'how many', 'dispute')) {
    const r = (await query(`SELECT (SELECT count(*)::int FROM users WHERE role='farmer') AS farmers, (SELECT count(*)::int FROM users WHERE role='buyer') AS buyers, (SELECT count(*)::int FROM users WHERE role='transporter') AS partners,
                                   (SELECT count(*)::int FROM orders)+(SELECT count(*)::int FROM product_orders) AS orders, (SELECT count(*)::int FROM disputes WHERE status='open') AS disputes`)).rows[0];
    return { intent: 'platform_summary', reply: `Platform: ${r.farmers} farmers, ${r.buyers} buyers, ${r.partners} delivery partners, ${r.orders} orders, ${r.disputes} open dispute${r.disputes === 1 ? '' : 's'}.`, links: [{ label: 'Dashboard', to: '/admin' }] };
  }
  return null;
}

export const chat = asyncHandler(async (req, res) => {
  const t = ` ${req.body.message.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `.trim();
  const handlers = { buyer, transporter: partner, farmer, admin };
  const hit = await (handlers[req.user.role]?.(t, req.user) ?? null);
  const out = hit || { intent: has(t, 'hello', 'hi', 'help', 'hey') ? 'help' : 'unknown', reply: `${has(t, 'hello', 'hi', 'hey') ? 'Hello! ' : "I didn't understand that. "}${HELP[req.user.role] || HELP.buyer}`, links: [] };
  await query('INSERT INTO ai_usage(user_id, role, intent, channel) VALUES ($1,$2,$3,$4)', [req.user.id, req.user.role, out.intent, req.body.channel]);
  res.json({ ...out, note: 'Rule-based assistant: answers come from your own records. Message text is not stored.' });
});
