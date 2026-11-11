import { query, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound, badRequest, conflict, forbidden } from '../utils/AppError.js';
import { round } from '../utils/num.js';
import { getSettings } from '../services/settings.service.js';
import { assess } from '../services/milkQuality.service.js';
import { initiatePayment, isSandbox } from '../services/telebirr.service.js';
import { autoAssignTransporter, releaseEscrow, refundEscrow, GRADE_RANK } from '../services/order.service.js';
import { audit } from '../utils/audit.js';
import { createDelivery, deliveryCode, ACTIVE_DELIVERY } from '../services/delivery.service.js';
import { notify } from '../services/notify.service.js';

const ORDER_SELECT = `
  SELECT o.*, b.collection_location, b.grade AS batch_grade,
         bu.full_name AS buyer_name, fu.full_name AS farmer_name, fu.phone AS farmer_phone, bu.phone AS buyer_phone,
         p.id AS payment_id, p.status AS payment_status, p.reference AS payment_reference,
         d.id AS delivery_id, d.status AS delivery_status, d.transporter_id, tu.full_name AS transporter_name,
         (SELECT status FROM disputes WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) AS dispute_status
    FROM orders o
    JOIN milk_batches b ON b.id=o.batch_id
    JOIN users bu ON bu.id=o.buyer_id
    JOIN users fu ON fu.id=o.farmer_id
    LEFT JOIN LATERAL (SELECT * FROM payments WHERE order_id=o.id ORDER BY created_at DESC LIMIT 1) p ON TRUE
    LEFT JOIN LATERAL (SELECT * FROM deliveries WHERE order_id=o.id ORDER BY (status<>'rejected') DESC, created_at DESC LIMIT 1) d ON TRUE
    LEFT JOIN users tu ON tu.id=d.transporter_id`;

function scope(user, params) {
  params.push(user.id);
  const n = params.length;
  switch (user.role) {
    case 'buyer': return `o.buyer_id=$${n}`;
    case 'farmer': return `o.farmer_id=$${n}`;
    case 'transporter': return `EXISTS (SELECT 1 FROM deliveries dx WHERE dx.order_id=o.id AND dx.transporter_id=$${n})`;
    case 'admin': params.pop(); return 'TRUE';
    default: params.pop(); return 'FALSE';
  }
}

export async function fetchOrder(user, id, client = { query }) {
  const params = [id];
  const sc = scope(user, params);
  const { rows } = await client.query(`${ORDER_SELECT} WHERE o.id=$1 AND ${sc}`, params);
  if (!rows[0]) throw notFound('Order not found');
  const o = rows[0];
  if (user.role === 'buyer' && o.delivery_id && ACTIVE_DELIVERY.includes(o.delivery_status) && o.delivery_status !== 'requested') o.delivery_code = deliveryCode(o.delivery_id);
  return o;
}

export const listOrders = asyncHandler(async (req, res) => {
  const params = [];
  const sc = scope(req.user, params);
  const where = [sc];
  if (req.query.status) { params.push(req.query.status); where.push(`o.status=$${params.length}`); }
  const { rows } = await query(`${ORDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 200`, params);
  res.json({ orders: rows });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await fetchOrder(req.user, req.params.id);
  const [tests, payments, deliveries, disputes] = await Promise.all([
    query('SELECT * FROM milk_tests WHERE (order_id=$1) OR (batch_id=$2 AND test_type=\'producer\') ORDER BY created_at', [order.id, order.batch_id]),
    query('SELECT * FROM payments WHERE order_id=$1 ORDER BY created_at', [order.id]),
    query(`SELECT d.*, u.full_name AS transporter_name FROM deliveries d JOIN users u ON u.id=d.transporter_id WHERE d.order_id=$1 ORDER BY d.created_at`, [order.id]),
    query('SELECT * FROM disputes WHERE order_id=$1 ORDER BY created_at', [order.id]),
  ]);
  res.json({ order, tests: tests.rows, payments: payments.rows, deliveries: deliveries.rows, disputes: disputes.rows });
});

export const createOrder = asyncHandler(async (req, res) => {
  const { batch_id, volume_litres, delivery_address } = req.body;
  const order = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM milk_batches WHERE id=$1 FOR UPDATE', [batch_id]);
    const b = rows[0];
    if (!b || b.status !== 'listed') throw notFound('This milk batch is not available');
    if (b.farmer_id === req.user.id) throw badRequest('You cannot buy your own milk');
    if (volume_litres > b.remaining_litres) throw conflict(`Only ${b.remaining_litres} litres are still available`);
    const unit = b.asking_price ?? b.recommended_price;
    const remaining = round(b.remaining_litres - volume_litres, 2);
    await client.query(`UPDATE milk_batches SET remaining_litres=$2, status=$3 WHERE id=$1`, [b.id, remaining, remaining === 0 ? 'sold_out' : 'listed']);
    const ins = await client.query(
      `INSERT INTO orders(batch_id, buyer_id, farmer_id, volume_litres, unit_price, total_amount, agreed_grade, delivery_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.id, req.user.id, b.farmer_id, volume_litres, unit, round(unit * volume_litres, 2), b.grade, delivery_address]);
    return ins.rows[0];
  });
  await audit(req.user.id, 'order.create', 'order', order.id, { total: order.total_amount });
  res.status(201).json({ order });
});

export const cancelOrder = asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
    const o = rows[0];
    if (!o) throw notFound('Order not found');
    if (o.status !== 'pending_payment') throw conflict('Only unpaid orders can be cancelled');
    await client.query(`UPDATE orders SET status='cancelled', updated_at=now() WHERE id=$1`, [o.id]);
    await client.query(`UPDATE payments SET status='failed', updated_at=now() WHERE order_id=$1 AND status='initiated'`, [o.id]);
    await client.query(
      `UPDATE milk_batches SET remaining_litres = remaining_litres + $2,
         status = CASE WHEN status='sold_out' THEN 'listed' ELSE status END WHERE id=$1`, [o.batch_id, o.volume_litres]);
  });
  res.json({ order: await fetchOrder(req.user, req.params.id) });
});

export const payOrder = asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
    const o = rows[0];
    if (!o) throw notFound('Order not found');
    if (o.status !== 'pending_payment') throw conflict('This order is not waiting for payment');
    const pay = initiatePayment({ orderId: o.id, amount: o.total_amount });
    await client.query(`UPDATE payments SET status='failed', updated_at=now() WHERE order_id=$1 AND status='initiated'`, [o.id]);
    await client.query(`INSERT INTO payments(order_id, provider, mode, reference, amount) VALUES ($1,$2,$3,$4,$5)`,
      [o.id, pay.provider, pay.mode, pay.reference, pay.amount]);
  });
  const order = await fetchOrder(req.user, req.params.id);
  res.status(201).json({
    order, payment_reference: order.payment_reference, sandbox: isSandbox(),
    message: isSandbox() ? 'Sandbox mode: approve this payment with the sandbox confirmation to simulate Telebirr.' : 'Complete the payment in Telebirr.',
  });
});

/** Sandbox stand-in for Telebirr's server-to-server payment notification. Disabled outside sandbox mode. */
export const sandboxConfirmPayment = asyncHandler(async (req, res) => {
  if (!isSandbox()) throw forbidden('Sandbox confirmation is disabled outside sandbox mode');
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
    const o = rows[0];
    if (!o) throw notFound('Order not found');
    const pay = await client.query(`SELECT * FROM payments WHERE order_id=$1 AND status='initiated' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [o.id]);
    if (!pay.rows[0] || o.status !== 'pending_payment') throw conflict('No pending payment to confirm');
    if (req.body.outcome === 'fail') {
      await client.query(`UPDATE payments SET status='failed', updated_at=now() WHERE id=$1`, [pay.rows[0].id]);
      return;
    }
    await client.query(`UPDATE payments SET status='held', updated_at=now() WHERE id=$1`, [pay.rows[0].id]);
    await client.query(`UPDATE orders SET status='paid', updated_at=now() WHERE id=$1`, [o.id]);
    await notify(client, o.buyer_id, 'payment', 'Payment successful', `ETB ${o.total_amount} is held in escrow until you confirm the milk quality.`, `/orders/${o.id}`);
    await notify(client, o.farmer_id, 'order', 'New paid order', `${o.volume_litres} L ordered and paid. Payment is held in escrow.`, `/orders/${o.id}`);
  });
  await audit(req.user.id, 'payment.sandbox_confirm', 'order', req.params.id, { outcome: req.body.outcome });
  res.json({ order: await fetchOrder(req.user, req.params.id) });
});

export const requestDelivery = asyncHandler(async (req, res) => {
  const delivery = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]);
    const o = rows[0];
    if (!o || (req.user.role === 'buyer' && o.buyer_id !== req.user.id)) throw notFound('Order not found');
    if (o.status !== 'paid') throw conflict('Delivery can only be requested for a paid order');
    const active = await client.query(`SELECT 1 FROM deliveries WHERE order_id=$1 AND status<>'rejected'`, [o.id]);
    if (active.rowCount) throw conflict('A delivery is already assigned to this order');
    if (req.body.transporter_id) {
      const t = await client.query(
        `SELECT tp.capacity_litres FROM transporter_profiles tp JOIN users u ON u.id=tp.user_id WHERE tp.user_id=$1 AND u.is_active AND tp.availability_status='available'`, [req.body.transporter_id]);
      if (!t.rows[0]) throw badRequest('That transporter is not available');
      if (t.rows[0].capacity_litres && t.rows[0].capacity_litres < o.volume_litres) throw badRequest('That transporter vehicle is too small for this volume');
      return createDelivery(client, { orderId: o.id, transporterId: req.body.transporter_id, note: req.body.pickup_note ?? null });
    }
    const auto = await autoAssignTransporter(client, o, req.body.pickup_note ?? null);
    if (!auto) throw conflict('No available transporter can take this load right now');
    return auto;
  });
  await audit(req.user.id, 'delivery.request', 'order', req.params.id, { transporter: delivery.transporter_id });
  res.status(201).json({ delivery });
});

/** Buyer records a quality check on received milk. Matching grade releases escrow; a mismatch opens the dispute path. */
export const confirmReceipt = asyncHandler(async (req, res) => {
  const t = req.body;
  const settings = await getSettings();
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
    const o = rows[0];
    if (!o) throw notFound('Order not found');
    if (o.status !== 'delivered') throw conflict('You can confirm quality only after the milk is marked as delivered');
    const a = assess({ lactometer: t.lactometer_reading, temperature: t.temperature_c, fat: t.fat_percent, conductivity: t.conductivity_ms, imageBrightness: t.image_brightness }, settings);
    const listing = await client.query(
      `SELECT estimated_water_percent FROM milk_tests WHERE batch_id=$1 AND test_type='producer' ORDER BY created_at DESC LIMIT 1`, [o.batch_id]);
    const listedWater = listing.rows[0]?.estimated_water_percent ?? 0;
    const matches = GRADE_RANK[a.grade] <= GRADE_RANK[o.agreed_grade] || a.estimated_water_percent - listedWater <= settings.delivery_tolerance_points;
    const ins = await client.query(
      `INSERT INTO milk_tests(batch_id, order_id, tested_by, test_type, lactometer_reading, temperature_c, fat_percent, conductivity_ms, image_brightness,
         corrected_reading, estimated_water_percent, estimate_low, estimate_high, snf_estimated, confidence, method, flags, grade, recommended_price, notes)
       VALUES ($1,$2,$3,'delivery',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [o.batch_id, o.id, req.user.id, t.lactometer_reading, t.temperature_c, t.fat_percent ?? null, t.conductivity_ms ?? null, t.image_brightness ?? null,
       a.corrected_reading, a.estimated_water_percent, a.estimate_low, a.estimate_high, a.snf_estimated, a.confidence, a.method, JSON.stringify(a.flags), a.grade, a.recommended_price, t.notes ?? null]);
    let released = false;
    if (matches || t.accept_anyway) {
      await releaseEscrow(client, o);
      released = true;
    }
    return { test: ins.rows[0], matches, released, listed_water_percent: listedWater };
  });
  await audit(req.user.id, 'order.confirm_receipt', 'order', req.params.id, { matches: result.matches, released: result.released });
  res.json({
    ...result,
    order: await fetchOrder(req.user, req.params.id),
    message: result.released
      ? 'Quality confirmed. Payment released to the farmer.'
      : 'Delivered quality is below the agreed grade. Open a dispute so an administrator can review.',
  });
});

export const raiseDispute = asyncHandler(async (req, res) => {
  const dispute = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 AND buyer_id=$2 FOR UPDATE', [req.params.id, req.user.id]);
    const o = rows[0];
    if (!o) throw notFound('Order not found');
    if (o.status !== 'delivered') throw conflict('A dispute can be opened only for delivered orders awaiting confirmation');
    const ins = await client.query(`INSERT INTO disputes(order_id, raised_by, reason, evidence_url) VALUES ($1,$2,$3,$4) RETURNING *`,
      [o.id, req.user.id, req.body.reason, req.body.evidence_url ?? null]);
    await client.query(`UPDATE orders SET status='disputed', updated_at=now() WHERE id=$1`, [o.id]);
    return ins.rows[0];
  });
  await audit(req.user.id, 'dispute.open', 'dispute', dispute.id, { order: req.params.id });
  res.status(201).json({ dispute });
});

export const listDisputes = asyncHandler(async (req, res) => {
  const status = req.query.status;
  const { rows } = await query(
    `SELECT d.*, o.total_amount, o.agreed_grade, o.volume_litres, bu.full_name AS buyer_name, fu.full_name AS farmer_name,
            (SELECT row_to_json(x) FROM (SELECT grade, estimated_water_percent, estimate_low, estimate_high FROM milk_tests WHERE order_id=o.id AND test_type='delivery' ORDER BY created_at DESC LIMIT 1) x) AS delivery_check,
            (SELECT row_to_json(x) FROM (SELECT grade, estimated_water_percent FROM milk_tests WHERE batch_id=o.batch_id AND test_type='producer' ORDER BY created_at DESC LIMIT 1) x) AS listing_check
       FROM disputes d JOIN orders o ON o.id=d.order_id JOIN users bu ON bu.id=o.buyer_id JOIN users fu ON fu.id=o.farmer_id
      WHERE ($1::text IS NULL OR d.status=$1) ORDER BY d.created_at DESC LIMIT 200`, [status ?? null]);
  res.json({ disputes: rows });
});

export const resolveDispute = asyncHandler(async (req, res) => {
  const { decision, note } = req.body;
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [req.params.id]);
    const d = rows[0];
    if (!d) throw notFound('Dispute not found');
    if (d.status !== 'open') throw conflict('This dispute is already resolved');
    const o = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [d.order_id])).rows[0];
    if (decision === 'refund_buyer') await refundEscrow(client, o);
    else await releaseEscrow(client, o);
    await client.query(`UPDATE disputes SET status=$2, resolution_note=$3, resolved_by=$4, resolved_at=now() WHERE id=$1`, [d.id, decision, note, req.user.id]);
  });
  await audit(req.user.id, 'dispute.resolve', 'dispute', req.params.id, { decision });
  const { rows } = await query('SELECT * FROM disputes WHERE id=$1', [req.params.id]);
  res.json({ dispute: rows[0] });
});
