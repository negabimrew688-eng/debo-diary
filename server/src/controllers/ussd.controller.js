import { query } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getSettings } from '../services/settings.service.js';

const normalize = (p) => String(p || '').replace(/[^0-9]/g, '').slice(-9);

/**
 * USSD menu for basic phones (Africa's Talking style: form fields sessionId, phoneNumber, text; reply "CON ..." or "END ...").
 * Read-only: farmers can hear their latest batch grade, today's reference price and open orders.
 */
export const ussd = asyncHandler(async (req, res) => {
  res.type('text/plain');
  const phone = normalize(req.body.phoneNumber);
  const steps = String(req.body.text || '').split('*').filter(Boolean);
  const { rows } = phone.length === 9
    ? await query(`SELECT id, full_name FROM users WHERE role='farmer' AND is_active AND right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 9)=$1`, [phone])
    : { rows: [] };
  const farmer = rows[0];
  if (!farmer) return res.send('END This number is not registered as a Debo Dairy farmer. Register at the Debo Dairy app.');

  if (steps.length === 0) return res.send(`CON Debo Dairy - ${farmer.full_name.split(' ')[0]}\n1. My latest milk result\n2. Today's milk price\n3. My open orders`);

  if (steps[0] === '1') {
    const r = await query(
      `SELECT b.volume_litres, b.status, b.asking_price, t.grade, t.estimated_water_percent FROM milk_batches b
         JOIN LATERAL (SELECT * FROM milk_tests WHERE batch_id=b.id AND test_type='producer' ORDER BY created_at DESC LIMIT 1) t ON TRUE
        WHERE b.farmer_id=$1 ORDER BY b.created_at DESC LIMIT 1`, [farmer.id]);
    const b = r.rows[0];
    if (!b) return res.send('END No tested milk batch yet.');
    const price = b.asking_price ? `Price ${b.asking_price} birr/L.` : 'Not listed for sale.';
    return res.send(`END Your milk: Grade ${b.grade === 'FAIL' ? 'FAIL (not sellable)' : b.grade}, ~${b.estimated_water_percent}% water, ${b.volume_litres} L. ${price}`);
  }
  if (steps[0] === '2') {
    const s = await getSettings();
    return res.send(`END Reference price: Grade A ${s.base_price_per_litre * s.grade_multipliers.A} birr/L, Grade B ${Math.round(s.base_price_per_litre * s.grade_multipliers.B * 100) / 100} birr/L.`);
  }
  if (steps[0] === '3') {
    const r = await query(`SELECT count(*)::int AS n, COALESCE(sum(total_amount),0) AS amount FROM orders WHERE farmer_id=$1 AND status IN ('pending_payment','paid','in_transit','delivered','disputed')`, [farmer.id]);
    return res.send(`END You have ${r.rows[0].n} open order(s) worth ${r.rows[0].amount} birr.`);
  }
  return res.send('END Invalid choice.');
});
