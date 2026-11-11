import { query, withTransaction } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notFound, conflict, badRequest, AppError } from '../utils/AppError.js';
import { audit } from '../utils/audit.js';
import { notify } from '../services/notify.service.js';
import { autoAssignTransporter } from '../services/order.service.js';
import { autoAssignProductDelivery, assertTransition, codeMatches, syncOrderOnDelivery, orderContext, ACTIVE_DELIVERY } from '../services/delivery.service.js';

const LIST_SELECT = `
  SELECT d.id, d.status, d.created_at AS assigned_at, d.deadline, d.delivery_fee, d.pickup_location, d.destination_address, d.instructions,
         d.accepted_at, d.collected_at, d.delivered_at,
         CASE WHEN d.product_order_id IS NOT NULL THEN 'product' ELSE 'milk' END AS kind,
         COALESCE(po.tracking_number, upper(substr(replace(d.order_id::text,'-',''),1,10))) AS order_ref,
         bu.full_name AS buyer_name`;
const FROM = `
    FROM deliveries d
    LEFT JOIN product_orders po ON po.id=d.product_order_id
    LEFT JOIN orders o ON o.id=d.order_id
    JOIN users bu ON bu.id=COALESCE(po.buyer_id, o.buyer_id)`;

export const listAssignments = asyncHandler(async (req, res) => {
  const where = ['d.transporter_id=$1'];
  const params = [req.user.id];
  if (req.query.status) { params.push(req.query.status); where.push(`d.status=$${params.length}`); }
  const { rows } = await query(`${LIST_SELECT}${FROM} WHERE ${where.join(' AND ')} ORDER BY (d.status = ANY($${params.length + 1})) DESC, d.created_at DESC LIMIT 200`, [...params, ACTIVE_DELIVERY]);
  res.json({ assignments: rows });
});

/** One assignment. Customer details are shown only while the delivery is active (data minimisation). */
export const getAssignment = asyncHandler(async (req, res) => {
  const d = (await query(`${LIST_SELECT}, d.order_id, d.product_order_id, d.transporter_id, d.pickup_started_at, d.in_transit_at, d.pickup_note,
       bu.phone AS buyer_phone_full, s.full_name AS seller_name, s.phone AS seller_phone, pr.delivery_notes, pr.delivery_photo, pr.delivered_at AS proof_at, pr.buyer_confirmed_at,
       (SELECT json_build_object('latitude', l.latitude, 'longitude', l.longitude, 'recorded_at', l.recorded_at) FROM delivery_locations l WHERE l.delivery_id=d.id ORDER BY l.recorded_at DESC LIMIT 1) AS last_location
     ${FROM} JOIN users s ON s.id=COALESCE(po.seller_id, o.farmer_id) LEFT JOIN delivery_proofs pr ON pr.delivery_id=d.id
     WHERE d.id=$1 AND d.transporter_id=$2`, [req.params.id, req.user.id])).rows[0];
  if (!d) throw notFound('Assignment not found');
  const active = ACTIVE_DELIVERY.includes(d.status);
  const items = d.product_order_id
    ? (await query('SELECT name, quantity, unit FROM product_order_items WHERE product_order_id=$1', [d.product_order_id])).rows
    : (await query(`SELECT 'Raw milk (Grade ' || o.agreed_grade || ')' AS name, o.volume_litres AS quantity, 'litre' AS unit FROM orders o WHERE o.id=$1`, [d.order_id])).rows;
  const { buyer_phone_full, seller_phone, ...rest } = d;
  res.json({ assignment: { ...rest, buyer_phone: active && d.status !== 'requested' ? buyer_phone_full : null, seller_phone: d.status !== 'requested' ? seller_phone : null, items } });
});

async function lockMine(client, id, userId) {
  const d = (await client.query('SELECT * FROM deliveries WHERE id=$1 AND transporter_id=$2 FOR UPDATE', [id, userId])).rows[0];
  if (!d) throw notFound('Assignment not found');
  return d;
}
const reload = async (id) => (await query('SELECT * FROM deliveries WHERE id=$1', [id])).rows[0];

export const accept = asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const d = await lockMine(client, req.params.id, req.user.id);
    if (d.status !== 'requested') throw conflict('This request has already been answered');
    await client.query(`UPDATE deliveries SET status='accepted', accepted_at=now(), updated_at=now() WHERE id=$1`, [d.id]);
    const ctx = await orderContext(client, { orderId: d.order_id, productOrderId: d.product_order_id });
    await notify(client, ctx.buyer_id, 'delivery_accepted', 'Your delivery partner accepted', `Order ${ctx.ref} will be collected soon.`, ctx.link);
  });
  await audit(req.user.id, 'delivery.accept', 'delivery', req.params.id);
  res.json({ assignment: await reload(req.params.id) });
});

export const reject = asyncHandler(async (req, res) => {
  const reassigned = await withTransaction(async (client) => {
    const d = await lockMine(client, req.params.id, req.user.id);
    if (d.status !== 'requested') throw conflict('This request has already been answered');
    await client.query(`UPDATE deliveries SET status='rejected', updated_at=now() WHERE id=$1`, [d.id]);
    if (d.product_order_id) {
      await client.query(`UPDATE product_orders SET status='ready_for_pickup', updated_at=now() WHERE id=$1 AND status='assigned'`, [d.product_order_id]);
      return autoAssignProductDelivery(client, d.product_order_id, d.instructions);
    }
    const order = (await client.query('SELECT * FROM orders WHERE id=$1', [d.order_id])).rows[0];
    return autoAssignTransporter(client, order, d.pickup_note);
  });
  await audit(req.user.id, 'delivery.reject', 'delivery', req.params.id);
  res.json({ assignment: await reload(req.params.id), reassigned_to: reassigned ? reassigned.transporter_id : null });
});

/** Start Pickup (stage "start": on the way to the seller) or Confirm Pickup (default). */
export const pickup = asyncHandler(async (req, res) => {
  const stage = req.body.stage ?? 'confirm';
  await withTransaction(async (client) => {
    const d = await lockMine(client, req.params.id, req.user.id);
    const to = stage === 'start' ? 'heading_to_pickup' : 'collected';
    assertTransition(d, to);
    await client.query(
      `UPDATE deliveries SET status=$2, updated_at=now(), pickup_started_at = CASE WHEN $2='heading_to_pickup' THEN now() ELSE pickup_started_at END,
              collected_at = CASE WHEN $2='collected' THEN now() ELSE collected_at END WHERE id=$1`, [d.id, to]);
    if (to === 'collected') await syncOrderOnDelivery(client, d, 'collected');
  });
  await audit(req.user.id, `delivery.pickup_${stage}`, 'delivery', req.params.id);
  res.json({ assignment: await reload(req.params.id) });
});

export const start = asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const d = await lockMine(client, req.params.id, req.user.id);
    assertTransition(d, 'in_transit');
    await client.query(`UPDATE deliveries SET status='in_transit', in_transit_at=now(), updated_at=now() WHERE id=$1`, [d.id]);
  });
  await audit(req.user.id, 'delivery.start', 'delivery', req.params.id);
  res.json({ assignment: await reload(req.params.id) });
});

const MAX_ATTEMPTS = 5;
/** Complete delivery: the buyer's 6-digit confirmation code is required. Repeated wrong codes lock the assignment for 15 minutes. */
export const complete = asyncHandler(async (req, res) => {
  const { code, notes, photo_url } = req.body;
  let failure = null;
  await withTransaction(async (client) => {
    const d = await lockMine(client, req.params.id, req.user.id);
    assertTransition(d, 'delivered');
    const proof = (await client.query('SELECT * FROM delivery_proofs WHERE delivery_id=$1 FOR UPDATE', [d.id])).rows[0];
    if (!proof) throw new AppError(500, 'Delivery proof record is missing');
    if (proof.locked_until && new Date(proof.locked_until) > new Date()) { failure = new AppError(429, 'Too many wrong codes. Try again in a few minutes or ask the buyer to contact support.'); return; }
    if (!codeMatches(d.id, code, proof.confirmation_code_hash)) {
      const attempts = proof.failed_attempts + 1;
      await client.query('UPDATE delivery_proofs SET failed_attempts=$2::int, locked_until = CASE WHEN $2::int >= $3::int THEN now() + interval \'15 minutes\' ELSE NULL END WHERE delivery_id=$1', [d.id, attempts, MAX_ATTEMPTS]);
      failure = badRequest(attempts >= MAX_ATTEMPTS ? 'Wrong code. This delivery is locked for 15 minutes.' : `Wrong confirmation code (${MAX_ATTEMPTS - attempts} attempts left)`);
      return;
    }
    await client.query(`UPDATE deliveries SET status='delivered', delivered_at=now(), updated_at=now() WHERE id=$1`, [d.id]);
    await client.query(`UPDATE delivery_proofs SET delivered_at=now(), delivery_notes=$2, delivery_photo=$3, failed_attempts=0, locked_until=NULL WHERE delivery_id=$1`, [d.id, notes ?? null, photo_url ?? null]);
    await syncOrderOnDelivery(client, { ...d, delivered_at: new Date() }, 'delivered');
  });
  if (failure) throw failure;
  await audit(req.user.id, 'delivery.complete', 'delivery', req.params.id);
  res.json({ assignment: await reload(req.params.id) });
});

/** Location is recorded only when the partner's device shares it, and only during an active run. */
export const location = asyncHandler(async (req, res) => {
  const d = (await query('SELECT id, status FROM deliveries WHERE id=$1 AND transporter_id=$2', [req.params.id, req.user.id])).rows[0];
  if (!d) throw notFound('Assignment not found');
  if (!['heading_to_pickup', 'collected', 'in_transit'].includes(d.status)) throw conflict('Location can be shared only while a delivery is underway');
  await query('INSERT INTO delivery_locations(delivery_id, latitude, longitude) VALUES ($1,$2,$3)', [d.id, req.body.latitude, req.body.longitude]);
  await query(`DELETE FROM delivery_locations WHERE delivery_id=$1 AND id NOT IN (SELECT id FROM delivery_locations WHERE delivery_id=$1 ORDER BY recorded_at DESC LIMIT 50)`, [d.id]);
  res.status(201).json({ recorded: true });
});

export const dashboard = asyncHandler(async (req, res) => {
  const [c, e, prof, perf] = await Promise.all([
    query(`SELECT count(*)::int AS total_assigned,
                  count(*) FILTER (WHERE status='requested')::int AS pending, count(*) FILTER (WHERE status IN ('accepted','heading_to_pickup','collected','in_transit'))::int AS active,
                  count(*) FILTER (WHERE status='delivered')::int AS completed, count(*) FILTER (WHERE status='rejected')::int AS cancelled FROM deliveries WHERE transporter_id=$1`, [req.user.id]),
    query(`SELECT COALESCE(sum(amount) FILTER (WHERE created_at::date = current_date),0) AS today, COALESCE(sum(amount),0) AS total,
                  COALESCE(sum(amount) FILTER (WHERE payment_status='pending'),0) AS pending_payout FROM delivery_earnings WHERE partner_id=$1`, [req.user.id]),
    query(`SELECT availability_status FROM transporter_profiles WHERE user_id=$1`, [req.user.id]),
    query(`SELECT count(*) FILTER (WHERE deadline IS NOT NULL AND delivered_at <= deadline)::int AS on_time, count(*) FILTER (WHERE deadline IS NOT NULL AND status='delivered')::int AS with_deadline,
                  round(avg(EXTRACT(EPOCH FROM (delivered_at - collected_at))/60) FILTER (WHERE status='delivered' AND collected_at IS NOT NULL))::int AS avg_minutes,
                  (SELECT round(avg(r.delivery_rating)::numeric,1) FROM buyer_reviews r WHERE r.delivery_rating IS NOT NULL AND (r.product_order_id IN (SELECT product_order_id FROM deliveries WHERE transporter_id=$1) OR r.order_id IN (SELECT order_id FROM deliveries WHERE transporter_id=$1))) AS avg_rating
             FROM deliveries WHERE transporter_id=$1`, [req.user.id]),
  ]);
  const p = perf.rows[0];
  const done = c.rows[0].completed; const settled = done + c.rows[0].cancelled;
  res.json({ counts: c.rows[0], earnings: e.rows[0], availability_status: prof.rows[0]?.availability_status ?? 'available',
    performance: { completion_rate: settled ? Math.round((done / settled) * 100) : null, on_time_rate: p.with_deadline ? Math.round((p.on_time / p.with_deadline) * 100) : null, avg_minutes_pickup_to_delivery: p.avg_minutes, avg_rating: p.avg_rating } });
});

export const earnings = asyncHandler(async (req, res) => {
  const [sum, daily, tx] = await Promise.all([
    query(`SELECT count(*)::int AS completed_deliveries,
                  COALESCE(sum(amount) FILTER (WHERE created_at >= date_trunc('day', now())),0) AS day,
                  COALESCE(sum(amount) FILTER (WHERE created_at >= date_trunc('week', now())),0) AS week,
                  COALESCE(sum(amount) FILTER (WHERE created_at >= date_trunc('month', now())),0) AS month,
                  COALESCE(sum(amount),0) AS total, COALESCE(sum(amount) FILTER (WHERE payment_status='paid'),0) AS paid, COALESCE(sum(amount) FILTER (WHERE payment_status='pending'),0) AS pending
             FROM delivery_earnings WHERE partner_id=$1`, [req.user.id]),
    query(`SELECT to_char(d::date,'MM-DD') AS day, COALESCE(sum(e.amount),0) AS amount FROM generate_series(current_date - interval '13 days', current_date, '1 day') d
             LEFT JOIN delivery_earnings e ON e.partner_id=$1 AND e.created_at::date=d::date GROUP BY d ORDER BY d`, [req.user.id]),
    query(`SELECT e.id, e.amount, e.currency, e.payment_status, e.created_at, e.paid_at, COALESCE(po.tracking_number, upper(substr(replace(d.order_id::text,'-',''),1,10))) AS order_ref
             FROM delivery_earnings e JOIN deliveries d ON d.id=e.delivery_id LEFT JOIN product_orders po ON po.id=d.product_order_id WHERE e.partner_id=$1 ORDER BY e.created_at DESC LIMIT 100`, [req.user.id]),
  ]);
  res.json({ summary: sum.rows[0], last_14_days: daily.rows, transactions: tx.rows,
    note: 'Amounts use the platform delivery fee. Payouts are marked paid by an administrator; no payment is made automatically.' });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const b = req.body;
  await withTransaction(async (client) => {
    await client.query(`UPDATE users SET full_name=COALESCE($2,full_name), phone=COALESCE($3,phone) WHERE id=$1`, [req.user.id, b.full_name ?? null, b.phone ?? null]);
    const keys = ['company_name', 'vehicle_type', 'plate_number', 'capacity_litres', 'has_cold_storage', 'service_area'].filter((k) => b[k] !== undefined);
    if (keys.length) {
      await client.query(`INSERT INTO transporter_profiles(user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [req.user.id]);
      await client.query(`UPDATE transporter_profiles SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE user_id=$1`, [req.user.id, ...keys.map((k) => b[k])]);
    }
  });
  const { rows } = await query(`SELECT u.id, u.full_name, u.phone, u.fayda_verified, tp.* FROM users u LEFT JOIN transporter_profiles tp ON tp.user_id=u.id WHERE u.id=$1`, [req.user.id]);
  res.json({ profile: rows[0] });
});

export const setAvailability = asyncHandler(async (req, res) => {
  const s = req.body.availability_status;
  await query(`INSERT INTO transporter_profiles(user_id, availability_status, available) VALUES ($1,$2,$3)
               ON CONFLICT (user_id) DO UPDATE SET availability_status=EXCLUDED.availability_status, available=EXCLUDED.available`, [req.user.id, s, s === 'available']);
  res.json({ availability_status: s });
});
