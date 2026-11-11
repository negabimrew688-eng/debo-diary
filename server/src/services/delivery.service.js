import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getSettings } from './settings.service.js';
import { notify } from './notify.service.js';
import { conflict } from '../utils/AppError.js';

/** Confirmation code the buyer shows the delivery partner. Derived (HMAC) so it can be re-shown to the buyer; only a hash is stored. */
export function deliveryCode(deliveryId) {
  const h = crypto.createHmac('sha256', env.jwtSecret).update(`delivery-otp:${deliveryId}`).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}
export const hashCode = (deliveryId, code) => crypto.createHmac('sha256', env.jwtSecret).update(`code-hash:${deliveryId}:${code}`).digest('hex');
export function codeMatches(deliveryId, code, storedHash) {
  const a = Buffer.from(hashCode(deliveryId, code));
  const b = Buffer.from(storedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const logEvent = (client, kind, id, status) =>
  client.query('INSERT INTO order_events(order_kind, order_id, status) VALUES ($1,$2,$3)', [kind, id, status]);

export const ACTIVE_DELIVERY = ['requested', 'accepted', 'heading_to_pickup', 'collected', 'in_transit'];

/** The buyer, order reference and link for either kind of order. */
export async function orderContext(client, { orderId, productOrderId }) {
  if (productOrderId) {
    const { rows } = await client.query(
      `SELECT po.id, po.buyer_id, po.seller_id, po.tracking_number AS ref, po.delivery_address AS destination, po.pickup_location AS pickup, s.region AS seller_region
         FROM product_orders po JOIN users s ON s.id=po.seller_id WHERE po.id=$1`, [productOrderId]);
    return rows[0] && { ...rows[0], kind: 'product', link: `/buyer/orders/product/${rows[0].id}` };
  }
  const { rows } = await client.query(
    `SELECT o.id, o.buyer_id, o.farmer_id AS seller_id, upper(substr(replace(o.id::text,'-',''),1,10)) AS ref, o.delivery_address AS destination,
            b.collection_location AS pickup, f.region AS seller_region
       FROM orders o JOIN milk_batches b ON b.id=o.batch_id JOIN users f ON f.id=o.farmer_id WHERE o.id=$1`, [orderId]);
  return rows[0] && { ...rows[0], kind: 'milk', link: `/orders/${rows[0].id}` };
}

/** Create a delivery assignment (with confirmation-code proof row) and notify the partner and the buyer. */
export async function createDelivery(client, { orderId = null, productOrderId = null, transporterId, note = null, instructions = null }) {
  const ctx = await orderContext(client, { orderId, productOrderId });
  const fee = (await getSettings()).delivery_fee_etb ?? 0;
  const ins = await client.query(
    `INSERT INTO deliveries(order_id, product_order_id, transporter_id, pickup_note, pickup_location, destination_address, delivery_fee, instructions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [orderId, productOrderId, transporterId, note, ctx.pickup, ctx.destination, fee, instructions]);
  const d = ins.rows[0];
  await client.query('INSERT INTO delivery_proofs(delivery_id, confirmation_code_hash) VALUES ($1,$2)', [d.id, hashCode(d.id, deliveryCode(d.id))]);
  if (productOrderId) {
    const u = await client.query(`UPDATE product_orders SET status='assigned', updated_at=now() WHERE id=$1 AND status='ready_for_pickup'`, [productOrderId]);
    if (u.rowCount) await logEvent(client, 'product', productOrderId, 'assigned');
  }
  await notify(client, transporterId, 'delivery_assigned', 'New delivery assigned', `Order ${ctx.ref}: pick up at ${ctx.pickup || 'the seller'}, deliver to ${ctx.destination || 'the buyer'}.`, '/delivery/assignments');
  await notify(client, ctx.buyer_id, 'delivery_assigned', 'A delivery partner was assigned', `Order ${ctx.ref} has a delivery partner.`, ctx.link);
  return d;
}

/** Best available partner for a product order: active, Available, not one who already rejected it; prefers the seller's region then lightest load. */
export async function autoAssignProductDelivery(client, productOrderId, instructions = null) {
  const ctx = await orderContext(client, { productOrderId });
  const { rows } = await client.query(
    `SELECT u.id FROM users u JOIN transporter_profiles tp ON tp.user_id=u.id
      WHERE u.is_active AND tp.availability_status='available'
        AND u.id NOT IN (SELECT transporter_id FROM deliveries WHERE product_order_id=$1 AND status='rejected')
      ORDER BY (tp.service_area ILIKE '%' || COALESCE($2,'') || '%' AND $2 IS NOT NULL) DESC,
               (SELECT count(*) FROM deliveries x WHERE x.transporter_id=u.id AND x.status = ANY($3)) ASC, u.created_at ASC
      LIMIT 1`, [productOrderId, ctx.seller_region, ACTIVE_DELIVERY]);
  if (!rows[0]) return null;
  return createDelivery(client, { productOrderId, transporterId: rows[0].id, instructions });
}

/** Reflect a delivery event on the linked order and notify the buyer. */
export async function syncOrderOnDelivery(client, d, event) {
  const ctx = await orderContext(client, { orderId: d.order_id, productOrderId: d.product_order_id });
  if (event === 'collected') {
    if (d.product_order_id) {
      const u = await client.query(`UPDATE product_orders SET status='in_transit', updated_at=now() WHERE id=$1 AND status IN ('assigned','ready_for_pickup')`, [d.product_order_id]);
      if (u.rowCount) await logEvent(client, 'product', d.product_order_id, 'in_transit');
    }
    else await client.query(`UPDATE orders SET status='in_transit', updated_at=now() WHERE id=$1 AND status IN ('paid','in_transit')`, [d.order_id]);
    await notify(client, ctx.buyer_id, 'in_transit', 'Your order is on the way', `Order ${ctx.ref} was picked up. Keep your confirmation code ready.`, ctx.link);
  }
  if (event === 'delivered') {
    if (d.product_order_id) {
      const u = await client.query(`UPDATE product_orders SET status='delivered', updated_at=now() WHERE id=$1 AND status='in_transit'`, [d.product_order_id]);
      if (u.rowCount) await logEvent(client, 'product', d.product_order_id, 'delivered');
    }
    else await client.query(`UPDATE orders SET status='delivered', updated_at=now() WHERE id=$1 AND status IN ('paid','in_transit')`, [d.order_id]);
    await notify(client, ctx.buyer_id, 'delivered', 'Your order was delivered', `Order ${ctx.ref} was delivered. Please confirm receipt.`, ctx.link);
    await client.query(
      `INSERT INTO delivery_earnings(delivery_id, partner_id, amount) VALUES ($1,$2,$3) ON CONFLICT (delivery_id) DO NOTHING`, [d.id, d.transporter_id, d.delivery_fee]);
    await notify(client, d.transporter_id, 'earnings', 'Earnings recorded', `ETB ${d.delivery_fee} for order ${ctx.ref} (payout pending).`, '/delivery/earnings');
  }
  return ctx;
}

export function assertTransition(d, to) {
  const NEXT = { accepted: ['heading_to_pickup', 'collected'], heading_to_pickup: ['collected'], collected: ['in_transit'], in_transit: ['delivered'] };
  if (!(NEXT[d.status] || []).includes(to)) throw conflict(`Cannot move a delivery from ${d.status.replaceAll('_', ' ')} to ${to.replaceAll('_', ' ')}`);
}
