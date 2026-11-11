import { round, clamp } from '../utils/num.js';

/**
 * Farmer reputation (0-100) from verified history:
 *  60% share of tested batches graded A, 25% dispute-free completed orders, 15% volume of completed orders (caps at 20).
 */
export async function recomputeReputation(client, farmerId) {
  const { rows: t } = await client.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE grade='A')::int AS a
       FROM milk_batches WHERE farmer_id=$1 AND grade IS NOT NULL`,
    [farmerId]
  );
  const { rows: o } = await client.query(
    `SELECT count(*) FILTER (WHERE status='completed')::int AS completed,
            count(*) FILTER (WHERE status='refunded')::int AS refunded
       FROM orders WHERE farmer_id=$1`,
    [farmerId]
  );
  const aShare = t[0].total ? t[0].a / t[0].total : 0.5;
  const done = o[0].completed + o[0].refunded;
  const clean = done ? o[0].completed / done : 0.5;
  const volume = clamp(o[0].completed / 20, 0, 1);
  const score = Math.round(100 * (0.6 * aShare + 0.25 * clean + 0.15 * volume));
  await client.query('UPDATE farmer_profiles SET reputation_score=$2 WHERE user_id=$1', [farmerId, score]);
  return { score, a_share: round(aShare, 2) };
}
