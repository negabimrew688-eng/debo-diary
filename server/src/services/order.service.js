import { conflict } from '../utils/AppError.js';
import { recomputeReputation } from './reputation.service.js';
import { createDelivery } from './delivery.service.js';

export const GRADE_RANK = { A: 0, B: 1, FAIL: 2 };

/** Pick the best available transporter for an order (capacity, service area, cold storage), skipping any who already rejected it. */
export async function autoAssignTransporter(client, order, pickupNote = null) {
  const { rows } = await client.query(
    `SELECT u.id FROM users u
       JOIN transporter_profiles tp ON tp.user_id = u.id
       JOIN users f ON f.id = $3
      WHERE u.is_active AND tp.availability_status='available'
        AND (tp.capacity_litres IS NULL OR tp.capacity_litres >= $2)
        AND u.id NOT IN (SELECT transporter_id FROM deliveries WHERE order_id=$1 AND status='rejected')
      ORDER BY (f.region IS NOT NULL AND tp.service_area ILIKE '%' || f.region || '%') DESC,
               tp.has_cold_storage DESC, tp.capacity_litres ASC NULLS LAST, u.created_at ASC
      LIMIT 1`,
    [order.id, order.volume_litres, order.farmer_id]);
  if (!rows[0]) return null;
  return createDelivery(client, { orderId: order.id, transporterId: rows[0].id, note: pickupNote });
}

export async function releaseEscrow(client, order) {
  const p = await client.query(`UPDATE payments SET status='released', updated_at=now() WHERE order_id=$1 AND status='held' RETURNING id`, [order.id]);
  if (!p.rowCount) throw conflict('No held payment to release for this order');
  await client.query(`UPDATE orders SET status='completed', updated_at=now() WHERE id=$1`, [order.id]);
  await recomputeReputation(client, order.farmer_id);
}

export async function refundEscrow(client, order) {
  const p = await client.query(`UPDATE payments SET status='refunded', updated_at=now() WHERE order_id=$1 AND status='held' RETURNING id`, [order.id]);
  if (!p.rowCount) throw conflict('No held payment to refund for this order');
  await client.query(`UPDATE orders SET status='refunded', updated_at=now() WHERE id=$1`, [order.id]);
  await recomputeReputation(client, order.farmer_id);
}
