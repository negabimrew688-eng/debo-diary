import crypto from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound, badRequest, conflict, forbidden } from '../utils/AppError.js';
import { round } from '../utils/num.js';
import { audit } from '../utils/audit.js';
import { initiatePayment, isSandbox } from '../services/telebirr.service.js';
import { notify } from '../services/notify.service.js';
import { deliveryCode, logEvent, autoAssignProductDelivery } from '../services/delivery.service.js';
import { fetchOrder } from './order.controller.js';

const trackingNumber = () => `DD-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const milkRef = (id) => id.replaceAll('-', '').slice(0, 10).toUpperCase();

// ---------- Cart ----------
const CART_SELECT = `SELECT ci.id, ci.product_id, ci.quantity, p.name, p.unit, p.price, p.stock, p.image_url, p.status, u.full_name AS seller_name, p.seller_id,
                            round(ci.quantity * p.price, 2) AS line_total
                       FROM cart_items ci JOIN dairy_products p ON p.id=ci.product_id JOIN users u ON u.id=p.seller_id WHERE ci.buyer_id=$1 ORDER BY ci.id`;
async function cartPayload(buyerId) {
  const { rows } = await query(CART_SELECT, [buyerId]);
  return { items: rows, total: round(rows.reduce((s, r) => s + Number(r.line_total), 0), 2) };
}
export const getCart = asyncHandler(async (req, res) => res.json(await cartPayload(req.user.id)));

export const addToCart = asyncHandler(async (req, res) => {
  const { product_id, quantity } = req.body;
  const p = (await query(`SELECT p.stock, p.status, u.is_active FROM dairy_products p JOIN users u ON u.id=p.seller_id WHERE p.id=$1`, [product_id])).rows[0];
  if (!p || p.status !== 'available' || !p.is_active) throw notFound('This product is not available');
  const have = (await query('SELECT quantity FROM cart_items WHERE buyer_id=$1 AND product_id=$2', [req.user.id, product_id])).rows[0]?.quantity ?? 0;
  if (Number(have) + quantity > p.stock) throw conflict(`Only ${p.stock} in stock`);
  await query(`INSERT INTO cart_items(buyer_id, product_id, quantity) VALUES ($1,$2,$3)
               ON CONFLICT (buyer_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`, [req.user.id, product_id, quantity]);
  res.status(201).json(await cartPayload(req.user.id));
});

export const updateCartItem = asyncHandler(async (req, res) => {
  const row = (await query(`SELECT p.stock FROM cart_items ci JOIN dairy_products p ON p.id=ci.product_id WHERE ci.id=$1 AND ci.buyer_id=$2`, [req.params.id, req.user.id])).rows[0];
  if (!row) throw notFound('Cart item not found');
  if (req.body.quantity > row.stock) throw conflict(`Only ${row.stock} in stock`);
  await query('UPDATE cart_items SET quantity=$3 WHERE id=$1 AND buyer_id=$2', [req.params.id, req.user.id, req.body.quantity]);
  res.json(await cartPayload(req.user.id));
});

export const removeCartItem = asyncHandler(async (req, res) => {
  await query('DELETE FROM cart_items WHERE id=$1 AND buyer_id=$2', [req.params.id, req.user.id]);
  res.json(await cartPayload(req.user.id));
});

// ---------- Addresses ----------
export const listAddresses = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM buyer_addresses WHERE buyer_id=$1 ORDER BY is_default DESC, created_at DESC', [req.user.id]);
  res.json({ addresses: rows });
});
export const createAddress = asyncHandler(async (req, res) => {
  const b = req.body;
  const row = await withTransaction(async (client) => {
    const first = (await client.query('SELECT count(*)::int AS n FROM buyer_addresses WHERE buyer_id=$1', [req.user.id])).rows[0].n === 0;
    const makeDefault = b.is_default || first;
    if (makeDefault) await client.query('UPDATE buyer_addresses SET is_default=FALSE WHERE buyer_id=$1', [req.user.id]);
    return (await client.query(
      `INSERT INTO buyer_addresses(buyer_id,label,address,city,region,latitude,longitude,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, b.label ?? null, b.address, b.city ?? null, b.region ?? null, b.latitude ?? null, b.longitude ?? null, makeDefault])).rows[0];
  });
  res.status(201).json({ address: row });
});
export const updateAddress = asyncHandler(async (req, res) => {
  const b = req.body;
  const keys = ['label', 'address', 'city', 'region', 'latitude', 'longitude', 'is_default'].filter((k) => b[k] !== undefined);
  if (!keys.length) throw badRequest('Nothing to update');
  const row = await withTransaction(async (client) => {
    if (b.is_default) await client.query('UPDATE buyer_addresses SET is_default=FALSE WHERE buyer_id=$1', [req.user.id]);
    const sets = keys.map((k, i) => `${k}=$${i + 3}`).join(', ');
    const r = await client.query(`UPDATE buyer_addresses SET ${sets} WHERE id=$1 AND buyer_id=$2 RETURNING *`, [req.params.id, req.user.id, ...keys.map((k) => b[k])]);
    if (!r.rows[0]) throw notFound('Address not found');
    return r.rows[0];
  });
  res.json({ address: row });
});
export const deleteAddress = asyncHandler(async (req, res) => {
  const r = await query('DELETE FROM buyer_addresses WHERE id=$1 AND buyer_id=$2', [req.params.id, req.user.id]);
  if (!r.rowCount) throw notFound('Address not found');
  res.json({ deleted: true });
});

// ---------- Checkout: one order per seller, stock reserved under row locks ----------
export const checkout = asyncHandler(async (req, res) => {
  const { delivery_option, address_id, delivery_address, delivery_notes } = req.body;
  const orders = await withTransaction(async (client) => {
    let destination = null;
    if (delivery_option === 'delivery') {
      if (address_id) {
        const a = (await client.query('SELECT * FROM buyer_addresses WHERE id=$1 AND buyer_id=$2', [address_id, req.user.id])).rows[0];
        if (!a) throw notFound('Address not found');
        destination = [a.address, a.city, a.region].filter(Boolean).join(', ');
      } else destination = delivery_address;
    }
    const { rows: cart } = await client.query(
      `SELECT ci.id AS cart_id, ci.quantity, p.id AS product_id, p.name, p.unit, p.price, p.stock, p.status, p.seller_id, p.location_text, u.is_active, u.full_name AS seller_name,
              COALESCE(NULLIF(fp.location_text,''), p.location_text, NULLIF(concat_ws(', ', u.woreda, u.region),'')) AS pickup
         FROM cart_items ci JOIN dairy_products p ON p.id=ci.product_id JOIN users u ON u.id=p.seller_id LEFT JOIN farmer_profiles fp ON fp.user_id=u.id
        WHERE ci.buyer_id=$1 ORDER BY p.id FOR UPDATE OF p`, [req.user.id]);
    if (!cart.length) throw badRequest('Your cart is empty');
    for (const c of cart) {
      if (c.status !== 'available' || !c.is_active) throw conflict(`${c.name} is no longer available`);
      if (Number(c.quantity) > Number(c.stock)) throw conflict(`Only ${c.stock} ${c.unit} of ${c.name} left in stock`);
    }
    const bySeller = new Map();
    for (const c of cart) bySeller.set(c.seller_id, [...(bySeller.get(c.seller_id) || []), c]);
    const created = [];
    for (const [sellerId, lines] of bySeller) {
      const total = round(lines.reduce((s, l) => s + Number(l.price) * Number(l.quantity), 0), 2);
      const po = (await client.query(
        `INSERT INTO product_orders(tracking_number, buyer_id, seller_id, total_amount, delivery_option, delivery_address, delivery_notes, pickup_location)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [trackingNumber(), req.user.id, sellerId, total, delivery_option, destination, delivery_notes ?? null, lines[0].pickup])).rows[0];
      for (const l of lines) {
        await client.query(`INSERT INTO product_order_items(product_order_id, product_id, name, unit, unit_price, quantity) VALUES ($1,$2,$3,$4,$5,$6)`, [po.id, l.product_id, l.name, l.unit, l.price, l.quantity]);
        await client.query('UPDATE dairy_products SET stock = stock - $2, updated_at=now() WHERE id=$1', [l.product_id, l.quantity]);
      }
      await logEvent(client, 'product', po.id, 'pending');
      await notify(client, sellerId, 'order', 'New order received', `Order ${po.tracking_number} (ETB ${total}) is waiting for payment.`, '/farmer/product-orders');
      created.push(po);
    }
    await client.query('DELETE FROM cart_items WHERE buyer_id=$1', [req.user.id]);
    return created;
  });
  await audit(req.user.id, 'product_order.create', 'product_order', orders[0].id, { count: orders.length });
  res.status(201).json({ orders });
});

// ---------- Order lists and details (milk orders and product orders together) ----------
export function displayStatus(kind, o) {
  if (kind === 'product') return o.status;
  const m = { pending_payment: 'pending', paid: o.delivery_status && o.delivery_status !== 'requested' ? 'assigned' : o.delivery_status === 'requested' ? 'assigned' : 'confirmed',
    in_transit: 'in_transit', delivered: 'delivered', completed: 'delivered', disputed: 'delivered', refunded: 'cancelled', cancelled: 'cancelled' };
  return m[o.status] || o.status;
}

export const listOrders = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'product' AS kind, po.id, po.tracking_number AS ref, po.status, po.status AS display_status, po.payment_status, po.total_amount, po.created_at, s.full_name AS seller_name,
              (SELECT string_agg(name || ' x' || trim(trailing '.' from trim(trailing '0' from quantity::text)), ', ') FROM product_order_items WHERE product_order_id=po.id) AS summary,
              (SELECT status FROM deliveries WHERE product_order_id=po.id AND status<>'rejected' LIMIT 1) AS delivery_status
         FROM product_orders po JOIN users s ON s.id=po.seller_id WHERE po.buyer_id=$1
       UNION ALL
       SELECT 'milk', o.id, upper(substr(replace(o.id::text,'-',''),1,10)), o.status, o.status, (SELECT status FROM payments WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1), o.total_amount, o.created_at, f.full_name,
              o.volume_litres || ' L raw milk (Grade ' || o.agreed_grade || ')',
              (SELECT status FROM deliveries WHERE order_id=o.id AND status<>'rejected' LIMIT 1)
         FROM orders o JOIN users f ON f.id=o.farmer_id WHERE o.buyer_id=$1
     ) x ORDER BY created_at DESC LIMIT 300`, [req.user.id]);
  const orders = rows.map((r) => ({ ...r, display_status: r.kind === 'milk' ? displayStatus('milk', r) : r.status }));
  res.json({ orders: req.query.status ? orders.filter((o) => o.display_status === req.query.status) : orders });
});

const PRODUCT_STEPS = [['pending', 'Order placed'], ['paid', 'Payment received'], ['confirmed', 'Confirmed by seller'], ['processing', 'Processing'], ['ready_for_pickup', 'Ready for pickup'], ['assigned', 'Delivery partner assigned'], ['in_transit', 'In transit'], ['delivered', 'Delivered']];

async function productTimeline(po, selfPickup) {
  const ev = (await query(`SELECT status, min(created_at) AS at FROM order_events WHERE order_kind='product' AND order_id=$1 GROUP BY status`, [po.id])).rows;
  const at = Object.fromEntries(ev.map((e) => [e.status, e.at]));
  if (po.status === 'cancelled') return PRODUCT_STEPS.filter(([k]) => at[k]).map(([k, l]) => ({ key: k, label: l, done: true, at: at[k] })).concat([{ key: 'cancelled', label: 'Cancelled', done: true, at: at.cancelled }]);
  return PRODUCT_STEPS.filter(([k]) => !(selfPickup && k === 'assigned') && !(selfPickup && k === 'in_transit')).map(([k, l]) => ({ key: k, label: k === 'ready_for_pickup' && selfPickup ? 'Ready for you to collect' : l, done: Boolean(at[k]), at: at[k] || null }));
}

async function deliveryInfo(where, params, forBuyer) {
  const d = (await query(
    `SELECT d.id, d.status, d.created_at AS assigned_at, d.accepted_at, d.pickup_started_at, d.collected_at, d.in_transit_at, d.delivered_at, d.deadline, d.instructions,
            d.pickup_location, d.destination_address, u.full_name AS partner_name, u.phone AS partner_phone, u.avatar_url AS partner_avatar, u.fayda_verified AS partner_verified,
            tp.vehicle_type, tp.plate_number, tp.company_name,
            (SELECT json_build_object('latitude', l.latitude, 'longitude', l.longitude, 'recorded_at', l.recorded_at) FROM delivery_locations l WHERE l.delivery_id=d.id ORDER BY l.recorded_at DESC LIMIT 1) AS last_location,
            pr.buyer_confirmed_at
       FROM deliveries d JOIN users u ON u.id=d.transporter_id LEFT JOIN transporter_profiles tp ON tp.user_id=u.id LEFT JOIN delivery_proofs pr ON pr.delivery_id=d.id
      WHERE ${where} AND d.status<>'rejected' ORDER BY d.created_at DESC LIMIT 1`, params)).rows[0];
  if (!d) return null;
  if (forBuyer && ['accepted', 'heading_to_pickup', 'collected', 'in_transit'].includes(d.status)) d.confirmation_code = deliveryCode(d.id);
  return d;
}

export const getOrderDetail = asyncHandler(async (req, res) => {
  const po = (await query(
    `SELECT po.*, s.full_name AS seller_name, s.phone AS seller_phone, s.region AS seller_region FROM product_orders po JOIN users s ON s.id=po.seller_id WHERE po.id=$1 AND po.buyer_id=$2`,
    [req.params.id, req.user.id])).rows[0];
  if (po) {
    const [items, delivery, review] = await Promise.all([
      query('SELECT * FROM product_order_items WHERE product_order_id=$1 ORDER BY name', [po.id]),
      deliveryInfo('d.product_order_id=$1', [po.id], true),
      query('SELECT * FROM buyer_reviews WHERE product_order_id=$1', [po.id]),
    ]);
    const selfPickup = po.delivery_option === 'self_pickup';
    return res.json({
      kind: 'product', order: po, items: items.rows, delivery, review: review.rows[0] || null, timeline: await productTimeline(po, selfPickup),
      tracking_note: delivery?.last_location ? null : 'No live location is available. Status updates come from the delivery partner.',
    });
  }
  const order = await fetchOrder(req.user, req.params.id).catch(() => null);
  if (!order) throw notFound('Order not found');
  const delivery = await deliveryInfo('d.order_id=$1', [order.id], true);
  const review = (await query('SELECT * FROM buyer_reviews WHERE order_id=$1', [order.id])).rows[0] || null;
  const steps = [['Order placed', order.created_at], ['Payment held in escrow', order.payment_status === 'held' || order.payment_status === 'released' ? order.created_at : null],
    ['Delivery partner assigned', delivery?.assigned_at], ['In transit', delivery?.collected_at], ['Delivered', delivery?.delivered_at], ['Quality confirmed, payment released', order.status === 'completed' ? order.updated_at : null]];
  res.json({ kind: 'milk', order, delivery, review, link: `/orders/${order.id}`, timeline: steps.map(([label, at]) => ({ key: label, label, done: Boolean(at), at: at || null })) });
});

async function lockProductOrder(client, id, buyerId) {
  const po = (await client.query('SELECT * FROM product_orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE', [id, buyerId])).rows[0];
  if (!po) throw notFound('Order not found');
  return po;
}

export const payOrder = asyncHandler(async (req, res) => {
  const out = await withTransaction(async (client) => {
    const po = await lockProductOrder(client, req.params.id, req.user.id);
    if (po.status !== 'pending' || !['unpaid', 'failed', 'initiated'].includes(po.payment_status)) throw conflict('This order cannot be paid');
    const pay = initiatePayment({ orderId: po.id, amount: po.total_amount });
    await client.query(`UPDATE product_orders SET payment_status='initiated', payment_reference=$2, updated_at=now() WHERE id=$1`, [po.id, pay.reference]);
    return pay;
  });
  res.json({ payment: out, sandbox: isSandbox(), message: 'Sandbox mode: approve the payment to simulate Telebirr. No real money moves.' });
});

export const sandboxConfirm = asyncHandler(async (req, res) => {
  if (!isSandbox()) throw forbidden('Sandbox confirmation is disabled outside sandbox mode');
  await withTransaction(async (client) => {
    const po = await lockProductOrder(client, req.params.id, req.user.id);
    if (po.payment_status !== 'initiated' || po.status !== 'pending') throw conflict('No pending payment to confirm');
    if (req.body.outcome === 'fail') return client.query(`UPDATE product_orders SET payment_status='failed', updated_at=now() WHERE id=$1`, [po.id]);
    await client.query(`UPDATE product_orders SET payment_status='paid', updated_at=now() WHERE id=$1`, [po.id]);
    await logEvent(client, 'product', po.id, 'paid');
    await notify(client, po.buyer_id, 'payment', 'Payment successful', `Order ${po.tracking_number}: ETB ${po.total_amount} paid. The seller will confirm shortly.`, `/buyer/orders/product/${po.id}`);
    await notify(client, po.seller_id, 'order', 'Order paid', `Order ${po.tracking_number} is paid. Please confirm it.`, '/farmer/product-orders');
  });
  await audit(req.user.id, 'product_payment.sandbox', 'product_order', req.params.id, { outcome: req.body.outcome });
  res.json({ order: (await query('SELECT * FROM product_orders WHERE id=$1', [req.params.id])).rows[0] });
});

export const cancelOrder = asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const po = await lockProductOrder(client, req.params.id, req.user.id);
    if (!['pending', 'confirmed'].includes(po.status)) throw conflict('This order is already being prepared and can no longer be cancelled. Contact the seller.');
    const refund = po.payment_status === 'paid';
    await client.query(`UPDATE product_orders SET status='cancelled', payment_status=CASE WHEN payment_status='paid' THEN 'refunded' ELSE payment_status END, updated_at=now() WHERE id=$1`, [po.id]);
    await client.query(`UPDATE dairy_products p SET stock = p.stock + i.quantity FROM product_order_items i WHERE i.product_order_id=$1 AND i.product_id=p.id`, [po.id]);
    await logEvent(client, 'product', po.id, 'cancelled');
    await notify(client, po.seller_id, 'cancelled', 'Order cancelled', `Order ${po.tracking_number} was cancelled by the buyer.`, '/farmer/product-orders');
    await notify(client, po.buyer_id, 'cancelled', 'Order cancelled', refund ? `Order ${po.tracking_number} was cancelled. The sandbox payment is marked refunded.` : `Order ${po.tracking_number} was cancelled.`, `/buyer/orders/product/${po.id}`);
  });
  await audit(req.user.id, 'product_order.cancel', 'product_order', req.params.id);
  res.json({ order: (await query('SELECT * FROM product_orders WHERE id=$1', [req.params.id])).rows[0] });
});

/** Buyer confirms the delivered product order was received. */
export const confirmDelivery = asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const po = await lockProductOrder(client, req.params.id, req.user.id);
    if (po.status !== 'delivered') throw conflict('You can confirm receipt only after the order is marked delivered');
    if (po.buyer_confirmed_at) throw conflict('Receipt already confirmed');
    await client.query('UPDATE product_orders SET buyer_confirmed_at=now(), updated_at=now() WHERE id=$1', [po.id]);
    const d = (await client.query(`SELECT id, transporter_id FROM deliveries WHERE product_order_id=$1 AND status='delivered'`, [po.id])).rows[0];
    if (d) {
      await client.query('UPDATE delivery_proofs SET buyer_confirmed_at=now() WHERE delivery_id=$1', [d.id]);
      await notify(client, d.transporter_id, 'buyer_confirmed', 'Buyer confirmed delivery', `Order ${po.tracking_number} was confirmed received.`, '/delivery/assignments');
    }
    await notify(client, po.seller_id, 'order', 'Buyer confirmed receipt', `Order ${po.tracking_number} was received.`, '/farmer/product-orders');
  });
  res.json({ order: (await query('SELECT * FROM product_orders WHERE id=$1', [req.params.id])).rows[0] });
});

export const receipt = asyncHandler(async (req, res) => {
  const po = (await query(
    `SELECT po.*, s.full_name AS seller_name, s.phone AS seller_phone, b.full_name AS buyer_name, b.email AS buyer_email
       FROM product_orders po JOIN users s ON s.id=po.seller_id JOIN users b ON b.id=po.buyer_id WHERE po.id=$1 AND po.buyer_id=$2`, [req.params.id, req.user.id])).rows[0];
  if (po) {
    if (po.payment_status !== 'paid' && po.payment_status !== 'refunded') throw conflict('A receipt is available once the order is paid');
    const items = (await query('SELECT name, unit, unit_price, quantity, round(unit_price*quantity,2) AS line_total FROM product_order_items WHERE product_order_id=$1', [po.id])).rows;
    return res.json({ receipt: { number: po.tracking_number, issued_at: new Date().toISOString(), buyer: { name: po.buyer_name, email: po.buyer_email }, seller: { name: po.seller_name, phone: po.seller_phone }, items,
      total: po.total_amount, currency: 'ETB', payment: { method: 'Telebirr (sandbox)', reference: po.payment_reference, status: po.payment_status }, status: po.status, delivery_address: po.delivery_address, note: 'Sandbox payment: no real money moved.' } });
  }
  const o = (await query(
    `SELECT o.*, f.full_name AS seller_name, f.phone AS seller_phone, b.full_name AS buyer_name, b.email AS buyer_email,
            (SELECT reference FROM payments WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) AS ref, (SELECT status FROM payments WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) AS pstatus
       FROM orders o JOIN users f ON f.id=o.farmer_id JOIN users b ON b.id=o.buyer_id WHERE o.id=$1 AND o.buyer_id=$2`, [req.params.id, req.user.id])).rows[0];
  if (!o) throw notFound('Order not found');
  if (!['held', 'released', 'refunded'].includes(o.pstatus)) throw conflict('A receipt is available once the order is paid');
  res.json({ receipt: { number: milkRef(o.id), issued_at: new Date().toISOString(), buyer: { name: o.buyer_name, email: o.buyer_email }, seller: { name: o.seller_name, phone: o.seller_phone },
    items: [{ name: `Raw milk, Grade ${o.agreed_grade}`, unit: 'litre', unit_price: o.unit_price, quantity: o.volume_litres, line_total: o.total_amount }], total: o.total_amount, currency: 'ETB',
    payment: { method: 'Telebirr (sandbox)', reference: o.ref, status: o.pstatus }, status: o.status, delivery_address: o.delivery_address, note: 'Sandbox payment: no real money moved.' } });
});

// ---------- Reviews ----------
export const createReview = asyncHandler(async (req, res) => {
  const { order_kind, order_id, product_rating, delivery_rating, review } = req.body;
  const out = await withTransaction(async (client) => {
    let sellerId; let hasDelivery;
    if (order_kind === 'product') {
      const po = (await client.query('SELECT * FROM product_orders WHERE id=$1 AND buyer_id=$2', [order_id, req.user.id])).rows[0];
      if (!po) throw notFound('Order not found');
      if (po.status !== 'delivered') throw conflict('You can review an order after it is delivered');
      sellerId = po.seller_id; hasDelivery = po.delivery_option === 'delivery';
    } else {
      const o = (await client.query('SELECT * FROM orders WHERE id=$1 AND buyer_id=$2', [order_id, req.user.id])).rows[0];
      if (!o) throw notFound('Order not found');
      if (!['delivered', 'completed'].includes(o.status)) throw conflict('You can review an order after it is delivered');
      sellerId = o.farmer_id; hasDelivery = true;
    }
    if (delivery_rating && !hasDelivery) throw badRequest('This order had no delivery to rate');
    try {
      const col = order_kind === 'product' ? 'product_order_id' : 'order_id';
      return (await client.query(
        `INSERT INTO buyer_reviews(buyer_id, seller_id, ${col}, product_rating, delivery_rating, review) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.user.id, sellerId, order_id, product_rating, delivery_rating ?? null, review ?? null])).rows[0];
    } catch (e) {
      if (e.code === '23505') throw conflict('You already reviewed this order');
      throw e;
    }
  });
  res.status(201).json({ review: out });
});

// ---------- Dashboard ----------
export const dashboard = asyncHandler(async (req, res) => {
  const id = req.user.id;
  const [sum, fav, recent, monthly] = await Promise.all([
    query(`WITH a AS (
             SELECT po.status IN ('delivered') AS done, po.status NOT IN ('delivered','cancelled') AS active, po.status IN ('confirmed','processing','ready_for_pickup','assigned','in_transit') AND po.delivery_option='delivery' AS pending_delivery,
                    (po.payment_status='paid' AND po.status<>'cancelled') AS spent, po.total_amount AS amount, po.status<>'cancelled' AS counted FROM product_orders po WHERE po.buyer_id=$1
             UNION ALL
             SELECT o.status IN ('completed','delivered'), o.status IN ('pending_payment','paid','in_transit','disputed'), o.status IN ('paid','in_transit'),
                    o.status IN ('paid','in_transit','delivered','completed','disputed'), o.total_amount, o.status NOT IN ('cancelled','refunded') FROM orders o WHERE o.buyer_id=$1)
           SELECT count(*) FILTER (WHERE counted)::int AS total_purchases, count(*) FILTER (WHERE active)::int AS active_orders, count(*) FILTER (WHERE done)::int AS completed_orders,
                  count(*) FILTER (WHERE pending_delivery)::int AS pending_deliveries, COALESCE(sum(amount) FILTER (WHERE spent),0) AS total_spending FROM a`, [id]),
    query(`SELECT seller_id, name, count(*)::int AS orders, sum(amount) AS spent FROM (
             SELECT po.seller_id, s.full_name AS name, po.total_amount AS amount FROM product_orders po JOIN users s ON s.id=po.seller_id WHERE po.buyer_id=$1 AND po.status<>'cancelled'
             UNION ALL SELECT o.farmer_id, f.full_name, o.total_amount FROM orders o JOIN users f ON f.id=o.farmer_id WHERE o.buyer_id=$1 AND o.status NOT IN ('cancelled','refunded')) x
           GROUP BY seller_id, name ORDER BY orders DESC, spent DESC LIMIT 5`, [id]),
    query(`SELECT * FROM (
             SELECT i.name, i.quantity, i.unit, i.unit_price, po.created_at, s.full_name AS seller_name FROM product_order_items i JOIN product_orders po ON po.id=i.product_order_id JOIN users s ON s.id=po.seller_id WHERE po.buyer_id=$1 AND po.status<>'cancelled'
             UNION ALL SELECT 'Raw milk (Grade ' || o.agreed_grade || ')', o.volume_litres, 'litre', o.unit_price, o.created_at, f.full_name FROM orders o JOIN users f ON f.id=o.farmer_id WHERE o.buyer_id=$1 AND o.status NOT IN ('cancelled','refunded')) x
           ORDER BY created_at DESC LIMIT 8`, [id]),
    query(`SELECT to_char(m,'Mon') AS month, COALESCE(sum(amt),0) AS amount FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), '1 month') m
             LEFT JOIN (SELECT created_at, total_amount AS amt FROM product_orders WHERE buyer_id=$1 AND payment_status='paid' AND status<>'cancelled'
                        UNION ALL SELECT created_at, total_amount FROM orders WHERE buyer_id=$1 AND status IN ('paid','in_transit','delivered','completed','disputed')) t ON date_trunc('month', t.created_at)=m GROUP BY m ORDER BY m`, [id]),
  ]);
  res.json({ summary: sum.rows[0], favorite_suppliers: fav.rows, recent_products: recent.rows, monthly_spending: monthly.rows });
});

// ---------- Seller (farmer) side of product orders ----------
export const sellerOrders = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT po.*, b.full_name AS buyer_name, b.phone AS buyer_phone,
            (SELECT json_agg(json_build_object('name', i.name, 'quantity', i.quantity, 'unit', i.unit, 'unit_price', i.unit_price)) FROM product_order_items i WHERE i.product_order_id=po.id) AS items,
            (SELECT status FROM deliveries WHERE product_order_id=po.id AND status<>'rejected' LIMIT 1) AS delivery_status
       FROM product_orders po JOIN users b ON b.id=po.buyer_id WHERE po.seller_id=$1 ORDER BY po.created_at DESC LIMIT 200`, [req.user.id]);
  res.json({ orders: rows });
});

const SELLER_NEXT = { pending: ['confirmed'], confirmed: ['processing'], processing: ['ready_for_pickup'], ready_for_pickup: ['delivered'] };

export const sellerSetStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const out = await withTransaction(async (client) => {
    const po = (await client.query('SELECT * FROM product_orders WHERE id=$1 AND seller_id=$2 FOR UPDATE', [req.params.id, req.user.id])).rows[0];
    if (!po) throw notFound('Order not found');
    if (!(SELLER_NEXT[po.status] || []).includes(status)) throw conflict(`Cannot move an order from ${po.status.replaceAll('_', ' ')} to ${status.replaceAll('_', ' ')}`);
    if (status === 'confirmed' && po.payment_status !== 'paid') throw conflict('Wait for the buyer to pay before confirming');
    if (status === 'delivered' && po.delivery_option !== 'self_pickup') throw conflict('Delivery orders are completed by the delivery partner');
    await client.query('UPDATE product_orders SET status=$2, updated_at=now() WHERE id=$1', [po.id, status]);
    await logEvent(client, 'product', po.id, status);
    const link = `/buyer/orders/product/${po.id}`;
    const msg = { confirmed: ['Order confirmed', 'The seller confirmed your order.'], processing: ['Order is being prepared', 'The seller is preparing your order.'],
      ready_for_pickup: ['Order ready', po.delivery_option === 'self_pickup' ? 'Your order is ready to collect.' : 'Your order is ready. A delivery partner will be assigned.'], delivered: ['Order handed over', 'Your order was handed over at pickup.'] }[status];
    await notify(client, po.buyer_id, 'order_status', msg[0], `Order ${po.tracking_number}: ${msg[1]}`, link);
    let delivery = null;
    if (status === 'ready_for_pickup' && po.delivery_option === 'delivery') {
      delivery = await autoAssignProductDelivery(client, po.id);
    }
    return { delivery, awaiting_assignment: status === 'ready_for_pickup' && po.delivery_option === 'delivery' && !delivery };
  });
  await audit(req.user.id, `product_order.${status}`, 'product_order', req.params.id);
  res.json({ order: (await query('SELECT * FROM product_orders WHERE id=$1', [req.params.id])).rows[0], delivery: out.delivery, awaiting_assignment: out.awaiting_assignment });
});
